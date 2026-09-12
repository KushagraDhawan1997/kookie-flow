/**
 * The docs site, in KookieUI's own Shell (§27).
 *
 * A docs site is the plainest thing an app frame is ever asked for: a navigation column, a
 * scrolling body, and a phone posture. Everything the reader sees here is a package export.
 *
 * NO HEADER (2026-08-26, Kushagra). The header's whole content was a wordmark, search and
 * two utilities — none of it about the page you are reading — so the row it occupied was
 * 100% chrome. The sidebar absorbs all of it through the Shell's own pinned-stack anatomy
 * (§27: siblings before a ShellScroll pin above it, siblings after pin below): the wordmark
 * and search are the sidebar's unofficial header, the GitHub link and the appearance Select
 * its unofficial footer. What the header used to guarantee — a route back to the sidebar
 * once it is closed or an overlay — moves to a trigger FLOATING in the content pane.
 *
 * The sidebar rests `auto` — open on a roomy window, an overlay on a narrow one, resolved in
 * CSS through §18's window class, so first paint is right with no script and hydration cannot
 * mismatch.
 *
 * A COMPONENT RATHER THAN THE LAYOUT ITSELF, because it has two callers Next will never let
 * share one: `layout.tsx` wraps the route group, and `not-found.tsx` cannot be in that group —
 * Next matches an unknown URL against no segment at all and wraps the root not-found in the
 * ROOT layout only. That is not hypothetical here: when the chrome last moved into a route
 * group (2026-08-08) the 404 was left behind and rendered with no header, no inset and no
 * `<main>` landmark, its heading flush in the viewport's corner with the ascenders clipped.
 * A route group is a layout boundary, not a place.
 */
