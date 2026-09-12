import Link from "next/link";
import { Grid, Heading, Link as KookieLink, Page, Stack, Text } from "@kookie-ui/react";

import { PageFrame } from "./page-frame";
import { SECTIONS, chaptersIn } from "./chapters";

/**
 * The front door.
 *
 * A title, one or two plain sentences, and then straight into WAYFINDING (Kushagra, holding the
 * front page up against Apple's HIG and Material's own: "I dont think What this design system
 * claims should be the first thing user sees, or am I wrong"). Both references say the same
 * thing: Apple's front pages are a heading, a sentence and a grid of real destinations, three
 * times down the page; Material's is a line and a Get started. Neither asks a visitor to agree
 * with anything before they have seen the thing itself.
 *
 * DUPLICATING THE NAVIGATION IS THE REFERENCE PATTERN rather than a fault. Apple's HIG has a
 * sidebar AND repeats the whole tree as tiles on its front page — a permanent nav is for
 * returning to a place, and a front-page index is for finding out what the places ARE.
 *
 * Composed under the house style: no more focal actions than the page has real ones (zero),
 * differentiated rhythm, the §15 type ladder, and no size 1 anywhere.
 *
 * THE LADDER IS `8 / 5 / 3`: title `8`, section `5`, body `3`. §15's house ladder is written
 * for a composed app surface — a card in a pane, a heading over a form — where the steps sit
 * close together and nothing separates them. A document puts a deck, a section break and 48px
 * of nothing between each rung, and at that spacing one step of the ramp is not a rank a reader
 * can see.
 *
 * DISTANCE CARRIES THE GROUPING. No cards around the groups and no separators between them:
 * enclosure, a line and distance all saying one thing is what §15 asks us not to do.
 *
 * AND LINKS ARE LINKS. A button is a verb; a chapter is a place, and the thing that goes to a
 * place is a link.
 */
/**
 * 48rem, and it is a FLOOR, NOT A PREFERENCE: the index grid is what sets it. Two tracks at
 * `minmax(20rem, 1fr)` with a 32px gutter need 672px, and the frame is 768. Each column runs
 * about 45 characters a line, the bottom of the comfortable band — a section blurb is two
 * sentences rather than prose, which is what makes that liveable.
 *
 * `PageFrame` states that the width is the caller's, because the front door is not a chapter.
 */

/**
 * THE DEMOS ARE PLACES TOO, and they are the shortest demonstration of what the chapters claim.
 * They live outside the docs chrome on purpose — each is a full-window canvas — so they are not
 * chapters and not in `chapters.ts`, whose entries drive the sidebar; a section there would
 * invent a group the navigation does not have. A plain list here, because nothing derives them.
 */
const DEMOS: { href: string; label: string }[] = [
  { href: "/demo", label: "Playground" },
  { href: "/demo-evaluation", label: "Evaluation pipeline" },
  { href: "/demo-webgl", label: "WebGL benchmark" },
  { href: "/demo-header", label: "Header positions" },
];

export default function Home() {
  return (
    <PageFrame width="48rem">
      <Stack gap="10">
        {/* THE MASTHEAD: the title, then the deck. No mark above the title — the sidebar's
            masthead is three inches away and already carries it, and the footer signs the page
            off with the long form. */}
        <Page
          title="Kookie Flow"
          description="A node graph library for React that renders on the GPU. It keeps React Flow's ergonomics — entities, edges and a hook to hold them — and draws 50,000 nodes at 60fps with zero React re-renders while you pan, zoom and drag."
        />

        {/* NO HEADING OVER THIS. The grid is the whole page, and a heading over the only thing
            on a page is a second title for it.

            THE CELLS TAKE THE `h2`. Each cell IS a top-level section of this page, so each
            states `h2` and keeps its size: the level is the structure and the step is the look.

            `9` (48px) between rows against `7` (32px) between columns: a row break is a bigger
            gap than a column gutter or the grid reads as one wandering list, and both are clear
            of the `4` inside a cell by the two steps proximity asks for. */}
        <Stack gap="8">
          <Grid
            columns="repeat(auto-fit, minmax(20rem, 1fr))"
            gapX="7"
            gapY="9"
          >
            {SECTIONS.map((section) => {
              const chapters = chaptersIn(section.id);
              if (chapters.length === 0) return null;
              return (
                <Stack key={section.id} gap="4">
                  <Stack gap="3" className="kd-prose">
                    <Heading size="5" render={<h2 />}>
                      {section.title}
                    </Heading>
                    <Text size="3" emphasis="medium" render={<p />}>
                      {section.blurb}
                    </Text>
                  </Stack>
                  {/* ONE COLUMN. A section's chapters ARE a list, so it is a Stack and the
                      number of columns stops being a function of how much room the cell happens
                      to have.

                      `Row` reads wrong here: a row is a member of a LIST and its resting state
                      is transparent, so away from the panel a menu or a sidebar gives it, the
                      rows float as stray words with no affordance until the pointer arrives. A
                      chapter is a place and the thing that goes to a place is a link — which is
                      also the one spelling that says so while nobody is pointing at it. */}
                  <Stack gap="3" align="start">
                    {chapters.map((chapter) => (
                      <KookieLink
                        key={chapter.slug}
                        size="3"
                        render={<Link href={`/${chapter.slug}`} />}
                      >
                        {chapter.title}
                      </KookieLink>
                    ))}
                  </Stack>
                </Stack>
              );
            })}

            <Stack gap="4">
              <Stack gap="3" className="kd-prose">
                <Heading size="5" render={<h2 />}>
                  Live demos
                </Heading>
                <Text size="3" emphasis="medium" render={<p />}>
                  Open a full-window canvas and use the library the way an app
                  would. Each demo runs on the same package these pages document.
                </Text>
              </Stack>
              <Stack gap="3" align="start">
                {DEMOS.map((demo) => (
                  <KookieLink key={demo.href} size="3" render={<Link href={demo.href} />}>
                    {demo.label}
                  </KookieLink>
                ))}
              </Stack>
            </Stack>
          </Grid>
        </Stack>
      </Stack>
    </PageFrame>
  );
}
