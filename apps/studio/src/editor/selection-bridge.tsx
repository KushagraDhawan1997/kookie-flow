'use client';

import * as React from 'react';
import { useFlowStoreApi } from '@kushagradhawan/kookie-flow';
import type { EditorBus } from './editor-bus';

/**
 * Selection lives in the flow store and is never reported through `onEntitiesChange` — a
 * thousand-node board must not re-render its owner on every click. This sits inside the canvas,
 * where the store is reachable, and hands each change to the bus for the panes outside.
 */
export function SelectionBridge({ bus }: { bus: EditorBus }) {
  const store = useFlowStoreApi();
  React.useEffect(() => {
    bus.setSelection(store.getState().selectedEntityIds);
    return store.subscribe(
      (state) => state.selectedEntityIds,
      (ids) => bus.setSelection(ids)
    );
  }, [store, bus]);
  return null;
}