import Link from "next/link";
import {
  Box,
  Flex,
  Shell,
  ShellContent,
  ShellPaneFooter,
  ShellPaneHeader,
  ShellScroll,
  ShellSidebar,
  ShellTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarOverflow,
  ToolbarTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kookie-ui/react";

import { AppearanceToggle } from "../appearance-toggle";
import { ThemePanel } from "../theme-panel";
import { PanelLeftIcon, XSocialIcon } from "../icons";
import { RepoLink } from "./repo-link";
import { CHAPTERS, READING_ORDER, SECTIONS } from "./chapters";
import { DocsPager } from "./docs-pager";
import { PageActions } from "./page-actions";
import { DocsNav, type NavSection } from "./docs-nav";
import { DocsSearch } from "./docs-search";
import { DocsTabBar } from "./docs-tab-bar";
import { PAGES } from "./markdown";
import { Wordmark } from "./wordmark";
import { buildSearchIndex } from "./search-index";
import "./prose.css";

/**
 * WHERE THIS PROJECT LIVES ELSEWHERE — one row in the sidebar's footer.
 *
 * A LIST rather than four hand-written blocks, for the reason every registry in this repo is
 * one: the four differ in three values and in nothing else, so writing them out four times is
 * three chances for one of them to drift from the others.
 */
/**
 * THE REPOSITORY, IN EVERY PAGE'S OWN BAND (2026-09-07, Kushagra: "every page's toolbar should
 * get github icon, it should not be in sidebar").
 *
 * It is not one of the socials, and moving it is what says so. X and Medium are places this
 * project is TALKED ABOUT; the repository is the project — it is what a reader of any page is
 * most likely to want next, and it is the one destination that is true of every route rather
 * than of the site as a whole. So it rides the content pane's band, which is the row that
 * belongs to the page you are on, and it is the only thing at that band's trailing edge on a
 * page with no twin.
 */
const GITHUB = {
  label: "GitHub",
  name: "Kookie Flow on GitHub",
  href: "https://github.com/KushagraDhawan1997/kookie-flow",
} as const;

/**
 * WHERE THIS PROJECT IS TALKED ABOUT — one row in the sidebar's footer.
 *
 * A LIST rather than hand-written blocks, for the reason every registry in this repo is one:
 * they differ in three values and in nothing else, so writing them out separately is a chance
 * for one of them to drift from the others.
 */
const SOCIALS = [
  {
    label: "X",
    name: "Kookie Flow on X",
    href: "https://x.com/kushagradhawan",
    Mark: XSocialIcon,
  },
  /* Discord and Medium were both here on 2026-09-07 and both came out the same day
     (Kushagra). The list is where this project actually lives elsewhere, so a destination that
     is not being kept is a link that sends a reader somewhere nobody is — worse than not
     offering it at all. The row is a list, so either comes back as one line. */
] as const;

export function DocsChrome({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    links: CHAPTERS.filter((chapter) => chapter.section === section.id).map(
      (chapter) => ({
        href: `/${chapter.slug}`,
        label: chapter.title,
      }),
    ),
  })).filter((section) => section.links.length > 0);

  return (
    // The frame takes the window; `100dvh` rather than `100vh` so a phone's collapsing
    // browser chrome does not leave the shell taller than the screen it is in.
    <Box style={{ blockSize: "100dvh" }}>
      {/* THE SIDEBAR'S WIDTH IS STATED ON THE FRAME, NOT ON THE PANE (2026-09-05). It was
          `width={336}` for a few hours, which is the one spelling §27 warns about: the frame
          builds `--kui-shell-inset-inline-start` — the reach this pane's floating chrome clears
          — from the TOKEN, and a `width` prop is an inline style on the pane that no sibling
          can read. Measured, the guard was firing in dev: 288px published against a 336px pane,
          so the search and back buttons sat 48px inside the sidebar they are meant to clear.
          Stating the token here is §27's own escape, where "the pane and the content read one
          number", and the drag now moves this same name (see the resize note in shell.tsx), so
          the two stay one number after the reader changes it too. */}
      <Shell style={{ "--shell-sidebar-w": "336px" } as React.CSSProperties}>
        {/* RESIZABLE, and the bounds are this site's content speaking (§27's own reason for a
            width prop). The floor is not the system's 160: a nav whose rows wrap and change
            height as you drag is a worse thing than a nav you cannot narrow. The ceiling is a reading site's: past ~420 the column is wider than most of
            what it indexes.

            No `onResize` and no persistence. The Shell sits in this route group's layout, so a
            dragged width survives every navigation and resets on reload — which is the honest
            behaviour until the site has somewhere to put the number. Persisting it is not a
            `localStorage` line: the pane would hydrate at its default and jump, so it wants the
            pre-paint script's treatment, the same one dark mode has. */}
        <ShellSidebar
          aria-label="Documentation"
          flush={true}
          resizable
          /* 336 SINCE 2026-09-05 (Kushagra: "much wider"), against the package's own 288 — the
             one number the app has to state, because §27's default is right for a library that
             does not know what the pane holds and this pane holds an index of the whole site.

             NOT A WRAPPING FIX. What the extra 48px buys is air after the longest title, and air
             after the words is what lets the indent read as nesting. It is a judgment, and the
             resize bounds are unchanged, so a reader who disagrees drags it.

             STATED ON THE `<Shell>` rather than here, and the reason is above it. */
          minWidth={240}
          maxWidth={420}
          /* The package default is "Resize panel", which is right for a library that does not
             know what the pane holds. This one holds the navigation, and there is only one. */
          resizeLabel="Resize navigation"
        >
          {/* The unofficial header — pinned above the scroller by position alone (§27's
              pinned-stack rule; no part names exist and none are needed).

              THE LOGO IS THE WORD. `wordmark.tsx` carries the reasoning; what is here is only
              the link that wraps it.

              THE ACCESSIBLE NAME IS THE LINK'S. The mark is decoration doing a logo's job and
              is `aria-hidden` either way, so the link states `aria-label` and a screen reader
              announces "Kookie Flow" — which is what keeps the one route back to the home page
              from announcing itself as a picture with no name.

              THE GLYPH ITSELF IS `<Wordmark>`, because the footer sets the same mark and the
              three facts that make it the mark — the face, the weight, the collapsed line box —
              cannot be copied to a second call site and stay one thing. Why each of them is what
              it is lives beside the component. What stays HERE is the only fact that is about
              this placement rather than the mark: the link. */}
          {/* One row, not two (2026-08-28) — search moved in beside the mark once it became
              an icon button rather than a full-width fake input, the same `Flex
              justify="space-between"` shape the footer row below already uses.

              THE ROW CENTRES ITSELF AGAIN (2026-09-01, Kushagra: the mark is "not center
              aligned with say, search"). Both children carried `alignSelf: "start"` from
              2026-08-29, and the reason was real THEN: the mark was a lone display capital
              whose line box towers over a 32px icon button, so centring the row sank the
              button against the GLYPH's height, below the collapse trigger floating in the
              content pane next door. Now the mark is a word rather than a display capital, so
              centring is what the eye wants and the overrides are gone rather than re-tuned:
              the part's own `align-items: center` places both children and nothing here
              restates it.

              THAT LEFT FOUR PIXELS, closed 2026-09-02: centring is only level with the pane
              next door while both rows are the same height, and the mark's own collapsed box
              was 40px against the row's 32, so the sidebar's band grew and took both of its
              children down with it. The mark's box is the row now — see `kd-masthead` below. */}
          {/* FLOATING since 2026-08-30 (Kushagra: "lets have content go behind logo header
              and light dark mode footer") — the pane's own chrome parts, shipped the day
              before. The rows pass behind this and behind the footer, the nav's scroller
              fades them out on the way (its `fade`), and the tree rests clear by spending
              the published reach — all three statements live in docs-nav.tsx. */}
          {/* The part IS the row (2026-08-30) — its children are clusters, never a
              full-width wrapper, because the floating band is transparent to the pointer
              and each child takes itself back: a wrapper spanning the row would swallow
              the clicks on the rows passing beneath. */}
          <ShellPaneHeader float>
            {/* A TOOLBAR SINCE 2026-09-06 (§45, Kushagra: "I want sidebar's toolbar at size
                3, is sidebar not using toolbar?" — it was not). The mark and the search are
                this pane's chrome, so the row states their rhythm and their index, and the
                band publishes its own row back to the pane so the frame's safe area follows
                the toolbar's own index (§27).

                NO `size="3"` HERE ANY MORE (same day). It was stated on both bands for a few
                hours, which is what said the default was wrong: a band rests one step above
                the app's own index now, so this row is 3 in an app resting at 2 and follows
                the app if it ever moves. A value repeated at every call site is not a default,
                it is a tax — the argument `Theme size` itself shipped on.

                `backdrop` ON THE ROW since the same day: the band floats, so content passes
                behind everything in it, and that is one fact about the space rather than a prop
                each control has to repeat. The row is still not a pane — it paints nothing —
                it just stops every button in it from restating what `float` already means. */}
            <Toolbar backdrop>
              {/* `kd-masthead` is the one placement fact: in a chrome row the mark's box is
                  the row, so it cannot grow the band and sink the search button below the
                  collapse trigger next door. prose.css carries the measurement. */}
              <Link
                href="/"
                aria-label="Kookie Flow"
                className="kd-masthead"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {/* STEP 6, not the default 8: "Kookie Flow" is two words against V2's one, and
                    at the sidebar's 240 floor step 6 is the largest that leaves the search
                    button inside the padding (measured 2026-09-11 in Inter: ink 24-160, button
                    175-215). Re-judge once Boska is in `public/fonts`. */}
                <Wordmark size="6" />
              </Link>
              <DocsSearch index={buildSearchIndex()} />
            </Toolbar>
          </ShellPaneHeader>

          {/* DocsNav renders its own ShellScroll as its root — wrapping it in another one
              here nested two scrollers: the inner took its content's height, never scrolled
              vertically, lost the bleed re-pad (15px of real x-overflow) and drew a
              horizontal bar over the footer. Measured 2026-08-26. The scroller must be the
              pane's DIRECT child for the pinned-stack and bleed machinery to see it. */}
          <DocsNav sections={sections} />

          {/* The footer, floating with the header — one posture for the pane's chrome.

              A TOOLBAR SINCE 2026-09-06 (§45, Kushagra: "there is no way these are size 3").
              They were not: a bare band hands its children the PANE's index, so these two rested
              at 2 while the masthead's row above them rested at 3 — and this file's own comment
              on the appearance control had claimed step 3 since 2026-09-05, which is doc-code
              drift a person caught by eye. A `Toolbar` is what states a band's index, so putting
              one here is the fix and the keyboard arrives with it: one tab stop for the row.

              BOTH CONTROLS ARE MARKS (same day: "lets use icon button for github. Same for dark
              or light mode"). A row of peers at the frame's edge is icon-only everywhere else on
              this site — the search above, the toggle and the way back in the content pane — and
              a word between two glyphs reads as a different kind of thing. The words survive in
              the tooltips and the accessible names. */}
          <ShellPaneFooter float>
            <Toolbar backdrop>
              {/* THE TOGGLE TAKES THE START AND THE SOCIALS THE END (2026-09-07, Kushagra:
                  "move socials to right"). A Toolbar is `space-between` and the caller supplies
                  what is split, so the order in this file IS the arrangement — nothing here
                  states an alignment. What sits where is a claim about what the row is for: the
                  control that acts on the page you are reading is the one you reach for, and the
                  links that leave the site rest at the far edge.

                  Outside the group on purpose: the toggle acts on THIS page rather than leaving
                  it, so it is not one of the same kind of thing. */}
              <Flex gap="2">
                <AppearanceToggle />
                {/* THE THEME PANEL BESIDE IT (2026-09-08): both act on the page you are reading,
                    so they cluster at the start; the panel holds every axis the toggle does not. */}
                <ThemePanel />
              </Flex>
              {/* A GROUP, NOT LOOSE BUTTONS (2026-09-07, Kushagra: "I need more social icons,
                  probably in toolbar group"). These do the same KIND of thing — each one leaves
                  the site for the same project somewhere else — and a `ToolbarGroup` is the part
                  that says so: one track, and the quiet rung arrives with it rather than being
                  stated per button. Separate round buttons beside one that switches the
                  appearance would read as peers, which is exactly what they are not. */}
              <ToolbarGroup>
                {SOCIALS.map((social) => (
                  <Tooltip key={social.label}>
                    <TooltipTrigger
                      render={
                        <ToolbarButton
                          iconOnly
                          aria-label={social.name}
                          render={<a href={social.href} />}
                        >
                          <social.Mark />
                        </ToolbarButton>
                      }
                    />
                    <TooltipContent>{social.label}</TooltipContent>
                  </Tooltip>
                ))}
              </ToolbarGroup>
            </Toolbar>
          </ShellPaneFooter>
        </ShellSidebar>

        {/* Tabs on a phone, nothing on a wide window (2026-09-09) — see docs-tab-bar.tsx. */}
        <DocsTabBar />

        {/* The shell rests at its default 2 (2026-08-26, Kushagra — it went to 3 for a day and
            came back; the pane states nothing and follows). The padding used to be a `p="6"`
            on a Box inside the scroller, which is the same distance said by hand — and said
            in the one place the pane's own padding could not reach it.

            `position: relative` is the trigger's containing block, stated inline because the
            shell root is the nearest positioned ancestor otherwise and the trigger would
            resolve its inset over the sidebar column, not this pane. */}
        <ShellContent style={{ position: "relative" }} flush={true}>
          {/* The route back to a closed or overlaying sidebar floats in the pane's own safe
              area — `--kui-sf-p` inherits from the pane deliberately (§10, the bleed
              mechanism), so the trigger sits exactly where pinned content would start.
              Out of flow, so the reading column never budges when the sidebar opens; above
              the chapters' own positioned content (the sticky TOC) by the z-index.

              PLUS THE SHELL'S OWN SAFE AREA (§27, 2026-08-29). The sidebar floats, so this
              pane's box starts at the window's edge and runs UNDER it — which is what lets a
              wide page bleed behind the nav, and what would otherwise put this button
              underneath it. `--kui-shell-inset-inline-start` is the reach the floating pane
              leaves, published by the frame and zero the moment the sidebar closes or
              overlays, so the button walks back to the pane's own corner with no branch
              here. */}
          {/* A MARKED PART since 2026-08-30, not a hand-positioned Box: the edge-bleed asks
              the DOM for the first child that takes no space, and it can only see the
              package's own vocabulary — the unmarked Box was blocking the reading column
              from scrolling to the pane's edge. The part carries the pane padding and the
              z-index the Box carried by hand; what stays here is only what is about this
              placement: clearing the floating sidebar by the frame's published reach. */}
          <ShellPaneHeader float>
            {/* A TOOLBAR SINCE 2026-09-06 (§45), and it deletes two hand-written facts. The row
                was a `Flex gap="2" align="center"` — a distance and an alignment said at a call
                site, which is what the component exists to end — and it carried an inline
                `marginInlineStart` to clear the floating sidebar, which `shell.css` now spends
                on the band itself: the frame publishes that reach, so nothing here restates it.

                What the row BUYS is the keyboard: one tab stop for the whole band, arrow keys
                between the controls, `role="toolbar"` announced. Every control in it is a
                `ToolbarButton` for that reason — a plain Button cannot enrol itself in the
                composite, and an unregistered control in a toolbar is a tab stop the arrows
                never reach.

                Its index is the band step and its `backdrop` covers the row — neither is a
                number or a prop written per control here. See the sidebar's row above. */}
            <Toolbar backdrop>
              <Flex gap="2" align="center">
                <ShellTrigger
                  target="sidebar"
                  render={
                    <ToolbarButton iconOnly aria-label="Toggle navigation">
                      <PanelLeftIcon />
                    </ToolbarButton>
                  }
                />
                {/* THE PAGE'S OWN TITLE, SAID AGAIN (§46). No words of its own: it mirrors the
                    `Page` in this pane, silent while that page's large title is on screen and
                    arriving when it has scrolled up behind this band. At the leading edge, where
                    macOS puts a document's name — the row states the air around it, so nothing
                    here spaces it away from the buttons before it (§45). */}
                <ToolbarTitle />
              </Flex>
              {/* AND THE WAY OUT OF THE PAGE, at the trailing edge (2026-09-06, §47). The band
                  is `space-between`, so a second child needs no alignment stated and no
                  spacer: the row already says where two clusters sit.

                  The list is computed HERE because this is a server component and the twin's
                  module reads files off disk. The control decides nothing about which pages
                  have one — it is handed the answer, so there is no second implementation of
                  a question `markdown.ts` already answers. */}
              {/* THE TRAILING CLUSTER: what you can do with this page, then where the project
                  lives. `PageActions` draws nothing on a route with no twin, so on the front
                  door this is the repository alone — which is what stops that page's band from
                  being a toggle at one wall and nothing at the other.

                  The gap is the one `PageActions` states between its own two tracks, for the
                  same reason: the air between two groups has to be wider than the air inside
                  one, or the grouping says nothing. */}
              {/* AND IT COLLAPSES WHEN THE ROW RUNS OUT (§45, 2026-09-08). It was a `Flex`,
                  which is the right container for a cluster and the wrong one for a cluster
                  that has to fit: on a phone this band held eight controls and simply ran off
                  the screen, with the last of them sliced in half and no route to any of it.
                  `ToolbarOverflow` measures instead of guessing, which is what this row needs
                  and a breakpoint could not give it — the walk draws nothing outside the reading
                  order and the page actions draw nothing on a route with no twin, so how full
                  this band is depends on the page, not on the window.

                  The gap it states is the row's own, which is what the `Flex` here resolved to
                  anyway. Collapsing runs from the END, so the repository goes first, then what
                  you can do with the page, and the walk is the last thing to leave the row. */}
              <ToolbarOverflow label="More actions">
                {/* The walk comes first, because moving through the docs is the commonest thing
                    to want and it is the only cluster here whose two seats carry words. */}
                <DocsPager
                  stops={[
                    ...READING_ORDER.map((chapter) => ({
                      path: `/${chapter.slug}`,
                      title: chapter.title,
                    })),
                  ]}
                />
                <PageActions paths={PAGES.map((page) => page.path)} />
                <RepoLink label={GITHUB.label} name={GITHUB.name} href={GITHUB.href} />
              </ToolbarOverflow>
            </Toolbar>
          </ShellPaneHeader>
          <ShellScroll className="kd-scroll" fade>
            {/* AND THE READING COLUMN CLEARS THE SIDEBAR. The pane runs under the floating
                nav, so without this the measure would centre itself over the whole window —
                half of it behind the sidebar. The page's own frame centres inside whatever
                room it is given, so giving it the room that is actually visible is the entire
                fix; nothing here restates the sidebar's width, and nothing changes when the
                sidebar closes, because the published reach is zero then.

                It is stated HERE rather than on the pane so a page can still choose to bleed:
                a section that wants to run behind the nav says `m="bleed"` against this
                padding, which is the choice the reach exists to make possible. */}
            <Box
              style={{
                paddingInlineStart: "var(--kui-shell-inset-inline-start)",
              }}
            >
              {/* The page states its own measure, deliberately. A chapter is a reading column
                  with a table of contents beside it; the home page and the 404 are not. One
                  max-width here would have to be wrong for some of them, and the version of
                  this file that had one left a third of the window empty on every page. */}
              {children}
            </Box>
          </ShellScroll>
        </ShellContent>
      </Shell>
    </Box>
  );
}
