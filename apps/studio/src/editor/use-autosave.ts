'use client';

import * as React from 'react';
import type { Edge, Entity, KookieFlowInstance, Viewport } from '@kushagradhawan/kookie-flow';
import { DEFAULT_VIEWPORT, registry, stripResolved, type GraphDocument } from 'studio-core';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'stale';

/** The save state, readable without holding it in the editor's own render. */
export interface SaveStatusStore {
  subscribe(listener: () => void): () => void;
  get(): SaveStatus;
}

export interface Autosave {
  status: SaveStatusStore;
  /** The view moved. Saved with everything else, once it settles. */
  noteViewport(viewport: Viewport): void;
}

const DEBOUNCE_MS = 800;
const RETRY_MS = 4000;

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

  // What the server is believed to hold. Seeded from the document this editor opened with, so a
  // mount — first, doubled by strict mode, or repeated by Fast Refresh — writes nothing.
  const savedJson = React.useRef(
    serialise({ entities: initial.entities, edges: initial.edges, viewport: initial.viewport }, name)
  );
  const pendingJson = React.useRef<string | null>(null);
  const revision = React.useRef(initialRevision);
  const viewport = React.useRef<Viewport>(initial.viewport ?? DEFAULT_VIEWPORT);
  const latest = React.useRef({ entities, edges, name });
  const inFlight = React.useRef(false);
  const stopped = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = React.useCallback(async () => {
    const json = pendingJson.current;
    if (json === null || inFlight.current || stopped.current) return;
    inFlight.current = true;
    setStatus('saving');
    try {
      const res = await fetch(`/api/graphs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(json), revision: revision.current }),
      });
      if (res.status === 409) {
        const body: unknown = await res.json().catch(() => null);
        console.error('[studio] this graph changed elsewhere; nothing was written', body);
        stopped.current = true;
        inFlight.current = false;
        setStatus('stale');
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { revision?: number };
      if (typeof body.revision === 'number') revision.current = body.revision;
      savedJson.current = json;
      const more = pendingJson.current !== json;
      if (!more) pendingJson.current = null;
      setStatus(more ? 'dirty' : 'saved');
      inFlight.current = false;
      if (more) void save();
    } catch (error) {
      console.error('[studio] save failed', error);
      inFlight.current = false;
      setStatus('error');
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => {
        retry.current = null;
        void save();
      }, RETRY_MS);
    }
  }, [id, setStatus]);

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
    const flush = () => {
      const json = pendingJson.current;
      if (json === null || json === savedJson.current || stopped.current) return;
      const url = `/api/graphs/${id}`;
      const body = JSON.stringify({ ...JSON.parse(json), revision: revision.current });
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
      savedJson.current = json;
    };
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      if (timer.current) clearTimeout(timer.current);
      if (retry.current) clearTimeout(retry.current);
      flush();
    };
  }, [id]);

  return React.useMemo(() => ({ status, noteViewport }), [status, noteViewport]);
}
