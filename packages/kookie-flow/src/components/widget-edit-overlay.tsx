/**
 * A real DOM input, borrowed for one edit, over one widget.
 *
 * THIS IS THE WHOLE OF THE DOM'S REMAINING ROLE on a node. Everything a widget looks like at rest
 * is drawn in GL by `widgets-gl.tsx`; this mounts when a person starts editing a field and
 * unmounts the moment they stop. Nothing persists.
 *
 * WHY BORROW A REAL INPUT rather than draw a caret in GL, when this repo already ships a GL caret
 * for canvas text entities. Three reasons, and they are about what a text field OWES rather than
 * about what is possible: IME composition for anyone typing a language that needs it, the
 * platform's own selection and clipboard behaviour, and — for `color` — the operating system's
 * colour picker, which cannot be reimplemented at all. The GL caret earns its place on a text
 * entity, where the text IS the document and the font metrics are ours; it would be a
 * reimplementation of the platform here.
 *
 * A `select` is here on the same rule, and it is the newest arrival. It used to be answered
 * entirely in GL by cycling to the next option on every press, so choosing the fourth of five took
 * four presses and the option set was never on screen at all. A list owes exactly what the colour
 * picker owes: arrow and Home/End navigation, type-ahead, the platform's own picker on touch, and
 * a popup that is allowed to leave the canvas bounds. Drawing one in GL would have meant an
 * always-on-top pass outside the per-entity depth slice, its own instanced mesh, row hit testing,
 * scrolling and dismissal — a reimplementation of a control every platform already ships.
 *
 * The element is positioned over the widget's world box through the SAME geometry the renderer
 * draws from, so the borrowed input lands exactly on the thing it replaces and there is no visual
 * jump on either edge of the edit.
 *
 * ONE PAINTER. This element is TRANSPARENT, for every kind. The GL layer draws the well, the
 * hairline, the inner shade and — keyed on `editingWidgetKey`, which opening an edit sets — the
 * focus ring (`aHover = 2` in widgets-gl.tsx). The DOM contributes only what GL cannot: the
 * glyphs being typed, the caret, the platform's list and the platform's colour picker. The text
 * layer already stops printing the value under an open edit (text-renderer.tsx), so the DOM glyphs
 * stand exactly where the MSDF glyphs stood: same font, same size, same inset.
 *
 * It USED TO PAINT — an opaque fill and an accent border, on the argument that a ring drawn under
 * an opaque box is invisible by construction. Measured, that argument produced the defect the
 * owner named: `font: inherit` resolved to the canvas container's UA serif, the 4px radius sat
 * under a pill well, `border 1px + padding 6px` put the glyph one pixel right of where GL had it,
 * and the accent border invented a focus state GL never drew. A second painter can only ever
 * approximate the first. Nothing else on a node can hold focus — a canvas has no focusable
 * children — so the one ring GL draws is the whole focus model. For the two kinds that never
 * borrow anything, checkbox and slider, the only state with any duration is being PRESSED, which
 * widgets-gl draws through the same attribute for as long as the gesture lasts.
 */

import {
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle, useSocketLayout } from '../contexts/StyleContext';
import { THEME_COLORS, resolveColor, type ColorTokenRef } from '../core/theme-colors';
import { themeRoot } from '../utils/theme-root';

import type { WidgetHit } from '../utils/widget-hit';

/**
 * The face the MSDF atlas was built from. It leads the stack whatever the theme says, because the
 * glyphs this element replaces ARE that face; the theme's family is the fallback where the page
 * has not loaded it, and `system-ui` is the fallback for a page with no Theme at all.
 */
const ATLAS_FONT = '"Google Sans"';
const SYSTEM_FONT = 'system-ui, sans-serif';

/**
 * The theme's body family, read off the theme root — or '' where there is none to read.
 *
 * `--font-body` first: KookieUI v2 declares the family as that variable on the Theme element and
 * does NOT set `font-family` on the element itself, so the element's computed family is whatever
 * it inherited — on a bare page the UA serif, which is exactly the face the defect showed. The
 * computed family is taken only when it is not a UA default.
 */
