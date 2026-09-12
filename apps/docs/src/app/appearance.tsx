"use client";

/**
 * The client half of the appearance mechanism: a tiny external store over the same two
 * localStorage keys the pre-paint script reads (appearance-script.ts). The <html> element is
 * the single source of truth — the store only ever writes attributes there and persists the
 * choice; it never mirrors appearance into React state that could disagree with the DOM.
 *
 * `useSyncExternalStore` with a server snapshot of the defaults is what makes hydration safe:
 * the server renders the toggles in their "system"/"auto" position, and the first client
 * render corrects them without a mismatch error — the next-themes shape.
 */
import * as React from "react";

import { APPEARANCE_KEY, CONTRAST_KEY } from "./appearance-script";

export type AppearanceChoice = "system" | "light" | "dark";
export type ContrastChoice = "auto" | "normal" | "high";

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
 * Storage access, guarded — and the guard is not defensive habit, it is the difference
 * between a degraded preference and a dead site.
 *
 * Touching `localStorage` THROWS, rather than returning null, wherever the browser denies
 * site data: Safari's "Block all cookies", the Chrome/Firefox equivalents, enterprise
 * policy, a sandboxed frame. The readers below are the `getSnapshot` argument to
 * `useSyncExternalStore`, so they run during RENDER, on every route the header mounts on —
 * which is all of them. Unguarded, that throw escaped to Next's global error boundary and
 * replaced the whole document with "This page couldn't load", unrecoverable by reload.
 *
 * The asymmetry that let it ship: the pre-paint script (appearance-script.ts) has always
 * wrapped these same two reads in try/catch, so the half of the mechanism that fails SAFELY
 * was guarded and the half that kills the page was not. One mechanism, one rule.
 *
 * Degrading to "system"/"auto" is the right failure: matchMedia needs no storage, so a
 * visitor who cannot persist a choice still gets a correct appearance — they just cannot
 * override the OS.
 */
const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

/** Writes are guarded for the same reason and one more: a full quota throws here too, and
    persistence failing must never stop the change from being APPLIED (see the setters). */
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
 * Guarding the storage calls stops the crash but does not, on its own, make the toggle work
 * where storage is denied: the readers re-derive from storage, so a write that could not
 * persist is a write the next read cannot see, and clicking "Dark" changed nothing at all
 * for exactly the privacy-blocking visitors the guard was added for. Memory is the session's
 * truth; storage is how a session is remembered. A `storage` event clears it, because an
 * explicit change from another tab is newer than what this one last chose.
 */
let sessionAppearance: AppearanceChoice | null = null;
let sessionContrast: ContrastChoice | null = null;

const appearanceChoice = (): AppearanceChoice => {
  if (sessionAppearance) return sessionAppearance;
  const s = read(APPEARANCE_KEY);
  return s === "light" || s === "dark" ? s : "system";
};

const contrastChoice = (): ContrastChoice => {
  if (sessionContrast) return sessionContrast;
  const s = read(CONTRAST_KEY);
  return s === "high" || s === "normal" ? s : "auto";
};

/**
 * Re-derive the `<html>` attributes from storage + the platform — the script's logic, live.
 *
 * It is the store's half of a rule that has two implementations; the pre-paint script is the
 * other. Two readers of one state, so a change to either is a change to both.
 */
const apply = () => {
  const el = document.documentElement;
  const a = appearanceChoice();
  const dark = a === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : a === "dark";
  el.setAttribute("data-appearance", dark ? "dark" : "light");
  const c = contrastChoice();
  // `auto` removes the attribute rather than writing "normal": Theme's own rule — the
  // platform's `prefers-contrast: more` must still reach a page that never chose (§7).
  if (c === "auto") el.removeAttribute("data-contrast");
  else el.setAttribute("data-contrast", c);
};

/* Record the choice, persist it best-effort, then APPLY — in that order, and none of the
   three may be skipped by the failure of another. Unguarded, a throwing write skipped
   apply() and emit() entirely, so clicking "Dark" did nothing while "System" kept working
   (it takes the removeItem branch): a toggle that looks half-alive. Guarding alone was not
   enough either — apply() re-derives from storage, so a write that could not persist was
   invisible to the very next read, and the toggle stayed dead for exactly the visitors the
   guard was for. Hence the session override above. Applying is what the user asked for;
   persisting is what survives a reload, and losing the second must not cost the first. */
export function setAppearance(choice: AppearanceChoice) {
  sessionAppearance = choice;
  write(APPEARANCE_KEY, choice === "system" ? null : choice);
  apply();
  emit();
}

export function setContrast(choice: ContrastChoice) {
  sessionContrast = choice;
  write(CONTRAST_KEY, choice === "auto" ? null : choice);
  apply();
  emit();
}

export function useAppearance() {
  const choice = React.useSyncExternalStore(subscribe, appearanceChoice, () => "system" as const);
  const contrast = React.useSyncExternalStore(subscribe, contrastChoice, () => "auto" as const);

  // While the choice is "system", the OS can flip underneath us — track it live.
  React.useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (appearanceChoice() === "system") apply();
    };
    mq.addEventListener("change", onChange);
    // And the other tab is a second writer to the same storage. Without this a second open
    // tab keeps the old appearance forever AND misreports which chip is active, so clicking the
    // highlighted one writes the stale value back and reverts the first tab's choice.
    // `storage` fires only in the tabs that did not write, which is exactly the set that
    // needs to catch up.
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === CONTRAST_KEY || e.key === null) {
        // The other tab's choice is newer than this tab's — drop the session override so the
        // readers fall back through to what was actually stored.
        if (e.key !== CONTRAST_KEY) sessionAppearance = null;
        if (e.key !== APPEARANCE_KEY) sessionContrast = null;
        apply();
        emit();
      }
    };
    addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      removeEventListener("storage", onStorage);
    };
  }, []);

  return { choice, contrast };
}
