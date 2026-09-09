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
 * The element is positioned over the widget's world box through the SAME geometry the renderer
 * draws from, so the borrowed input lands exactly on the thing it replaces and there is no visual
 * jump on either edge of the edit.
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

/** What a widget type wants from an `<input>`. `textarea` is the one that is not an input at all. */
function inputTypeFor(type: string): 'text' | 'number' | 'color' | 'textarea' {
  if (type === 'number') return 'number';
  if (type === 'color') return 'color';
  if (type === 'textarea') return 'textarea';
  return 'text';
}

export function WidgetEditOverlay({ hit, onChange, onClose }: WidgetEditOverlayProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

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
    if (el instanceof HTMLInputElement && el.type !== 'color') el.select();
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
    style,
    value: draft,
    'aria-label': hit.socketId,
    onKeyDown,
    onBlur: onClose,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      commit(e.target.value),
  };

  return kind === 'textarea' ? <textarea {...common} /> : <input type={kind} {...common} />;
}
