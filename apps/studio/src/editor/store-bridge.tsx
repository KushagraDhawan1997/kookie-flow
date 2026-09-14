'use client';

import * as React from 'react';
import { useFlowStoreApi } from '@kushagradhawan/kookie-flow';

export type FlowStoreApi = ReturnType<typeof useFlowStoreApi>;

/**
 * The store is reachable only inside the canvas, and the right-click handler sits on the element
 * around it. This hands the store out, so the handler reads what is under the pointer once per
 * right-click, rather than a subscription copying it out on every write to the store.
 */
export function StoreBridge({ storeRef }: { storeRef: React.RefObject<FlowStoreApi | null> }) {
  const store = useFlowStoreApi();
  React.useEffect(() => {
    storeRef.current = store;
    return () => {
      storeRef.current = null;
    };
  }, [store, storeRef]);
  return null;
}
