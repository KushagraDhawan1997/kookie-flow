/**
 * The accessibility mirror: a visually-hidden, focusable DOM control for every widget on the
 * entity the keyboard cursor is standing on.
 *
 * WHAT THIS IS FOR. The seven built-in socket widgets draw in WebGL. A canvas exposes no roles,
 * no names and no focusable children, so moving them there took them out of the accessibility
 * tree entirely: before that migration a screen-reader user could reach a socket widget, and
 * after it there was nothing on a node to reach at all. That gap is recorded in
 * plans/migration/decisions.md D7, which recommends this shape and amends the migration's own
 * rule to match — everything persistent PAINTS in GL, and the accessibility tree is not paint.
 *
 * THE BOUND IS THE WHOLE ARGUMENT, and it is the reason this file is small. A mirror of every
 * widget in the graph is thousands of focusable elements at a thousand nodes — which is precisely
 * the persistent per-node DOM the GL migration existed to delete, re-introduced through a side
 * door and with a compositing cost measured at 30-40fps. Two other bounds were considered and
 * both are worse:
 *
 *  - MIRROR WHAT IS VISIBLE. Visibility changes as the viewport moves, so the element SET changes
 *    on pan frames. Mounting and unmounting DOM during a pan is strictly worse than the transform
 *    writes the migration removed, and it would also move focus out from under anyone using it.
 *  - MIRROR THE SELECTION. `selectAll` puts every entity in `selectedEntityIds`, so Ctrl+A would
 *    commit a thousand nodes' worth of controls at once.
 *
 * What is mirrored instead is ONE entity: the one under `focusedEntityId`, the store's keyboard
 * cursor, which by construction holds at most one id. The element count is bounded by the sockets
 * on a single node and does not move with the size of the graph — a claim harness/behaviors.mjs
 * pins at a thousand nodes rather than leaving to this comment.
 *
 * EXACTLY ONE TAB STOP. Every control here carries `tabIndex={-1}`, so Tab reaches the canvas
 * container and then leaves the graph entirely, as it did before this file existed. Entry is by
 * pressing Enter on the container, and inside the group Up and Down move between controls while
 * Escape hands focus back — the roving-focus half of the roving-tabindex pattern, without the
 * second tab stop a literal `tabIndex={0}` here would add. A `tabIndex={-1}` element is still
 * programmatically focusable and still fully present in the accessibility tree, which is what a
 * screen reader's own cursor navigates.
 *
 * REAL ELEMENTS, NEVER ARIA ROLES. A slider is `<input type="range">`, not `role="slider"` with
 * three hand-maintained aria-value attributes: the platform derives the role and all three values
 * from the element and supplies arrow, Home/End and PageUp/PageDown handling for free. The one
 * hand-rolled `role="slider"` this repo has to excuse in its naming law is upstream's, and it is
 * excused because it cannot be fixed from here — not because the shape is acceptable.
 *
 * VISUALLY HIDDEN MEANS CLIPPED, and nothing else. `display:none`, `visibility:hidden`, the
 * `hidden` attribute and `aria-hidden` each remove an element from the accessibility tree, which
 * would leave this file mounting controls nobody can reach — an elaborate way to change nothing.
 * `opacity:0` is not the mechanism either: an opacity-0 element still paints, and at a widget's
 * real size it would be a composited surface over the canvas, which is the cost being avoided.
 *
 * REACT OWNS THE SET, AN EFFECT OWNS THE VALUES. That split is this codebase's established answer
 * to "keep DOM in step with a store without re-rendering during a pan", and it is what keeps the
 * rule-1 invariant here: the element set is keyed on the focused entity and the graph's topology,
 * neither of which moves during pan, zoom or drag, and each element's live value is written
 * imperatively from a microtask-batched subscriber.
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { shallow } from 'zustand/shallow';
import { useFlowStoreApi } from './context';
import { listEntityWidgets, mirrorDisplayValue, sameMirrorShape, type MirrorEntry } from '../utils/widget-mirror';
import { readWidgetValue, widgetKey } from '../utils/widget-values';
import type { Entity, SocketType } from '../types';

/** Any control this file mounts. */
type MirrorControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * The clip-rect pattern, declared once at module scope rather than allocated per render.
 *
 * `pointerEvents: 'none'` is not decoration: the clip leaves a live one-pixel hit target wherever
 * the element sits, and a stray press landing on it would be a press the canvas never sees. It
 * has no effect on focusability, which is what this whole file is about.
 */
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

