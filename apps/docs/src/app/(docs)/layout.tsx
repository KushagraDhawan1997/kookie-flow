import { DocsChrome } from "./docs-chrome";

/** The chrome lives in `docs-chrome.tsx` because `not-found.tsx` needs it too and cannot be
    in this route group — Next wraps an unmatched URL in the ROOT layout only. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsChrome>{children}</DocsChrome>;
}
