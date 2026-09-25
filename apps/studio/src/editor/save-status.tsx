'use client';

import * as React from 'react';
import { Text } from '@kushagradhawan/kookie-ui-react';

import type { SaveStatus as Status, SaveStatusStore } from './use-autosave';

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The save line at the bottom of the canvas, muted, and the only thing that re-renders when a save
 * runs.
 *
 * The editor holds the canvas; a status kept in its state moved the whole tree through two more
 * renders per save, which landed mid-gesture for anyone still working. This subscribes instead.
 *
 * The store knows the state, not the time, so the time is noted here the moment a save lands.
 * Before the first save of the session there is no time to show, and the graph as opened is
 * already stored. A failure is not muted: it is the one state that asks for something.
 */
export function SaveStatus({ store }: { store: SaveStatusStore }) {
  const status = React.useSyncExternalStore(store.subscribe, store.get, () => 'saved' as const);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [was, setWas] = React.useState<Status>(status);
  if (status !== was) {
    setWas(status);
    if (status === 'saved') setSavedAt(new Date());
  }

  const failed = status === 'error' || status === 'stale';
  let words: string;
  if (status === 'error') words = 'Not saved';
  else if (status === 'stale') words = 'Changed elsewhere, reload to keep editing';
  else if (status === 'saving') words = 'Saving…';
  else if (savedAt) words = `Last saved at ${TIME.format(savedAt)}`;
  else words = 'All changes saved';

  return (
    <Text size="1" emphasis={failed ? 'medium' : 'quiet'} tone={failed ? 'destructive' : undefined} aria-live="polite">
      {words}
    </Text>
  );
}
