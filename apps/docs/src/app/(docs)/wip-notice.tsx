"use client";

import * as React from "react";
import { ShellNotice } from "@kushagradhawan/kookie-ui-react";

import { WIP_NOTICE_ATTR, WIP_NOTICE_KEY, WIP_NOTICE_VERSION } from "./wip-notice-script";

/** The site-wide work-in-progress notice, in the Shell's notice row above everything (§29),
    until the first stable release.

    THE DISMISSAL IS THE SITE'S, in two halves. Storage remembers it across reloads, and the
    pre-paint script (wip-notice-script.ts) stamps `<html>` before first paint so prose.css hides
    the row before React runs. The server and the first client render both draw the notice, so
    hydration matches; the effect then unmounts it. A browser that refuses storage shows it on
    every load, which is the honest failure: a notice that cannot be remembered keeps being said. */
export function WipNotice() {
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (document.documentElement.hasAttribute(WIP_NOTICE_ATTR)) setDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <ShellNotice
      tone="warning"
      className="docs-wip-notice"
      dismissLabel="Dismiss the work-in-progress notice"
      onDismiss={() => {
        try {
          localStorage.setItem(WIP_NOTICE_KEY, WIP_NOTICE_VERSION);
        } catch {
          // Storage refused: dismissed for this page view only.
        }
        setDismissed(true);
      }}
    >
      Kookie Flow is in active development and has not reached 1.0. The API and these docs can change
      without notice, so do not rely on it in production yet.
    </ShellNotice>
  );
}