function themeFontFamily(): string {
  const root = themeRoot();
  if (!root) return '';
  const styles = getComputedStyle(root);
  const body = styles.getPropertyValue('--font-body').trim();
  if (body) return body;
  const inherited = styles.fontFamily;
  return /^(serif|"?Times)/i.test(inherited) ? '' : inherited;
}

/**
 * A number input's spin buttons cannot be reached from an inline style — they are a pseudo-element
 * — so the one rule that hides them is injected once, on the first mount, keyed on a data
 * attribute this element carries. Same shape as widgets/NumberWidget.tsx, for the same reason.
 * GL draws no stepper, and a stepper appearing only while the field is open is a second painter.
 */
const OVERLAY_ATTR = 'data-kookie-flow-widget-edit';
const OVERLAY_STYLE_ID = 'kookie-flow-widget-edit-style';
const OVERLAY_CSS = `
[${OVERLAY_ATTR}]::-webkit-inner-spin-button,
[${OVERLAY_ATTR}]::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
`;

/**
 * Vertical nudge on the borrowed element, in px. GL centres the value at `box.y + h/2 - 7`; the
 * DOM centres by line-height. MEASURED, not guessed: with the atlas face loaded, at DPR 2, the DOM
 * glyph bounds of "one" and "name" sit exactly one device pixel (0.5 CSS px) ABOVE the MSDF
 * glyphs, x identical, row profile identical. `1` flips that to one device pixel below; `0.5`
 * snaps to 0 on an input and to 1 on a select. Neither integer is nearer than the other, so this
 * stays 0 — the one that adds no fractional layout.
 */
const OVERLAY_PADDING_TOP = 0;

function useOverlayStylesheet(): void {
  useInsertionEffect(() => {
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = OVERLAY_STYLE_ID;
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
  }, []);
}

export interface WidgetEditOverlayProps {
  /** The widget being edited, or null when nothing is. */
  hit: WidgetHit | null;
  /** Called with the new value on every keystroke, exactly as the DOM widgets did. */
  onChange?: (entityId: string, socketId: string, value: unknown) => void;
  /** Called when the edit ends, for any reason. */
  onClose: () => void;
}

/**
 * Which element a widget type borrows, and — for the three that are `<input>`s — its `type`.
 *
 * `textarea` and `select` are the two answers that are not an input at all, so this is no longer
 * quite "what a widget type wants from an `<input>`"; the return is read as an element choice
 * first and an input type second.
 */
function inputTypeFor(type: string): 'text' | 'number' | 'color' | 'textarea' | 'select' {
  if (type === 'number') return 'number';
  if (type === 'color') return 'color';
  if (type === 'textarea') return 'textarea';
  if (type === 'select') return 'select';
  return 'text';
}

/**
 * Open the platform's own list, once, for a select that has just been mounted and focused.
 *
 * Feature-detected rather than assumed: jsdom has no `showPicker`, and neither do browsers older
 * than it. Where it is missing the select is still focused on its own widget, so a second press
 * opens the list natively and Alt+Down opens it from the keyboard — a degraded open rather than a
 * dead control, which is why the absence is not worth an error.
 */
function openPicker(el: HTMLSelectElement): void {
  if (typeof el.showPicker !== 'function') return;
  try {
    el.showPicker();
  } catch (err) {
    // NotAllowedError, thrown when the press's transient activation lapsed before this ran. Same
    // degraded open as a missing `showPicker`. Anything that is not a DOM exception is a real bug
    // in this file and is rethrown rather than swallowed.
    if (!(err instanceof DOMException)) throw err;
  }
}

export function WidgetEditOverlay({ hit, onChange, onClose }: WidgetEditOverlayProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const resolvedStyle = useResolvedStyle();
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);
  useOverlayStylesheet();

  // Read once per mount. `font: inherit` was the defect: it inherits from the canvas container,
  // which inherits nothing from the Theme, so the UA serif came through. The theme root is where
  // the family actually lives.
  const themeFont = useMemo(() => {
    const theme = themeFontFamily();
    return theme ? `${ATLAS_FONT}, ${theme}` : `${ATLAS_FONT}, ${SYSTEM_FONT}`;
  }, []);

  const hitRef = useRef(hit);
  hitRef.current = hit;

  /**
   * Did a key produce the `change` a select is about to fire?
   *
   * A select fires `change` for keyboard navigation as well as for a pick — arrows on a closed
   * select, and type-ahead everywhere — so ending the edit on every change would close it on the
   * first arrow press, which is the opposite of choosing. A change with no key in front of it came
   * from the list, and only that ends the edit.
   *
   * Cleared on `keyup` as well as on the change itself, because a key that moves nothing still
   * arms the flag: typing a letter no option starts with fires keydown and no change at all, and a
   * flag left standing there would make the NEXT pick from the list fail to close.
   */
  const keyChangeRef = useRef(false);

  /**
   * The text being typed lives HERE for the length of the edit.
   *
   * The obvious spelling — bind `value` to `hit.value` and write out on every keystroke — is
   * broken, and measurably so: `hit` is the snapshot taken when the widget was pressed, so its
   * value never moves. Every keystroke wrote out correctly and then the input re-rendered with
   * the original string, so typing "hello" into a field reading "name" left "nameo". Only the
   * last character survived.
   *
   * Binding to the LIVE entity instead would be the other obvious spelling and is worse: it makes
   * the field's contents depend on the consumer echoing the change back, so a consumer who batches
   * or debounces gets a field that fights the person typing into it. This is the same conclusion
   * the DOM widgets reached, by the same route.
   *
   * Seeded once per edit, keyed on the widget's identity so opening a different field re-seeds.
   */
  const editKey = hit ? `${hit.entityId}:${hit.socketId}` : '';
  const [draft, setDraft] = useState('');
  const seededFor = useRef('');
  if (hit && seededFor.current !== editKey) {
    seededFor.current = editKey;
    setDraft(hit.value === undefined || hit.value === null ? '' : String(hit.value));
  }

  /**
   * Follow the viewport for as long as the edit lasts.
   *
   * A person can pan or zoom while a field is open, and the borrowed input has to stay on its
   * widget — so this subscribes to the viewport rather than reading it once. It writes
   * `transform` on one element, which is the same shape the DOM widgets used and costs no layout.
   */
  useEffect(() => {
    if (!hit) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = elRef.current;
      const h = hitRef.current;
      if (!el || !h) return;
      const { viewport } = store.getState();
      const x = h.box.x * viewport.zoom + viewport.x;
      const y = h.box.y * viewport.zoom + viewport.y;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${viewport.zoom})`;
      el.style.width = `${h.box.width}px`;
      el.style.height = `${h.box.height}px`;
    };
    place();
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(place);
    };
    const unsub = store.subscribe((s) => s.viewport, schedule);
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hit, store]);

  // Focus and select on open. `select()` rather than a bare focus: a person pressing a field with
  // a value in it means to replace it far more often than to append to it.
  useLayoutEffect(() => {
    if (!hit) return;
    const el = elRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // A select opens its list here rather than selecting text it does not have. This has to stay
    // in the LAYOUT effect for the same reason the focus does — see the note below on why the
    // style is computed during render: `showPicker()` on an element that is not displayed throws,
    // exactly as focus on one was silently refused.
    if (el instanceof HTMLSelectElement) openPicker(el);
    else if (el instanceof HTMLInputElement && el.type !== 'color') el.select();
    else if (el instanceof HTMLTextAreaElement) el.select();
  }, [hit]);

  if (!hit) return null;

  /**
   * Computed during render, NOT held in state, and that is load-bearing rather than tidy.
   *
   * It was state, set from a passive effect — and passive effects run AFTER layout effects, so
   * the focus below fired while the element was still at its initial `display: none`. An element
   * that is not displayed cannot take focus, and the browser refuses it silently: the field
   * mounted, looked right, and swallowed every keystroke. Measured as `activeElement` staying on
   * the canvas container through the whole gesture.
   */
  const rgb = (key: ColorTokenRef) =>
    `rgb(${resolveColor(key, tokens).map((v) => Math.round(v * 255)).join(',')})`;
  // GL centres the value on the FIRST row of a multi-row widget (text-renderer.tsx), so the line
  // box is one row tall, not the whole box — a three-row textarea reads from its top line.
  const rowHeight = Math.min(hit.box.height, socketLayout.widgetHeight);
  const style: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: '0 0',
    boxSizing: 'border-box',
    // The glyphs GL was printing a frame ago: same family, same size, same left inset (PAD is
    // the resolved control inset widget-text.ts places the value at, which grows when the corner
    // is a pill). Zero border, so the inset is that number and not that number + 1. Nothing here
    // paints a well, a hairline or a ring — that is GL's, see the top.
    fontFamily: themeFont,
    fontSize: '12px',
    fontWeight: 400,
    letterSpacing: 0,
    lineHeight: `${rowHeight}px`,
    padding: `${OVERLAY_PADDING_TOP}px ${resolvedStyle.widgetPad}px 0`,
    border: 0,
    outline: 'none',
    boxShadow: 'none',
    background: 'transparent',
    // Clips the caret and the selection highlight to the well's own shape.
    // The same corner the GL well draws, clamped the same way the shader clamps it — so at the
    // `full` level the caret and the selection highlight are clipped to a pill and not to a
    // rectangle sitting inside one.
    borderRadius: `${Math.min(resolvedStyle.widgetRadius, rowHeight / 2)}px`,
    color: rgb(THEME_COLORS.text.primary),
    caretColor: rgb(THEME_COLORS.widget.active),
    resize: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  const kind = inputTypeFor(hit.config.type);

  // A select keeps clear of the GL chevron, which the shader draws inset from the trailing edge;
  // its own arrow is gone with `appearance: none`. A colour input has no glyphs and no caret to
  // contribute — the swatch is GL's — so it is fully invisible and exists to open the picker.
  const kindStyle: CSSProperties =
    kind === 'select'
      ? { ...style, paddingRight: '20px', textIndent: 0 }
      : kind === 'color'
        ? { ...style, opacity: 0 }
        // Firefox aliases -moz-appearance to appearance, so 'textfield' on the shared style put a
        // native arrow back on the select. Only the number kind wants it, for its spin buttons.
        : kind === 'number'
          ? { ...style, MozAppearance: 'textfield' }
        : style;

  const commit = (raw: string) => {
    setDraft(raw);
    const next =
      hit.config.type === 'number'
        ? raw === ''
          ? ''
          : Number(raw)
        : raw;
    onChange?.(hit.entityId, hit.socketId, next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Every key stays here. The canvas keyboard is gated on the container having focus, and it
    // does not while this is open — but a stray Delete reaching the graph and removing the node
    // being edited is the failure worth being explicit about.
    e.stopPropagation();
    // Marks the change this key is about to produce as navigation rather than a pick.
    if (kind === 'select') keyChangeRef.current = true;
    if (e.key === 'Escape' || (e.key === 'Enter' && kind !== 'textarea')) {
      e.preventDefault();
      onClose();
    }
  };

  const onSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    commit(e.target.value);
    if (keyChangeRef.current) {
      keyChangeRef.current = false;
      return; // Arrowed or typed to it: the person is still choosing.
    }
    onClose(); // Came from the list: the choice is made and the edit is over.
  };

  const onSelectKeyUp = () => {
    keyChangeRef.current = false;
  };

  const common = {
    ref: elRef as React.Ref<never>,
    style: kindStyle,
    value: draft,
    [OVERLAY_ATTR]: '',
    // The socket's NAME, not its id. This announced 'label' or 'w0' — the consumer's internal
    // key — while the GL layer painted 'Label' next to it, so the field a screen reader described
    // and the field on screen were not obviously the same thing. It also has to agree with the
    // accessibility mirror, which names its controls the same way: two controls with different
    // names for one socket is the duplicate-name defect from the other side.
    'aria-label': hit.socketName,
    onKeyDown,
    onBlur: onClose,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      commit(e.target.value),
  };

  if (kind === 'select') {
    const options = hit.config.options ?? [];
    // A value the config no longer offers must not silently become option zero: React warns on a
    // controlled select whose value matches no option, and the control would then be lying about
    // what the socket holds. The unmatched value gets its own hidden, unselectable row instead,
    // labelled the way the GL layer labels an empty select so opening one does not change the
    // words on screen.
    const matched = options.includes(draft);
    const placeholder = draft === '' ? (hit.config.placeholder ?? 'Select…') : draft;
    return (
      <select
        {...common}
        value={matched ? draft : ''}
        onChange={onSelectChange}
        onKeyUp={onSelectKeyUp}
      >
        {matched ? null : (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return kind === 'textarea' ? <textarea {...common} /> : <input type={kind} {...common} />;
}
