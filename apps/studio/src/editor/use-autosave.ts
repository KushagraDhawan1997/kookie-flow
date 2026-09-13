'use client';

import * as React from 'react';
import type { Edge, Entity, KookieFlowInstance, Viewport } from '@kushagradhawan/kookie-flow';
import {
  DEFAULT_VIEWPORT,
  documentFingerprint,
  parseDocument,
  registry,
  stripResolved,
  type GraphDocument,
} from 'studio-core';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'stale';

/** The save state, readable without holding it in the editor's own render. */
export interface SaveStatusStore {
  subscribe(listener: () => void): () => void;
  get(): SaveStatus;
}

/** A graph as a page last had it, in the stored form. */
export interface CarriedGraph {
  name: string;
  doc: GraphDocument;
}

export interface Autosave {
  status: SaveStatusStore;
  /** The view moved. Saved with everything else, once it settles. */
  noteViewport(viewport: Viewport): void;
  /**
   * What this tab last had, when the page was rendered before that reached the server. The editor
   * opens on this rather than on the render. Null unless a reload outran the last save.
   */
  carried: CarriedGraph | null;
}

const DEBOUNCE_MS = 800;
const RETRY_MS = 4000;
/** Writes remembered as unanswered. A burst of reloads needs a few; each is about thirty bytes. */
const MAX_UNCONFIRMED = 16;

/**
 * Save the graph after it stops changing.
 *
 * It watches the React state `useGraph` holds — entities, edges, the name — which settles at the
 * end of a gesture rather than during it, so nothing here runs per frame.
 *
 * THE STATUS IS NOT REACT STATE. Every save used to move the editor through two more renders,
 * landing mid-pan for anyone who kept working; only one line of text actually changes, so the
 * status lives in a store and the one component that shows it subscribes.
 *
 * THE SNAPSHOT IS TAKEN WHILE THE CANVAS IS ALIVE. React detaches the imperative handle in the
 * mutation phase, before this hook's cleanup runs, so a flush that reaches for the canvas at
 * unmount finds nothing and sends nothing — every edit made in the last debounce window was lost
 * by clicking a link. The document is built from the state this hook already has, plus the last
 * viewport the canvas reported.
 *
 * A SAVE IS COMPARED AGAINST WHAT THE SERVER HOLDS. Counting effect runs cannot tell an edit from
 * a remount: strict mode and Fast Refresh both re-run the effect, and merely opening a graph used
 * to write it back. Comparing the serialised document against the last one known to be stored
 * answers the real question, and makes an edit-then-undo inside one window write nothing.
 *
 * EVERY WRITE CARRIES THE REVISION IT IS BASED ON. One request at a time, because two overlapping
 * PUTs can land out of order and the older one wins; and a write the server refuses as stale stops
 * the loop rather than retrying, because retrying would overwrite whatever the other writer did.
 *
 * A RELOAD RENDERS THE NEW PAGE BEFORE THE OLD PAGE'S LAST SAVE ARRIVES. The old page sends that
 * save as it closes, and a reload closes it only once the server has rendered the new one. So the
 * new page opened a revision behind and without the last edits, and its first save was refused as
 * if another tab had written. The old page now also leaves its graph in session storage, with a
 * fingerprint of every write it never heard back about. The new page opens on that graph when its
 * render is this tab's own history, and its saves name those fingerprints: the server lets a save
 * land over a document it names, and still refuses one that anybody else wrote.
 */
