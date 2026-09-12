import { DocsChrome } from "./(docs)/docs-chrome";
import { NotFoundBody } from "./(docs)/not-found-body";

/**
 * The 404, and it exists for two reasons that turn out to be one.
 *
 * It wears the docs chrome EXPLICITLY (2026-08-08). Next matches an unmatched URL against no
 * segment, so it wraps this file in the root layout only — a `(site)` group layout never
 * reaches it. When the chrome moved into that group the 404 silently lost the header, the
 * page inset and the `<main>` landmark, and rendered flush in the viewport's top-left corner
 * with the heading's ascenders clipped. A route group is a layout boundary, not a place.
 *
 * Next serves a built-in not-found component when an app supplies none — and that component
 * injects `<style>body{color:#000;background:#fff}@media(prefers-color-scheme:dark){…}</style>`
 * into the body. Two consequences, both real. It re-decides appearance from the OS, which is
 * exactly the question this app answers from `<html data-appearance>`: a visitor who pinned
 * Dark on a light machine got a white page under a dark-mode header, with the wordmark and nav
 * near-white on white. And it is third-party UI — raw pixels this system did not paint — on a
 * route the app actually serves, which is the one thing the docs claim never happens.
 *
 * So the stance and the bug have the same fix, which is the sort of coincidence that means the
 * stance was load-bearing rather than decorative.
 *
 * AMENDED 2026-09-01: that reasoning covers a URL matching NOTHING, and there is a second case
 * it does not. A URL that matches `[...slug]` and then calls `notFound()` keeps every layout
 * above the boundary, so `(docs)/layout.tsx` has already drawn the chrome — and this file
 * drawing it again put a second whole shell inside the first. The body moved to
 * `not-found-body.tsx` and `(docs)/not-found.tsx` renders it bare; this one still wraps it,
 * because in ITS case nothing else will.
 */
export default function NotFound() {
  return (
    <DocsChrome>
      <NotFoundBody />
    </DocsChrome>
  );
}
