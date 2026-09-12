import { readFileSync } from "node:fs";
import path from "node:path";

import { Specimen } from "../../blocks/specimen";
import { EXAMPLES } from "../../examples";
import { CanvasGuard } from "./canvas-guard";

/**
 * A live specimen and its source, from ONE file.
 *
 * The component is imported and rendered; the same file is read off disk and shown. There is
 * no second copy of the code and therefore nothing to keep in step — the oldest failure a docs
 * site has, arriving in the one place it is guaranteed to meet it.
 */

/** Scoped to a subfolder deliberately: Turbopack traces the WHOLE project into the server
    bundle when it cannot statically bound a filesystem read (the same constraint `toc.ts`
    documents). */
const EXAMPLE_ROOT = path.join(process.cwd(), "src", "examples");

export const readExampleSource = (name: string): string =>
  readFileSync(path.join(EXAMPLE_ROOT, `${name}.tsx`), "utf8");

export type ExampleProps = {
  /** The example's file name, which is also its registry key — one convention rather than a
      mapping field, so there is no third place for the pairing to go wrong. */
  name: string;
  /** Hide the source. For a page that has already shown it and wants the specimen again. */
  quiet?: boolean;
};

/**
 * Does this example render its own PAPER at the root?
 *
 * Read off the source rather than declared beside it, because a flag would be a second home
 * for a fact the file already states, and the two would part company the first time an example
 * was rewritten. A regex can only be wrong by finding nothing, and finding nothing means
 * wrapping, which is the fault this exists to prevent.
 *
 * CARD, NOT SURFACE. The choice is CARD OR NO CARD and never card-or-something-else: a Surface
 * at the root exempted from the paper would land directly on the figure's own ground — a ground
 * inside a ground. A Surface inside a Card is fine — a ground on paper is an ordinary
 * arrangement.
 *
 * Composer stays: a composer IS a `.kui-surface` (§30 — a box that holds full-size controls is a
 * Card), so wrapping one puts a pane in a pane.
 */
export const rootsOwnPane = (source: string): boolean =>
  /return\s*\(\s*<(Card|Composer)\b/.test(source);

export async function Example({ name, quiet }: ExampleProps) {
  const Component = EXAMPLES[name];
  if (!Component) {
    // Loud rather than empty. A silently missing specimen is the failure mode this backstops,
    // for the moment between writing a page and writing the file.
    throw new Error(`No example named "${name}". Add src/examples/${name}.tsx and register it.`);
  }
  /* GUARDED, because every example here is a live canvas that would otherwise take the page's
     scroll. `canvas-guard.tsx` carries why, and why the fix lives here rather than in the file a
     reader copies. */
  const specimen = (
    <CanvasGuard>
      <Component />
    </CanvasGuard>
  );
  const source = readExampleSource(name);

  /* ONE FIGURE, ONE SURFACE. `Specimen` is the pairing as a block, so the shape is stated once
     and a consumer can copy it; what stays here is the only thing a copied file could not carry,
     which is the filesystem read.

     NO FILENAME. `examples/<name>.tsx` is a path in THIS repo: it tells a reader nothing about
     where the code goes in their app, and because a name is copyable, pressing it would put a
     useless string in their clipboard.

     The language label goes with it, by the same test: every fence that is not a shell command
     is tsx, and a label that is always true says nothing.

     `quiet` means the source is already on this page — a chapter that walks through the code
     below. It is still a FIGURE: the same ground, the same paper, the same centred stage, with
     the code half absent. Rendering the bare subject instead puts a component loose in the prose
     with no ground under it, which reads as a stray rather than as the thing the page is about. */
  if (quiet) {
    return (
      <Specimen sources={[]} pane={!rootsOwnPane(source)}>
        {specimen}
      </Specimen>
    );
  }

  /* UNLESS THE EXAMPLE BRINGS ITS OWN PANE. Derived from the source the component already reads
     rather than a flag beside it, so there is no second place for the answer to go stale. The
     block takes the ANSWER and never the source, which is what keeps it copyable. */
  return (
    <Specimen sources={[{ code: source, lang: "tsx" }]} pane={!rootsOwnPane(source)}>
      {specimen}
    </Specimen>
  );
}