export function useAutosave(
  id: string,
  entities: Entity[],
  edges: Edge[],
  name: string,
  flowRef: React.RefObject<KookieFlowInstance | null>,
  initial: GraphDocument,
  initialRevision: number
): Autosave {
  // What is stored is the graph, not the catalog: the sockets, sizes and labels the type table
  // filled in are dropped on the way out and filled in again on the way back.
  const serialise = React.useCallback(
    (doc: { entities: Entity[]; edges: Edge[]; viewport: Viewport }, graphName: string) =>
      JSON.stringify({
        name: graphName,
        doc: { version: 1, ...stripResolved(doc.entities, doc.edges, registry), viewport: doc.viewport },
      }),
    []
  );

  const listeners = React.useRef(new Set<() => void>());
  const statusRef = React.useRef<SaveStatus>('saved');
  const status = React.useMemo<SaveStatusStore>(
    () => ({
      subscribe: (listener: () => void) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      get: () => statusRef.current,
    }),
    []
  );
  const setStatus = React.useCallback((next: SaveStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    for (const listener of listeners.current) listener();
  }, []);

  // What the page before this one in the tab left behind. Read during the first render so the
  // editor can open on it; the server has no session storage, and nothing read here is rendered.
  const [inherited] = React.useState(() => inherit(id, initial, initialRevision, name));

  // What the server is believed to hold. Seeded from the document this editor opened with, so a
  // mount — first, doubled by strict mode, or repeated by Fast Refresh — writes nothing. Serialised
  // once: a ref's argument is evaluated on every render, and this one walks the whole graph.
  const [seed] = React.useState(() =>
    serialise({ entities: initial.entities, edges: initial.edges, viewport: initial.viewport }, name)
  );
  const savedJson = React.useRef(seed);
  const pendingJson = React.useRef<string | null>(null);
  const revision = React.useRef(initialRevision);
  const viewport = React.useRef<Viewport>(initial.viewport ?? DEFAULT_VIEWPORT);
  const latest = React.useRef({ entities, edges, name });
  const inFlight = React.useRef(false);
  /** The document the request in flight carries. It can land even when no answer comes back. */
  const inFlightJson = React.useRef<string | null>(null);
  const stopped = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Fingerprints of documents this tab sent without hearing back. Every save names them. */
  const unconfirmed = React.useRef<string[]>(inherited.unconfirmed);
  /** Session storage holds a handover for this graph, which the next confirmed save clears. */
  const handedOver = React.useRef(inherited.handover === 'ours');

  // A handover overtaken by someone else's write must not linger: were the graph ever to return to
  // a document it names, that document would be taken for this tab's own.
  React.useEffect(() => {
    if (inherited.handover === 'stray') clearHandover(id);
  }, [id, inherited]);

  /** A request body: the document, the revision it is based on, and the writes it may land over. */
  const bodyFor = React.useCallback((json: string) => {
    const supersedes = unconfirmed.current;
    return JSON.stringify({
      ...JSON.parse(json),
      revision: revision.current,
      ...(supersedes.length > 0 ? { supersedes } : {}),
    });
  }, []);

  /** Count a document as sent without an answer, so a later save may land over it. */
  const remember = React.useCallback((json: string) => {
    const graph = readGraph(json);
    if (!graph) return;
    const fingerprint = documentFingerprint(graph.doc);
    const kept = unconfirmed.current.filter((known) => known !== fingerprint);
    kept.push(fingerprint);
    unconfirmed.current = kept.slice(-MAX_UNCONFIRMED);
  }, []);

  /**
   * Leave the graph for the next page in this tab, in case that page is rendered before the save
   * gets there. A request already in flight counts as unanswered too: it can land late just as well.
   */
  const handOver = React.useCallback(
    (json: string) => {
      if (inFlightJson.current !== null) remember(inFlightJson.current);
      remember(json);
      writeHandover(id, { revision: revision.current, body: json, unconfirmed: unconfirmed.current });
      handedOver.current = true;
    },
    [id, remember]
  );

  const save = React.useCallback(async () => {
    const json = pendingJson.current;
    if (json === null || inFlight.current || stopped.current) return;
    inFlight.current = true;
    inFlightJson.current = json;
    setStatus('saving');
    try {
      const res = await fetch(`/api/graphs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: bodyFor(json),
      });
      if (res.status === 409) {
        const body: unknown = await res.json().catch(() => null);
        // A warning, not an error: nothing in the code failed, and the status line already asks
        // for a reload.
        console.warn('[studio] this graph changed elsewhere; nothing was written', body);
        stopped.current = true;
        inFlight.current = false;
        inFlightJson.current = null;
        setStatus('stale');
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { revision?: number };
      if (typeof body.revision === 'number') revision.current = body.revision;
      savedJson.current = json;
      inFlightJson.current = null;
      // The server holds this tab's latest now. Nothing sent before it needs naming again, and the
      // next page has nothing to carry.
      unconfirmed.current = [];
      if (handedOver.current) {
        handedOver.current = false;
        clearHandover(id);
      }
      const more = pendingJson.current !== json;
      if (!more) pendingJson.current = null;
      setStatus(more ? 'dirty' : 'saved');
      inFlight.current = false;
      if (more) void save();
    } catch (error) {
      console.error('[studio] save failed', error);
      // The request may have reached the server before the answer was lost. If it did, the retry
      // is based on a revision that write moved past, and must be allowed over it.
      if (inFlightJson.current !== null) remember(inFlightJson.current);
      inFlightJson.current = null;
      inFlight.current = false;
      setStatus('error');
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => {
        retry.current = null;
        void save();
      }, RETRY_MS);
    }
  }, [id, setStatus, bodyFor, remember]);

  /** Take a document now and save it once things go quiet. */
  const schedule = React.useCallback(
    (json: string) => {
      if (json === savedJson.current && pendingJson.current === null) return;
      if (json === pendingJson.current) return;
      pendingJson.current = json;
      if (stopped.current) return;
      setStatus('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, DEBOUNCE_MS);
    },
    [save, setStatus]
  );

  React.useEffect(() => {
    latest.current = { entities, edges, name };
    const live = flowRef.current?.getViewport();
    if (live) viewport.current = live;
    schedule(serialise({ entities, edges, viewport: viewport.current }, name));
  }, [entities, edges, name, schedule, serialise, flowRef]);

  // A pan or a zoom changes nothing React holds, so it reaches here on its own — throttled by the
  // bridge inside the canvas, which reports only once the view has settled.
  const noteViewport = React.useCallback(
    (next: Viewport) => {
      viewport.current = next;
      const { entities: e, edges: g, name: n } = latest.current;
      schedule(serialise({ entities: e, edges: g, viewport: next }, n));
    },
    [schedule, serialise]
  );

  React.useEffect(() => {
    const onPageHide = () => {
      const json = pendingJson.current;
      if (json === null || json === savedJson.current || stopped.current) return;
      handOver(json);
      const url = `/api/graphs/${id}`;
      const body = bodyFor(json);
      // The route accepts POST as PUT, because a beacon can only POST. A document past the
      // beacon's size limit is refused outright, so fall back to a keepalive fetch.
      const queued = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      if (!queued) {
        void fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch((error: unknown) => console.error('[studio] final save failed', error));
      }
      // No answer will come. Should the page be shown again from the back-forward cache, the
      // fingerprint remembered by the handover lets its next save land over this one.
      savedJson.current = json;
    };
    addEventListener('pagehide', onPageHide);
    return () => {
      removeEventListener('pagehide', onPageHide);
      if (timer.current) clearTimeout(timer.current);
      if (retry.current) clearTimeout(retry.current);
      const json = pendingJson.current;
      if (json === null || json === savedJson.current || stopped.current) return;
      // An ordinary save, sent now instead of when the timer would have, and its answer read.
      // Strict mode and Fast Refresh run this cleanup and then the effect again on the same editor;
      // the beacon this used to send left that editor a revision behind its own write, and its next
      // save was refused.
      handOver(json);
      void save();
    };
  }, [id, bodyFor, handOver, save]);

  return React.useMemo(
    () => ({ status, noteViewport, carried: inherited.carried }),
    [status, noteViewport, inherited]
  );
}

/** What a page leaves for the next page in the same tab. */
interface Handover {
  /** The last revision the tab saw confirmed. */
  revision: number;
  /** The graph as the tab last had it: a serialised save body. */
  body: string;
  /** Fingerprints of every document the tab sent without hearing back. */
  unconfirmed: string[];
}

interface Inheritance {
  carried: CarriedGraph | null;
  unconfirmed: string[];
  /** `ours` is kept until a save confirms; `stray` was overtaken by someone else's write. */
  handover: 'none' | 'ours' | 'stray';
}

const handoverKey = (id: string) => `studio:handover:${id}`;

/**
 * Decide what the page before this one left: a graph to open on, only the writes it never heard
 * back about, or nothing of this tab's at all.
 *
 * The render is the tab's own history when it is the revision the last page had confirmed, or one
 * of the documents that page sent without an answer. Then what the tab last had is newer than the
 * render. Anything else was written by someone else after this tab, and it stands.
 */
function inherit(id: string, initial: GraphDocument, revision: number, name: string): Inheritance {
  const nothing: Inheritance = { carried: null, unconfirmed: [], handover: 'none' };
  if (typeof window === 'undefined') return nothing;
  const handover = readHandover(id);
  if (!handover) return nothing;

  let last: CarriedGraph | null = null;
  try {
    last = readGraph(handover.body);
  } catch (error) {
    console.warn('[studio] could not read the graph the last page left', error);
  }
  const rendered = documentFingerprint(initial);
  if (!last || (handover.revision !== revision && !handover.unconfirmed.includes(rendered))) {
    return { ...nothing, handover: 'stray' };
  }
  const same = last.name === name && documentFingerprint(last.doc) === rendered;
  return { carried: same ? null : last, unconfirmed: handover.unconfirmed, handover: 'ours' };
}

/** The name and document in a serialised save body, or null when it holds no graph. */
function readGraph(json: string): CarriedGraph | null {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return null;
  const { name, doc } = value as { name?: unknown; doc?: unknown };
  const graph = parseDocument(doc);
  return typeof name === 'string' && graph ? { name, doc: graph } : null;
}

function readHandover(id: string): Handover | null {
  try {
    const raw = sessionStorage.getItem(handoverKey(id));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { revision, body, unconfirmed } = value as Partial<Handover>;
    if (typeof revision !== 'number' || typeof body !== 'string' || !Array.isArray(unconfirmed)) return null;
    return { revision, body, unconfirmed: unconfirmed.filter((f) => typeof f === 'string') };
  } catch (error) {
    // Storage switched off, or a handover this version cannot read: the page opens on its render.
    console.warn('[studio] could not read what the last page left', error);
    return null;
  }
}

function writeHandover(id: string, handover: Handover): void {
  try {
    sessionStorage.setItem(handoverKey(id), JSON.stringify(handover));
  } catch (error) {
    // Storage off or full. The save itself still goes; only a reload that outruns it loses edits.
    console.warn('[studio] could not leave the graph for the next page', error);
  }
}

function clearHandover(id: string): void {
  try {
    sessionStorage.removeItem(handoverKey(id));
  } catch (error) {
    console.warn('[studio] could not clear what the last page left', error);
  }
}
