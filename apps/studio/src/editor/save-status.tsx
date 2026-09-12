'use client';

import * as React from 'react';
import { Text } from '@kookie-ui/react';

import type { SaveStatus, SaveStatusStore } from './use-autosave';

const WORDS: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Edited',
  saving: 'Saving…',
  error: 'Not saved',
  stale: 'Changed elsewhere — reload',
};

/**
 * The save word, and the only thing that re-renders when a save runs.
 *
 * The editor holds the canvas; a status kept in its state moved the whole tree through two more
 * renders per save, which landed mid-gesture for anyone still working. This subscribes instead.
 */
export function SaveStatus({ store }: { store: SaveStatusStore }) {
  const status = React.useSyncExternalStore(store.subscribe, store.get, () => 'saved' as const);
  return (
    <Text size="1" emphasis="quiet" aria-live="polite">
      {WORDS[status]}
    </Text>
  );
}
