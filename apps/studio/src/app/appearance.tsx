'use client';

/**
 * The client half of the appearance mechanism: a small external store over the localStorage key
 * the pre-paint script reads. The <html> element is the single source of truth; the store writes
 * the attribute there and persists the choice, and never mirrors appearance into React state that
 * could disagree with the DOM.
 *
 * Storage access is guarded because a browser that blocks site data THROWS on it rather than
 * returning null, and these readers run during render — an unguarded throw took the whole page
 * down. The choice is also held in memory for the session, so a write that cannot persist still
 * changes the page: without that, the toggle did nothing at all for exactly the visitors the
 * guard was added for.
 */
import * as React from 'react';

import { APPEARANCE_KEY } from './appearance-script';

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

const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch (error) {
    console.warn('[studio] appearance could not be read from storage', error);
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch (error) {
    // The choice still applies to this page view; it just will not survive a reload.
    console.warn('[studio] appearance could not be saved', error);
  }
};

let sessionAppearance: AppearanceChoice | null = null;

const appearanceChoice = (): AppearanceChoice => {
  if (sessionAppearance) return sessionAppearance;
  const s = read(APPEARANCE_KEY);
  return s === 'light' || s === 'dark' ? s : 'system';
};

const apply = () => {
  const el = document.documentElement;
  const a = appearanceChoice();
  const dark = a === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : a === 'dark';
  el.setAttribute('data-appearance', dark ? 'dark' : 'light');
};

export function setAppearance(choice: AppearanceChoice) {
  sessionAppearance = choice;
  write(APPEARANCE_KEY, choice === 'system' ? null : choice);
  apply();
  emit();
}

export function useAppearance(): { choice: AppearanceChoice } {
  const choice = React.useSyncExternalStore(subscribe, appearanceChoice, () => 'system' as const);

  React.useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (appearanceChoice() === 'system') apply();
    };
    mq.addEventListener('change', onChange);
    // Another tab is a second writer to the same storage, and `storage` fires only in the tabs
    // that did not write — exactly the set that has to catch up.
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

  return { choice };
}
