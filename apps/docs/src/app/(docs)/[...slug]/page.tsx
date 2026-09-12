/**
 * One renderer over the chapter registry. Adding a chapter is adding a row and a file; no
 * page is ever written for it.
 *
 * The catch-all sits at the docs root, so it answers `/start/installation` and every other
 * `<section>/<name>` pair. The demo routes are static segments outside the docs group and win
 * over it, which is Next's own specificity rule and the reason they can render without the
 * chrome.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Box, Page } from "@kookie-ui/react";

import { ProseFlow } from "../../../mdx-components";
import { BY_SLUG, CHAPTERS } from "../chapters";
import { PageFrame } from "../page-frame";
import { chapterToc, type TocEntry } from "../toc";
import { TableOfContents } from "../../../blocks/table-of-contents";

export function generateStaticParams() {
  return CHAPTERS.map((chapter) => ({ slug: chapter.slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const chapter = BY_SLUG.get(slug.join("/"));
  if (!chapter) return {};
  // The title alone: the root layout's template appends the site name.
  return { title: chapter.title, description: chapter.blurb };
}

/**
 * "On this page", in the gutter the reading measure leaves over.
 *
 * THE BLOCK IS WHERE THE ARRANGEMENT LIVES. `blocks/table-of-contents.tsx` carries the rank,
 * the rail and the observer, and states in full why it is not a `NavTree` and why the current
 * item is marked the way `Tabs` marks one.
 *
 * WHAT STAYS HERE IS THE COLUMN, and the split is the block law's own line: a block may not
 * decide a distance. How wide this gutter is and where the two-column arrangement stops fitting
 * are measurements about this page's layout rather than about anything's box, so `prose.css`
 * states them on `kd-toc` and hands the class over.
 *
 * NOT in the Shell's inspector, which is the pane that looks like it should hold this. An
 * inspector rests closed by design — its `auto` means "closed until asked for" — and a table of
 * contents nobody opens is a table of contents nobody reads. It is also per-page state, and the
 * inspector lives in the layout. So it is a sticky aside inside the chapter's own two-column
 * flow, shown only where there is enough structure to be worth scanning.
 */
function OnThisPage({ entries }: { entries: TocEntry[] }) {
  if (entries.length < 3) return null;
  return (
    /* TWO ELEMENTS, because they hold two facts: the COLUMN is placed — out of the article's
       flow, at the pane's end, as tall as the chapter — and the nav inside it holds still while
       the page scrolls. One element cannot do both, since sticky is in-flow positioning. */
    <div className="kd-toc-column">
      <TableOfContents entries={entries} className="kd-toc" />
    </div>
  );
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const chapter = BY_SLUG.get(slug.join("/"));
  if (!chapter) notFound();

  const toc = chapterToc(chapter.source);
  const { Content } = chapter;

  return (
    /* ONE COLUMN, ONE WIDTH. The frame IS the measure, so the title, the deck, every figure
       and the footer under them all end where the sentences end. `prose.css` carries why the
       text is what gives.

       THE FRAME DOES NOT CARRY THE CONTENTS' COLUMN. The chapter reserves the table of
       contents' width on the end side and the frame centres in what is left, so this number is
       the reading measure and nothing else — and the reading column lands in the same place at
       every width. `prose.css` carries the reserve, the pin and the width where the arrangement
       stops fitting. */
    <Box className="kd-chapter">
      <PageFrame width="var(--kd-measure)">
        <Page
          title={chapter.title}
          description={chapter.blurb}
          style={{ minWidth: 0 }}
        >
          {/* No section name above the title: it would be an eyebrow, two elements doing one
              element's job, and the navigation already shows the section with the current
              chapter lit inside it.

              `kd-prose` for the reading measure alone: the deck is prose and belongs on the
              same column as the prose under it, and the class is where that width is stated. */}
          <ProseFlow>
            <Content />
          </ProseFlow>
        </Page>
      </PageFrame>
      <OnThisPage entries={toc} />
    </Box>
  );
}
