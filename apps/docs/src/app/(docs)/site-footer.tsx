import Link from "next/link";

import { Surface } from "@kookie-ui/react";

import { Footer } from "../../blocks/footer";
import { CHAPTERS, SECTIONS } from "./chapters";
import { Wordmark } from "./wordmark";

/**
 * This site's own footer, and the footer block's first real consumer (2026-09-01, Kushagra:
 * "lets add footer to the pages, dogfood it, use the wordmark instead of raw name").
 *
 * DOGFOODING IN THE ONLY SENSE THAT COUNTS: it is the same block KookieUI's own docs sign off
 * with, with no docs-only variant beside it. What that already found is recorded in
 * `blocks/footer.tsx` — the resting ink was written in the block's stylesheet and lost to the
 * package's own `data-emphasis` rule, which a demo could have hidden and a real page did not.
 *
 * THE COLUMNS ARE THE NAVIGATION'S OWN DATA. Both this and the sidebar read `CHAPTERS` and
 * `SECTIONS`, so the footer cannot list a chapter that does not exist or miss one that does; a
 * hand-written list here would be the sidebar's contents in a second home, which is the fault
 * this repo spends most of its time removing. `Reference` is the one hand-written column,
 * because those destinations are not chapters and there is no list to derive them from.
 *
 * IT SITS ON A GROUND (2026-09-06, Kushagra: "Can we wrap our footer in Surface?"), which is the
 * block's own mechanism used exactly as written: the block draws no pane and says a footer that
 * wants one is `<Surface><Footer/></Surface>` at the call site, so this is one element here and
 * not a prop or a branch in `blocks/footer.tsx`.
 *
 * IT REVERSES WHAT THIS FILE SAID, and the argument it reverses was that a floor under a reading
 * column reads as one more card at the end of the article. Looked at, it does not: the ground is
 * a step UNDER the page rather than a card on it, so the footer reads as the page's floor and
 * the article stops where the pane starts — which is the one thing 40rem of unbounded links at
 * the end of a chapter never said. What is true of the old argument is that the pane now shares
 * its fill with the code wells above it, since `CodeBlock` is a `Surface` too; on a chapter dense
 * with samples the floor is the same material as the last three blocks over it. Stated rather
 * than defended: if that reads wrong, the repair is this one element, not a change in the block.
 *
 * WHERE IT RENDERS is `PageFrame`, not the chrome, and that is the whole reason this is a
 * component rather than four lines in `docs-chrome.tsx`. A footer hung in the pane would be the
 * one full-window block under a 40rem reading column — the mismatch Kushagra had just had fixed
 * one route over. Inside the frame it takes whatever measure the page states, so a chapter's
 * floor is the chapter's width and the front door's is the front door's, with nothing here
 * knowing either number.
 */
export function SiteFooter() {
  const groups = SECTIONS.map((section) => ({
    title: section.title,
    links: CHAPTERS.filter((chapter) => chapter.section === section.id).map((chapter) => ({
      label: chapter.title,
      href: `/${chapter.slug}`,
    })),
  })).filter((section) => section.links.length > 0);

  return (
    /* IT TAKES THE PAGE'S APPEARANCE. A pinned `appearance="dark"` stood here for a day and is
       gone: a floor that is dark while the page above it is light is a region that has stopped
       being the system, and the ground already says everything the pinned mode was saying — a
       step under the page, in whichever mode the reader chose. */
    <Surface>
      <Footer
        brand={
          /* The mark, not the word typed out again. `Wordmark` is where the face, the weight and
             the collapsed line box live; the link is the only fact that belongs to this
             placement, and the accessible name is the link's because the glyph is decoration
             doing a logo's job — the same arrangement the sidebar's header states. */
          <Link
            href="/"
            /* The NAME MATCHES WHAT IS DRAWN. The glyph is `aria-hidden`, so the link states the
               name — and a link whose visible words and announced name disagree is the failure
               SC 2.5.3 is about, even where the visible words are decoration. */
            aria-label="Kookie Flow"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {/* UP FROM THE MASTHEAD'S RATHER THAN DOWN (Kushagra: "its too small"). A footer
                signs a page off rather than heading it, but the masthead sits in a narrow
                sidebar and this sits in the page's own column, so the step that reads as a mark
                there reads as a caption here. */}
            <Wordmark form="full" size="8" />
          </Link>
        }
        groups={[
          ...groups,
          {
            title: "Reference",
            links: [
              { label: "Live demo", href: "/demo" },
              { label: "llms.txt", href: "/llms.txt" },
              { label: "GitHub", href: "https://github.com/KushagraDhawan1997/kookie-flow" },
            ],
          },
        ]}
        /* THE SIGN-OFF, in the quiet rung §15 minted for a fact about the page that is read
           once and never scanned. */
        note="MIT licensed. © 2026 Kushagra Dhawan."
      />
    </Surface>
  );
}
