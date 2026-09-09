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
 * THIS OVERLAY IS THE FOCUS STATE, and that is why the GL layer draws none for the kinds that
 * reach here. It is sized to exactly the widget's box and painted with an OPAQUE fill and an
 * accent border, so it covers the well completely: a focus ring drawn underneath it in GL would
 * be invisible by construction, and the accent border is already the thing a ring would be
 * saying. Nothing else on a node can hold focus — a canvas has no focusable children, so there is
 * no keyboard focus model in GL to ring. For the two kinds that never borrow anything, checkbox
 * and slider, the only state with any duration is being PRESSED, which widgets-gl draws through
 * the hover attribute for as long as the gesture lasts.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useFlowStoreApi } from './context';
import { resolveTokenColor } from '../utils/style-resolver';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';
import type { WidgetHit } from '../utils/widget-hit';

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
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

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
  const rgb = (key: Parameters<typeof resolveTokenColor>[0]) =>
    `rgb(${resolveTokenColor(key, tokens).map((v) => Math.round(v * 255)).join(',')})`;
  const style: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: '0 0',
    // Matches the GL chrome underneath, so the borrowed element reads as the same control rather
    // than as a box that appeared on top of one.
    background: rgb(THEME_COLORS.widget.fill),
    color: rgb(THEME_COLORS.text.primary),
    border: `1px solid ${rgb(THEME_COLORS.widget.active)}`,
    borderRadius: '4px',
    padding: '0 6px',
    font: 'inherit',
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
    resize: 'none',
  };

  const kind = inputTypeFor(hit.config.type);

  // A select paints TRANSPARENT over its own GL chrome, where a field replaces it. The well and
  // the chevron underneath are already the right control at the right size and the text layer
  // already stops printing the option while an edit is open, so the borrowed element has only to
  // contribute the option text and the platform's list — drawing a second well and a second
  // chevron on top of the first would be the visible cost of not saying so.
  const selectStyle: CSSProperties =
    kind === 'select'
      ? {
          ...style,
          background: 'transparent',
          appearance: 'none',
          WebkitAppearance: 'none',
          // Clears the GL chevron, which the shader draws inset from the trailing edge.
          paddingRight: '20px',
        }
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
    style,
    value: draft,
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
        style={selectStyle}
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
