'use client';

import { Button } from '@kookie-ui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';

import { setAppearance, resolvedAppearance } from './appearance';

/**
 * The appearance toggle.
 *
 * v2's `useTheme()` is READ-ONLY — it reports what the nearest Theme resolved and has no
 * `onAppearanceChange` — because the mode lives on <html>, written by the pre-paint script
 * and the store in `appearance.tsx`. So this button writes through the store rather than
 * through context, and the old DOM-walking fallback (`document.querySelectorAll('.radix-themes')`)
 * is gone with it: there is one element to write and the store owns it.
 *
 * That single source of truth is what kookie-flow's WebGL layer depends on. It reads the
 * resolved `--neutral-*` tokens off the theme root, so a toggle that wrote appearance to some
 * elements and not others would leave the canvas painting the previous mode.
 *
 * THIS COMPONENT RENDERS THE SAME MARKUP ON THE SERVER AND THE CLIENT, ALWAYS, and that is what
 * this file is really about. It used to choose one icon:
 *
 *     const isDark = choice === 'system'
 *       ? typeof window !== 'undefined' && document.documentElement.getAttribute(...) === 'dark'
 *       : choice === 'dark';
 *
 * which is literally the `typeof window !== 'undefined'` branch React's hydration error text
 * names. The store's server snapshot is "system" and React 19 uses the server snapshot for the
 * HYDRATION render too, so `choice` matched on both sides — but `typeof window` did not, and by
 * hydration time the pre-paint script had already stamped `data-appearance="dark"` on <html>.
 * The server emitted a moon and the client's first render produced a sun: two different `<path
 * d>` values inside a hydrating `<button>`, which is a hard mismatch, and this toggle sits in the
 * shared chrome so it fired on every route in dark mode. A comment here claimed
 * `useSyncExternalStore` made it safe; it could not, because the read went around the store
 * straight to the DOM.
 *
 * Both icons are rendered and CSS picks, keyed on the same `<html data-appearance>` the script
 * writes. There is nothing left for hydration to diff, and no flash, because the correct icon is
 * chosen by the stylesheet before the first paint rather than by a client render after it. The
 * label has to be appearance-independent for the same reason, so it names the action rather than
 * the destination — which is also what a screen-reader user is better served by on a control
 * whose current state they cannot see.
 */
export function DarkModeToggle() {
  return (
    <Button
      iconOnly
      emphasis="quiet"
      tone="neutral"
      onClick={() => setAppearance(resolvedAppearance() === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle light or dark appearance"
    >
      <span className="appearance-icon appearance-icon--light">
        <HugeiconsIcon icon={Moon02Icon} strokeWidth={1.75} />
      </span>
      <span className="appearance-icon appearance-icon--dark">
        <HugeiconsIcon icon={Sun03Icon} strokeWidth={1.75} />
      </span>
    </Button>
  );
}
