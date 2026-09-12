'use client';

import * as React from 'react';
import { useFlowStoreApi, type Viewport } from '@kushagradhawan/kookie-flow';

/** How long the view must hold still before it counts as somewhere the reader meant to be. */
const SETTLE_MS = 400;

/**
 * Where the reader is looking, saved with the graph.
 *
 * The viewport lives in the flow store and never reaches React — that is what makes a pan cost
 * nothing — so autosave cannot see it, and panning to a corner of a board was forgotten by the
 * next visit. This sits inside the canvas, where the store is reachable, and reports only once
 * the view has settled: during the gesture it does nothing at all.
 */
export function ViewportBridge({ onViewport }: { onViewport: (viewport: Viewport) => void }) {
  const store = useFlowStoreApi();
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.subscribe(
      (state) => state.viewport,
      (viewport) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          onViewport(viewport);
        }, SETTLE_MS);
      }
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, onViewport]);
  return null;
}
