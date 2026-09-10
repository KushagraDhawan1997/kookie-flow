'use client';

import { Theme, TooltipProvider } from '@kookie-ui/react';

/**
 * The root scope, and only the scope.
 *
 * `appearance="inherit"` is the whole dark-mode design: this Theme stamps every axis EXCEPT
 * appearance, which lives on <html> where `appearanceScript` put it before first paint. One
 * element owns the mode, so the tokens kookie-flow reads into WebGL resolve against the same
 * scope the DOM does.
 *
 * v2 has one app-wide accent and derives its neutrals from it, so there is no `accentColor`
 * or `grayColor` here — a per-subtree accent would mean a per-subtree palette. `fontFamily`
 * is likewise gone: the type face is the app's to supply, and globals.css supplies it.
 *
 * `radius="full"` and `material="regular"` are the app's identity, stated once here rather
 * than on any control. Material is SELECTIVE, so `regular` costs nothing at rest: popups take
 * the glass by construction, a `backdrop`-marked region takes it, and every unmarked in-flow
 * control still resolves solid.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme appearance="inherit" material="regular" radius="full" size="2">
      <TooltipProvider>{children}</TooltipProvider>
    </Theme>
  );
}
