/**
 * The site footer: a mark, columns of links, and the line at the bottom.
 *
 * WHY THIS IS A BLOCK AND NOT A COMPONENT. A footer is a POSITION — the last region of a page
 * — and §3 is that a component never owns where it sits. Its substance is entirely the app's
 * (which links, which words, which mark), and §11 has no row for it. What is left for the
 * system to own is an arrangement and a piece of wiring, which is exactly what a copied file
 * carries safely: every colour, distance and step below resolves through the package, so the
 * center stays in the dependency and this file holds only the shape.
 *
 * IT IS DATA-DRIVEN, AND THAT IS THE DECISION. The alternative is a footer as thirteen
 * exports — `Root`, `Main`, `Bottom`, `Brand`, `BrandName`, `Tagline`, `Links`, `LinkGroup`,
 * `Nav`, `Link`, `Legal`, `Social`, `SocialLink` — of which eleven would be a `Flex` or a
 * `Text` with different defaults. That is layout wearing a part's name, which this system
 * refuses (`ComposerRow`'s grouping, `BreadcrumbSeparator`). A column of links is a LIST, and
 * a list is a prop: `groups` says what the footer says, and the file you are reading says how
 * it looks. Nothing is expressible through thirteen wrappers that is not expressible by
 * editing this one.
 *
 * WHAT IT ACTUALLY OWNS is the naming: each column is its own `<nav>` named by its own title
 * through `aria-labelledby`, so a screen reader announces "Support navigation" rather than
 * five unnamed navigation regions in a row. That is a spec rather than a taste, and a spec
 * copied by hand rots — the argument `Field` makes for owning its label wiring and `Tree`
 * makes for owning its keyboard.
 *
 * THE COLUMN TITLE IS NOT A HEADING, and the refusal is deliberate. A heading is a section of
 * the DOCUMENT, and a footer's column title is a label for a navigation region — putting it in
 * the outline makes page furniture compete with the page's own structure, which on a chapter
 * would put "Support" beside the chapter's real sections. The region is named, which is the
 * half that carries the meaning; `aria-labelledby` needs an id, not an `<h2>`.
 *
 * REFUSED, each for a reason the system already states:
 *
 *  - **Social icons.** §8 ships no icon set, so a written one would export an import the
 *    reader's app cannot resolve. A "Follow us" group of links is
 *    the same information, and it is what the references do.
 *  - **A newsletter form.** It needs an endpoint, which is an app's, and a `Field` plus a
 *    `Button` is four lines in a file you own. Giving it a seat here would mean designing a
 *    position for something the system cannot fill.
 *  - **Payment marks and logos.** Images the app owns. `brand` takes a node for the same
 *    reason: the mark is yours.
 *  - **Axis props.** No `size`, no `tone`, no `emphasis`. A block is not a component with an
 *    API to grow — the steps are stated once, below, and if you want other steps you change
 *    them in your copy. That is the whole difference between this and the package.
 *
 * IT DRAWS NO PANE AT ALL, and that is a refusal rather than a default. What a footer sits ON
 * is the page's business, which is §3's own sentence about a component never owning where it
 * sits, said one level up: a footer that wants a ground is `<Surface><Footer/></Surface>`, one
 * element at the call site rather than a prop and a branch in here. A `pane` boolean is the
 * wrong repair for the same reason — it takes the choice into the file instead of leaving it
 * at the call site.
 *
 * A FOOTER WITH NO COLUMNS IS A LINE, and it is DERIVED rather than asked for. The minimal
 * footer — a mark, two or three destinations, a copyright, all on one row — is the second
 * composition that actually recurs in the wild, and it is not a different arrangement so much
 * as this one with nothing to stack: there are no columns, so the mark has nothing to sit
 * above, and leaving it there draws a title over an empty region. So when `groups` is empty the
 * mark joins the sign-off row, and everything else about that row is unchanged — the note keeps
 * the start wall and the legal links keep the end. One `groups.length` reads it, and no call
 * site has to know which footer it is asking for.
 *
 * WHICH IS ALSO WHY THERE IS NO `brand` PLACEMENT PROP, and the mark-beside-the-columns shape
 * every second product site draws is not reachable from this file. It is a taste, not a
 * derivation — and the moment a demo on this block's page shows an arrangement the file cannot
 * produce, the copy button hands over something that does not make the picture. If you want the
 * mark beside the columns, that is a `Flex` around two children in your copy, which is the same
 * answer this file gives about steps and colours.
 */
import * as React from "react";
import { Flex, Stack, Text } from "@kookie-ui/react";

import "./footer.css";

export type FooterLink = {
  label: string;
  /** Where it goes. A string, so this file stays framework-free — wrap it in your router's
      own link component if you want client navigation, the way the docs do everywhere else. */
  href: string;
};

export type FooterGroup = {
  /** The column's title, and the name of the navigation region it labels. */
  title: string;
  links: readonly FooterLink[];
};

