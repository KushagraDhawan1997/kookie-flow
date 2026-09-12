/**
 * A real DOM input, borrowed for one edit, over one text widget.
 *
 * THIS IS THE WHOLE OF THE DOM'S REMAINING ROLE on a node. Everything a widget looks like at rest
 * is drawn in GL by `widgets-gl.tsx`; a select's list and a colour widget's picker are drawn in GL
 * by `widget-popover.tsx`; this mounts when a person starts TYPING into a field and unmounts the
 * moment they stop. Nothing persists.
 *
 * WHY BORROW A REAL INPUT rather than draw a caret in GL, when this repo already ships a GL caret
 * for canvas text entities. Two reasons, and they are about what a text field OWES rather than
 * about what is possible: IME composition for anyone typing a language that needs it, and the
 * platform's own selection and clipboard behaviour. The GL caret earns its place on a text entity,
 * where the text IS the document and the font metrics are ours; it would be a reimplementation of
 * the platform here.
 *
 * A select and a colour widget USED TO BE HERE TOO, on the argument that a platform list and a
 * platform picker owe things a canvas cannot supply. Measured, the platform supplied them badly: a
 * `<select>` opened with `showPicker()` put its popup wherever the platform chose — the top-left
 * of the window, on a scaled canvas — could not be styled, did not scale with the node, and the
 * switch from GL glyphs to a DOM control and back was visible on both edges. What a list owes —
 * arrows, Home/End, type-ahead, dismissal, scrolling — is a few dozen lines of keyboard handling,
 * and the canvas already had a keyboard. So both moved to GL, and this element is once again what
 * it was first written to be: a caret with an IME behind it.
 *
 * The element is positioned over the widget's world box through the SAME geometry the renderer
 * draws from, so the borrowed input lands exactly on the thing it replaces and there is no visual
 * jump on either edge of the edit.
 *
 * ONE PAINTER. This element is TRANSPARENT. The GL layer draws the well, the hairline, the light
 * and — keyed on `editingWidgetKey`, which opening an edit sets — the focus ring (`aHover = 2` in
 * widgets-gl.tsx). The DOM contributes only what GL cannot: the glyphs being typed and the caret.
 * The text layer already stops printing the value under an open edit (text-renderer.tsx), so the
 * DOM glyphs stand exactly where the MSDF glyphs stood: same font, same size, same inset.
 *
 * It USED TO PAINT — an opaque fill and an accent border, on the argument that a ring drawn under
 * an opaque box is invisible by construction. Measured, that argument produced the defect the
 * owner named: `font: inherit` resolved to the canvas container's UA serif, the 4px radius sat
 * under a pill well, `border 1px + padding 6px` put the glyph one pixel right of where GL had it,
 * and the accent border invented a focus state GL never drew. A second painter can only ever
 * approximate the first. Nothing else on a node can hold focus — a canvas has no focusable
 * children — so the one ring GL draws is the whole focus model.
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
const ATLAS_FONT = '"Inter"';
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
 * snaps to 0 on an input. Neither integer is nearer than the other, so this stays 0 — the one
 * that adds no fractional layout.
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
 * Which element a widget type borrows, and — for the two that are `<input>`s — its `type`.
 *
 * `textarea` is the one answer that is not an input at all. A select and a colour widget never
 * reach this file: the canvas opens their GL panel instead (kookie-flow.tsx).
 */
function inputTypeFor(type: string): 'text' | 'number' | 'textarea' {
  if (type === 'number') return 'number';
  if (type === 'textarea') return 'textarea';
  return 'text';
}

export function WidgetEditOverlay({ hit, onChange, onClose }: WidgetEditOverlayProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const resolvedStyle = useResolvedStyle();
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
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
    el.select();
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
    fontSize: `${resolvedStyle.widgetFontSize}px`,
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
    // A number is centred in its box, as v2's number field is.
    textAlign: (hit.config.type === 'number' ? 'center' : 'left') as CSSProperties['textAlign'],
    color: rgb(THEME_COLORS.text.primary),
    caretColor: rgb(THEME_COLORS.widget.active),
    resize: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  const kind = inputTypeFor(hit.config.type);

  // Firefox aliases -moz-appearance to appearance, so 'textfield' on the shared style would put
  // a native arrow back on other kinds. Only the number kind wants it, for its spin buttons.
  const kindStyle: CSSProperties = kind === 'number' ? { ...style, MozAppearance: 'textfield' } : style;

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
    if (e.key === 'Escape' || (e.key === 'Enter' && kind !== 'textarea')) {
      e.preventDefault();
      onClose();
    }
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

  return kind === 'textarea' ? <textarea {...common} /> : <input type={kind} {...common} />;
}
