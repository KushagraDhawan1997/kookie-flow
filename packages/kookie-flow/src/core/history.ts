/**
 * Undo, and what counts as a step.
 *
 * The hard part of undo is never the stack — it is deciding what one press should take back.
 * Nobody wants to press it four hundred times to unwind a slider drag, and nobody wants one press
 * to unwind a slider drag AND the three nodes they moved before it. So this file is mostly two
 * questions:
 *
 *   IS THIS WORTH REMEMBERING? Selecting a node is not an edit. Neither is hovering, focusing, or
 *   the frame-by-frame reporting of a gesture still in progress. Recording those fills the stack
 *   with steps that look like nothing happening when they are undone, which is how undo stops
 *   being trusted.
 *
 *   IS THIS THE SAME EDIT AS THE LAST ONE? Dragging a slider is one edit, however many values it
 *   passes through. Two edits of the same kind, on the same things, close together in time, are
 *   folded into one entry — the rule every editor uses, and the reason `coalesceKey` exists.
 *
 * Pure and time-injected, so both questions are answered in tests rather than in a browser.
 */

import type { Edge, EdgeChange, Entity, EntityChange } from '../types';

/** One point in time: the whole graph, as data. */
export interface HistoryEntry {
  entities: Entity[];
  edges: Edge[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** What the last recorded entry was an edit OF, and when — for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

/** How many steps back a person can go. Fifty is what a person can remember doing. */
export const DEFAULT_HISTORY_LIMIT = 50;

/**
 * How long two edits of the same kind stay one edit.
 *
 * Long enough to cover the gap between two keystrokes or two frames of a drag, short enough that
 * coming back to a control after a moment's thought starts a new step.
 */
export const COALESCE_MS = 600;

export function emptyHistory(): HistoryState {
  return { past: [], future: [], lastKey: null, lastAt: 0 };
}

/**
 * Whether a batch of changes is an edit at all.
 *
 * Selection is not: it is where you are, not what the graph is. A batch that is nothing but
 * selection — which is most batches, since every click emits one — must leave the stack alone.
 */
export function isEdit(changes: readonly (EntityChange | EdgeChange)[]): boolean {
  for (const change of changes) {
    if (change.type !== 'select') return true;
  }
  return false;
}

/**
 * A name for what this batch edits, or null if it should not be coalesced with anything.
 *
 * Two batches with the same key, close enough in time, are one step. Position and data changes
 * are the two that arrive in streams — a drag, a slider, a text edit — and both are keyed by the
 * ids they touch, so moving node A and then node B are two steps rather than one.
 *
 * Adds and removes are never coalesced: each one is a thing that happened.
 */
export function coalesceKey(changes: readonly (EntityChange | EdgeChange)[]): string | null {
  let kind: string | null = null;
  const ids: string[] = [];
  for (const change of changes) {
    if (change.type === 'select') continue;
    if (change.type !== 'position' && change.type !== 'data' && change.type !== 'dimensions') {
      return null;
    }
    if (kind !== null && kind !== change.type) return null;
    kind = change.type;
    ids.push(change.id);
  }
  if (kind === null) return null;
  ids.sort();
  return `${kind}:${ids.join(',')}`;
}

/**
 * Remember where the graph was BEFORE a batch is applied.
 *
 * Before rather than after, because undo means "put it back the way it was", and the way it was
 * is what we are holding at the moment the change arrives.
 */
export function record(
  state: HistoryState,
  before: HistoryEntry,
  key: string | null,
  now: number,
  limit: number = DEFAULT_HISTORY_LIMIT
): HistoryState {
  // The same edit, still going: the entry already on the stack is the one to keep, because it
  // holds where the graph was before the whole gesture rather than before its last frame.
  if (key !== null && key === state.lastKey && now - state.lastAt < COALESCE_MS) {
    return { ...state, lastAt: now, future: [] };
  }
  const past = state.past.length >= limit
    ? [...state.past.slice(state.past.length - limit + 1), before]
    : [...state.past, before];
  // Anything you do after undoing abandons what you had undone. Every editor works this way, and
  // the alternative — keeping both branches — is a tree nobody has ever wanted to navigate.
  return { past, future: [], lastKey: key, lastAt: now };
}

export interface HistoryStep {
  state: HistoryState;
  restored: HistoryEntry;
}

/** Step back. `current` is where the graph is now, and becomes the redo entry. */
export function stepBack(state: HistoryState, current: HistoryEntry): HistoryStep | null {
  if (state.past.length === 0) return null;
  const restored = state.past[state.past.length - 1];
  return {
    state: {
      past: state.past.slice(0, -1),
      future: [current, ...state.future],
      // A step ends whatever gesture was being coalesced: the next edit is a new one.
      lastKey: null,
      lastAt: 0,
    },
    restored,
  };
}

/** Step forward again. */
export function stepForward(state: HistoryState, current: HistoryEntry): HistoryStep | null {
  if (state.future.length === 0) return null;
  const restored = state.future[0];
  return {
    state: {
      past: [...state.past, current],
      future: state.future.slice(1),
      lastKey: null,
      lastAt: 0,
    },
    restored,
  };
}