const NO_ENTRIES: MirrorEntry[] = [];

export interface WidgetA11yMirrorProps {
  /** The entity the keyboard cursor is on, or null when it is nowhere. */
  entityId: string | null;
  socketTypes: Record<string, SocketType>;
  /** Consumer widget components, read for key presence — see listEntityWidgets. */
  widgetTypes?: Record<string, unknown>;
  /**
   * The socket that currently has a borrowed DOM input open on it, or null.
   *
   * Its mirror is REMOVED while the edit lasts. Two controls with the same accessible name inside
   * one `[data-entity-id]` is the exact defect the naming law fails on, and the borrowed input is
   * the one a person is actually typing into. Removal rather than `aria-hidden`, because hiding a
   * focusable element from assistive technology is its own violation and the thing this file
   * refuses everywhere else.
   */
  editingSocketId: string | null;
  /** The same path the pointer and the borrowed input use. */
  onChange: (entityId: string, socketId: string, value: unknown) => void;
}

function entityLabel(entity: Entity): string {
  const label = entity.data?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : entity.id;
}

function valueBag(entity: Entity): Record<string, unknown> | undefined {
  const values: unknown = entity.data?.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return undefined;
  return values as Record<string, unknown>;
}

export function WidgetA11yMirror({
  entityId,
  socketTypes,
  widgetTypes,
  editingSocketId,
  onChange,
}: WidgetA11yMirrorProps) {
  const store = useFlowStoreApi();
  /**
   * The element set and the group's name, in ONE state value.
   *
   * Two `useState`s here were a measured re-render: React re-renders a component once before
   * bailing out even when a setter is handed the value the state already holds, so two "nothing
   * changed" setters cost one commit per topology bump — which on a controlled consumer is one
   * per echoed keystroke. Comparing BEFORE the call, against a ref, costs nothing when nothing
   * moved, which is the common case by a wide margin.
   */
  const [model, setModel] = useState<{ entries: MirrorEntry[]; label: string }>({
    entries: NO_ENTRIES,
    label: '',
  });
  const modelRef = useRef(model);
  modelRef.current = model;
  const { entries, label } = model;
  const elsRef = useRef<Map<string, MirrorControl>>(new Map());
  const groupRef = useRef<HTMLDivElement>(null);

  /**
   * The element SET, recomputed only when the graph's SHAPE could have moved.
   *
   * `topologyVersion` is this store's established "structure changed, re-snapshot" signal and is
   * what widgets-layer.tsx already listens to for the same question; `connectedSockets` is beside
   * it because connecting a socket removes its widget without changing any count. Deliberately
   * NOT `entities`, which is republished on every pointermove of a drag — subscribing to it here
   * would put a React commit inside a drag, which is the one thing this codebase forbids outright.
   *
   * `sameMirrorShape` is what makes the frequency of the signal irrelevant: a controlled consumer
   * bumps `topologyVersion` on every echoed keystroke, and committing a fresh element set for each
   * of those would tear down the `<input>` the person is typing into, mid-word.
   */
  useLayoutEffect(() => {
    const recompute = () => {
      const s = store.getState();
      const entity = entityId ? s.entityMap.get(entityId) : undefined;
      const next = entity
        ? listEntityWidgets(entity, socketTypes, s.connectedSockets, widgetTypes)
        : NO_ENTRIES;
      const nextLabel = entity ? entityLabel(entity) : '';
      const current = modelRef.current;
      const same = sameMirrorShape(current.entries, next);
      if (same && current.label === nextLabel) return;
      // The existing array is kept when the shape matches, so a label change alone does not hand
      // React a new list and remount every control under it.
      setModel({ entries: same ? current.entries : next, label: nextLabel });
    };
    recompute();
    return store.subscribe(
      (s) => ({ topology: s.topologyVersion, connected: s.connectedSockets }),
      recompute,
      { equalityFn: shallow }
    );
  }, [store, entityId, socketTypes, widgetTypes]);

  /**
   * What is actually rendered: the entries minus the one under an open borrowed input.
   *
   * Filtered here rather than inside `listEntityWidgets`, so opening and closing an edit does not
   * invalidate the whole set — only the one element leaves and comes back.
   */
  const visible = useMemo(
    () => (editingSocketId === null ? entries : entries.filter((e) => e.socketId !== editingSocketId)),
    [entries, editingSocketId]
  );

  /**
   * Each control's live value, written imperatively and batched into one microtask.
   *
   * Modelled on CommentsContainer's `updateComments`: a subscriber marks work pending and a
   * microtask does it once, so a burst of store writes costs one pass. The pass walks ONE
   * entity's sockets, allocates nothing, and compares before it writes — a value that has not
   * moved costs a read.
   *
   * The `activeElement` skip is load-bearing. Assigning `.value` to a focused text field moves
   * the caret to the end, so a consumer echoing a keystroke back would reverse-type whatever
   * anyone entered — the same class of defect as the "only the last character survived" bug D7
   * records for the borrowed input.
   */
  const syncValues = useCallback(() => {
    const s = store.getState();
    const entity = entityId ? s.entityMap.get(entityId) : undefined;
    if (!entity) return;
    const bag = valueBag(entity);
    for (const entry of visible) {
      const el = elsRef.current.get(entry.socketId);
      if (!el) continue;
      if (el === el.ownerDocument.activeElement) continue;
      const shown = readWidgetValue(
        s.widgetValues,
        widgetKey(entity.id, entry.socketId),
        bag?.[entry.socketId] ?? entry.config.defaultValue
      );
      if (entry.config.type === 'checkbox') {
        if (el instanceof HTMLInputElement) {
          const next = Boolean(shown);
          if (el.checked !== next) el.checked = next;
        }
        continue;
      }
      // Normalised so the comparison reaches a fixed point after one write — see
      // mirrorDisplayValue for the three ways a browser silently rewrites what you assign.
      const next = mirrorDisplayValue(entry.config, shown);
      if (el.value !== next) el.value = next;
    }
  }, [store, entityId, visible]);

  useLayoutEffect(() => {
    let pending = false;
    const run = () => {
      pending = false;
      syncValues();
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(run);
    };
    // Once now, so the elements this commit created are filled before anything reads them.
    syncValues();
    const unsubs = [
      // What the person just set, ahead of the consumer echoing it — the same signal the GL
      // widget layer repaints on.
      store.subscribe((s) => s.widgetValuesVersion, schedule),
      // The consumer's echo. `setEntities` bumps this unconditionally, so a data-only change
      // arrives here; the known gap widgets-layer.tsx documents applies equally, and equally
      // needs someone driving `applyEntityChanges` directly through the exported store API.
      store.subscribe((s) => s.topologyVersion, schedule),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [store, syncValues]);

  /**
   * One handler for the whole group rather than a closure per control.
   *
   * React's `change` is a bubbling synthetic event, so the group can answer all of them and read
   * which socket from the element's own data attribute. The value each kind sends matches what
   * the POINTER path sends for the same widget — a boolean for a checkbox, a number for a slider,
   * `''` or a number for a number field — because both leave through `emitWidgetChange`, and a
   * keyboard press that wrote the string "0.5" where a drag writes 0.5 would hand the consumer
   * two different types for one socket.
   */
  const handleChange = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const el = e.target;
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLSelectElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      const socketId = el.dataset.socketId;
      if (!entityId || !socketId) return;
      const entry = visible.find((en) => en.socketId === socketId);
      if (!entry) return;
      if (entry.config.type === 'checkbox' && el instanceof HTMLInputElement) {
        onChange(entityId, socketId, el.checked);
        return;
      }
      if (entry.config.type === 'slider') {
        onChange(entityId, socketId, Number(el.value));
        return;
      }
      if (entry.config.type === 'number') {
        onChange(entityId, socketId, el.value === '' ? '' : Number(el.value));
        return;
      }
      onChange(entityId, socketId, el.value);
    },
    [entityId, visible, onChange]
  );

  const focusAt = useCallback(
    (index: number) => {
      if (visible.length === 0) return;
      const n = ((index % visible.length) + visible.length) % visible.length;
      elsRef.current.get(visible[n].socketId)?.focus({ preventScroll: true });
    },
    [visible]
  );

  /**
   * Up and Down move between controls; Escape hands focus back to the canvas.
   *
   * DOWN AND UP RATHER THAN LEFT AND RIGHT as the primary axis, because a range input claims Left
   * and Right for its own value — intercepting them would take a slider's keyboard model away in
   * order to navigate past it. The current position is read from `document.activeElement` rather
   * than held in a ref, so it cannot drift out of step with where focus actually is.
   *
   * Every key stops here. The canvas keyboard is gated on the container itself holding focus, so
   * nothing would reach it anyway; this is the same explicit belt the borrowed input wears, for
   * the same reason — a stray Delete deleting the node being operated is the failure worth being
   * loud about.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const doc = groupRef.current?.ownerDocument;
      const active = doc?.activeElement;
      const at = visible.findIndex((en) => elsRef.current.get(en.socketId) === active);
      if (e.key === 'Escape') {
        e.preventDefault();
        const container = groupRef.current?.closest('[data-kookie-flow-container]');
        if (container instanceof HTMLElement) container.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusAt(at + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusAt(at < 0 ? visible.length - 1 : at - 1);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        focusAt(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        focusAt(visible.length - 1);
      }
    },
    [focusAt, visible]
  );

  /**
   * The cursor speaks.
   *
   * Moving `focusedEntityId` while real focus stays on the canvas container changes nothing a
   * screen reader would read — the graph is one element and it did not move. This is the smallest
   * honest fix: a polite live region, mounted for the life of the component so it is already in
   * the accessibility tree when its text changes, carrying the node's name and how many controls
   * it has. One text write per cursor move, never per frame.
   */
  const announcement = entityId && label ? `${label}, ${visible.length} controls` : '';

  return (
    <>
      <div role="status" aria-live="polite" style={SR_ONLY}>
        {announcement}
      </div>
      {entityId && visible.length > 0 ? (
        <div
          ref={groupRef}
          role="group"
          // The same attribute the dupe law scopes by, so two controls claiming one socket's name
          // inside one node fail there rather than reaching a person.
          data-entity-id={entityId}
          data-a11y-mirror-group=""
          aria-label={label}
          style={SR_ONLY}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        >
          {visible.map((entry) => (
            <MirrorControlElement
              key={entry.socketId}
              entry={entry}
              onMount={(el) => {
                if (el) elsRef.current.set(entry.socketId, el);
                else elsRef.current.delete(entry.socketId);
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * One control, chosen by widget kind.
 *
 * Uncontrolled on purpose: React renders the SHAPE and the sync effect above writes the value.
 * A controlled input here would need the entity's value as a prop, which would mean re-rendering
 * this whole subtree on every store write that touches it.
 */
function MirrorControlElement({
  entry,
  onMount,
}: {
  entry: MirrorEntry;
  onMount: (el: MirrorControl | null) => void;
}) {
  const { config, socketId, socketName } = entry;
  // Shared by every branch. `tabIndex: -1` is what keeps the graph to exactly one tab stop; see
  // the file docstring.
  const common = {
    'data-a11y-mirror': '',
    'data-socket-id': socketId,
    'aria-label': socketName,
    tabIndex: -1,
    style: SR_ONLY,
  };

  switch (config.type) {
    case 'checkbox':
      return <input {...common} ref={onMount} type="checkbox" />;
    case 'slider':
      return (
        <input
          {...common}
          ref={onMount}
          type="range"
          min={config.min ?? 0}
          max={config.max ?? 1}
          // `any` rather than a made-up step: an unstated step on a 0..1 range would otherwise
          // default to 1, which turns a continuous slider into a two-position switch.
          step={config.step ?? 'any'}
        />
      );
    case 'select':
      return (
        <select {...common} ref={onMount}>
          {/* A value the config does not offer must land somewhere: without this row the element
              reports '' and the person hears nothing rather than what the socket holds. */}
          <option value="">{config.placeholder ?? 'Select…'}</option>
          {(config.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'number':
      return <input {...common} ref={onMount} type="number" min={config.min} max={config.max} step={config.step} />;
    case 'color':
      // The OS picker opens at the focused element's rect, which here is a clipped pixel. Stated
      // rather than worked around: the alternative is un-clipping the element to its real box,
      // which would make it paint and be composited over the canvas — the cost this whole file
      // is shaped to avoid.
      return <input {...common} ref={onMount} type="color" />;
    case 'textarea':
      return <textarea {...common} ref={onMount} rows={config.rows ?? 2} placeholder={config.placeholder} />;
    case 'text':
      return <input {...common} ref={onMount} type="text" placeholder={config.placeholder} />;
  }
}
