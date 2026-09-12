'use client';

import { Theme } from '@kookie-ui/react';

/**
 * The root scope. `appearance="inherit"`: the pre-paint script stamped the mode on <html>, and
 * the Theme stamps every other axis, so one element owns the mode and hydration cannot disagree
 * with it. The canvas reads its colours off this same scope.
 */
export function StudioTheme({ children }: { children: React.ReactNode }) {
  return (
    <Theme appearance="inherit" material="regular" radius="large" size="2">
      {children}
    </Theme>
  );
}
