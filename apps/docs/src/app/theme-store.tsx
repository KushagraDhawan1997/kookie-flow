"use client";

/**
 * The site's Theme axes as a store, and the root Theme that reads them (2026-09-08, Kushagra:
 * "give me a prop configurator for Theme somewhere… next to dark mode toggle").
 *
 * Appearance and contrast stay in `appearance.tsx`: they live on `<html>` for the pre-paint
 * script, and nothing here touches them. Every other axis is a prop on the root `<Theme>`, so
 * the panel writes here and `DocsTheme` re-renders the root with the choice. Same shape as the
 * appearance store: the session's truth is memory, storage is persistence, and a write that
 * cannot persist must never stop the change from being applied.
 *
 * The server snapshot is the site's own resting choice (`material="regular"`, `radius="full"`,
 * `size="2"`, the package defaults for the rest), so the first paint is what the root Theme
 * always rendered and a stored choice arrives after hydration — the window-class hook's own
 * honesty.
 */
import * as React from "react";
import { Theme, themeAxes, themeDefaults } from "@kookie-ui/react";

export type ThemeAxisKey = "density" | "radius" | "depth" | "material" | "size" | "pointer";
export type ThemeChoice = { [K in ThemeAxisKey]: (typeof themeAxes)[K][number] };

export const THEME_AXES: readonly ThemeAxisKey[] = ["size", "density", "radius", "depth", "material", "pointer"];

/** What the root Theme rendered before the panel existed, so the panel's "reset" is a real
    value. `radius="full"` and `material="regular"` are this app's identity. */
export const SITE_THEME: ThemeChoice = {
  density: themeDefaults.density,
  radius: "full",
  depth: themeDefaults.depth,
  material: "regular",
  size: "2",
  pointer: themeDefaults.pointer,
};

const KEY = "kookie-docs-theme";
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

let session: ThemeChoice | null = null;

const isValid = (key: ThemeAxisKey, value: unknown): boolean =>
  (themeAxes[key] as readonly string[]).includes(String(value));

/* The snapshot is CACHED in `session` after the first read: `useSyncExternalStore` compares
   snapshots by identity, and a fresh object per call is an infinite loop by definition (it
   was — "The result of getSnapshot should be cached"). Storage is read once, then the session
   is the truth until a setter replaces it. */
const read = (): ThemeChoice => {
  if (session) return session;
  let next: ThemeChoice = SITE_THEME;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeChoice>;
      const merged = { ...SITE_THEME };
      for (const key of THEME_AXES) {
        if (isValid(key, parsed[key])) (merged as Record<string, string>)[key] = parsed[key] as string;
      }
      next = merged;
    }
  } catch {
    /* an unreadable store is the site's own choice */
  }
  session = next;
  return session;
};

export function setThemeAxis<K extends ThemeAxisKey>(key: K, value: ThemeChoice[K]) {
  session = { ...read(), [key]: value };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(session));
  } catch {
    /* persistence is optional; the choice above is not */
  }
  emit();
}

export function resetTheme() {
  session = { ...SITE_THEME };
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* see above */
  }
  emit();
}

export function useThemeChoice(): ThemeChoice {
  return React.useSyncExternalStore(subscribe, read, () => SITE_THEME);
}

/** The root scope, reading the store. `appearance="inherit"` is the dark-SSR design (layout.tsx). */
export function DocsTheme({ children }: { children: React.ReactNode }) {
  const choice = useThemeChoice();
  return (
    <Theme appearance="inherit" {...choice}>
      {children}
    </Theme>
  );
}
