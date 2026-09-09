'use client';

import { Button } from '@kookie-ui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';

import { setAppearance, useAppearance } from './appearance';

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
 */
export function DarkModeToggle() {
  const choice = useAppearance();

  // The server snapshot is "system", so the first paint shows the moon and the client
  // corrects it. There is no `mounted` gate: `useSyncExternalStore` makes that safe, and the
  // old gate rendered an empty 16x16 box on every server render.
  const isDark =
    choice === 'system'
      ? typeof window !== 'undefined' &&
        document.documentElement.getAttribute('data-appearance') === 'dark'
      : choice === 'dark';

  return (
    <Button
      iconOnly
      emphasis="quiet"
      tone="neutral"
      onClick={() => setAppearance(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <HugeiconsIcon icon={isDark ? Sun03Icon : Moon02Icon} strokeWidth={1.75} />
    </Button>
  );
}