export type FooterProps = {
  /** The app's mark, sitting above the columns. A node, because §8 ships no icon set and a
      wordmark is the one thing on this page that is unarguably yours. */
  brand?: React.ReactNode;
  /** The columns. Each becomes a named navigation region. */
  groups: readonly FooterGroup[];
  /** The line at the bottom — a copyright, a company, a country. */
  note?: React.ReactNode;
  /** The links that sit opposite the note: privacy, terms, status. Separate from `groups`
      because they are not a subject a reader browses, they are the ones a reader is sent to
      look for, and a column of two would read as a category that ran out. */
  legal?: readonly FooterLink[];
};

export function Footer({ brand, groups, note, legal }: FooterProps) {
  /* One id per mounted footer, so two on one page (a preview beside the real one) cannot both
     claim the same name and leave every `aria-labelledby` pointing at the first. */
  const id = React.useId();

  /* Nothing to stack — see the header. The mark comes down into the row rather than standing
     over an empty region. */
  const line = groups.length === 0;

  /* NO HAIRLINE between the browsing half and the legal half. §15's rule is that a separator
     earns its place only where DISTANCE cannot group, which is not the case here: the outer
     stack already sets these two regions far apart against the intervals inside a column, and
     a rule drawn across a gap that is already doing the work is a line saying what the space
     said. */
  const signOff =
    note || legal?.length || (line && brand) ? (
      <Flex justify="space-between" align="center" gap="5" wrap="wrap">
        {/* The start wall, always rendered even when it holds nothing: one child and
            `space-between` pushes it to the wrong wall, and an empty flex is a cheaper way to
            hold a position than a placeholder element that means nothing to a reader of the
            markup. */}
        <Flex align="center" gap="5" wrap="wrap">
          {line && brand ? brand : null}
          {/* Quiet, the rung §15 minted for something deliberately stood down — a copyright
              line is read once a year and never scanned. */}
          {note ? (
            <Text size="2" emphasis="quiet">
              {note}
            </Text>
          ) : null}
        </Flex>
        {legal?.length ? (
          <Flex gap="5" wrap="wrap" render={<nav aria-label="Legal" />}>
            {legal.map((link) => (
              <Text
                key={`${link.label}|${link.href}`}
                size="2"
                emphasis="medium"
                render={<a className="kb-footer-link" href={link.href} />}
              >
                {link.label}
              </Text>
            ))}
          </Flex>
        ) : null}
      </Flex>
    ) : null;

  /* The landmark is the `<footer>` element itself: it announces as `contentinfo` when it is a
     child of the body rather than of an article, which is where a page footer sits. No `role`,
     because stating the role the element already has is the aria rule this system follows
     everywhere else. */
  /* THE RHYTHM IS 32 / 64 / 96, AND THE SIGN-OFF CARRIES THE LARGEST INTERVAL. One step for
      every region — 48 against the 32 two stacked groups take inside a column — is sixteen
      pixels apart, which is a rhythm nobody can read. With no hairline, distance is the ONLY
      thing separating the browsing half from the sign-off, so it has to be unmistakably the
      largest interval in the block rather than nominally the largest. Doubling each level
      states it: 32 inside the columns, 64 between the mark and them, 96 before the line that
      ends the page.

      Two stacks rather than one gap, because the three intervals are not one relationship:
      the mark and the columns are both what the footer SAYS, and the sign-off is what it
      ends with. */
  return (
    <Stack gap="11" render={<footer />}>
      {line ? null : (
        <Stack gap="10">
          {brand ? <div>{brand}</div> : null}

          {/* THE COLUMNS ARE A CSS COLUMN LAYOUT, and `footer.css` carries why: a grid's row is
              as tall as its tallest item, so six groups of unequal length leave a hole nothing in
              grid can close. A plain `div` because there is no layout prop for this — `columns`
              on Box is `grid-template-columns`, which is the mechanism this had to leave. */}
          <div className="kb-footer-columns">
            {groups.map((group, index) => (
              <Stack
                key={group.title}
                gap="3"
                render={<nav aria-labelledby={`${id}-${index}`} />}
              >
                {/* Full ink at medium against muted links: the title is the one thing in the
                    column that is not a destination, and §15 puts that rank in the ink rather
                    than in a heavier face or a larger step. */}
                <Text size="2" weight="medium" id={`${id}-${index}`}>
                  {group.title}
                </Text>
                <Stack gap="2" render={<ul className="kb-footer-list" />}>
                  {group.links.map((link) => (
                    /* KEYED BY BOTH. `href` alone is not a key: a footer may point two links
                       at one place — a "Status" under Product and under Legal is the ordinary
                       case — and placeholder data pointing every link at "#" makes React report
                       duplicate children. Two entries with the same label AND the same
                       destination are the same link written twice, which is a data mistake
                       rather than a case to key around. */
                    <li key={`${link.label}|${link.href}`}>
                      {/* `medium` IS the muted ink role — the resting rank stated through the
                          system rather than repainted in the block's own stylesheet. */}
                      <Text
                        size="2"
                        emphasis="medium"
                        render={<a className="kb-footer-link" href={link.href} />}
                      >
                        {link.label}
                      </Text>
                    </li>
                  ))}
                </Stack>
              </Stack>
            ))}
          </div>
        </Stack>
      )}

      {signOff}
    </Stack>
  );
}
