'use client';

/**
 * The client half of the appearance mechanism, ported from KookieUI v2's docs app and
 * trimmed to the one axis this site exposes.
 *
 * The <html> element is the single source of truth: this store only ever writes the
 * attribute there and persists the choice. It never mirrors appearance into React state
 * that could disagree with the DOM — which matters more here than on an ordinary site,
 * because kookie-flow reads the resolved tokens straight off that element into WebGL.
 *
 * `useSyncExternalStore` with a server snapshot of "system" is what makes hydration safe:
 * the server renders the toggle in its neutral position and the first client render corrects
 * it without a mismatch.
 */
import * as React from 'react';

import { APPEARANCE_KEY } from '../app/appearance-script';

export type AppearanceChoice = 'system' | 'light' | 'dark';

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const emit = () => {
  for (const l of listeners) l();
};

/**
 * Storage access, guarded — not defensive habit. Touching `localStorage` THROWS rather than
 * returning null wherever the browser denies site data (Safari's "Block all cookies",
 * enterprise policy, a sandboxed frame), and the reader below is the `getSnapshot` argument
 * to `useSyncExternalStore`, so it runs during render on every route the toggle mounts on.
 * Unguarded, that throw escapes to Next's error boundary and replaces the document.
 */
const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* the choice still applies for this page view; it just will not survive a reload */
  }
};

/**
 * The choice made in THIS page view, which outranks storage while it is set.
 *
 * Guarding the storage calls stops the crash but does not make the toggle work where storage
 * is denied: `apply()` re-derives from storage, so a write that could not persist is a write
 * the next read cannot see. Memory is the session's truth; storage is how a session is
 * remembered.
 */
let sessionAppearance: AppearanceChoice | null = null;

const appearanceChoice = (): AppearanceChoice => {
  if (sessionAppearance) return sessionAppearance;
  const s = read(APPEARANCE_KEY);
  return s === 'light' || s === 'dark' ? s : 'system';
};

/** Re-derive the `<html>` attribute from storage + the platform — the pre-paint script's
    logic, live. */
export const apply = () => {
  const el = document.documentElement;
  const a = appearanceChoice();
  const dark = a === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : a === 'dark';
  el.setAttribute('data-appearance', dark ? 'dark' : 'light');
};

/* Record the choice, persist it best-effort, then APPLY — in that order, and none of the
   three may be skipped by the failure of another. Applying is what the user asked for;
   persisting is what survives a reload, and losing the second must not cost the first. */
export function setAppearance(choice: AppearanceChoice) {
  sessionAppearance = choice;
  write(APPEARANCE_KEY, choice === 'system' ? null : choice);
  apply();
  emit();
}

export function useAppearance(): AppearanceChoice {
  const choice = React.useSyncExternalStore(
    subscribe,
    appearanceChoice,
    () => 'system' as const
  );

  React.useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    // While the choice is "system", the OS can flip underneath us.
    const onChange = () => {
      if (appearanceChoice() === 'system') apply();
    };
    mq.addEventListener('change', onChange);
    // The other tab is a second writer to the same key. `storage` fires only in the tabs that
    // did not write, which is exactly the set that needs to catch up.
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === null) {
        sessionAppearance = null;
        apply();
        emit();
      }
    };
    addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onChange);
      removeEventListener('storage', onStorage);
    };
  }, []);

  return choice;
}
