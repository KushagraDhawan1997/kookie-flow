"use client";

/**
 * The table of contents: the headings of the page you are reading, with the one you are at
 * marked.
 *
 * WHY THIS IS A BLOCK AND NOT A COMPONENT. Its substance is the app's — where the headings come
 * from, which levels count, which column it sits in and at what width — and §11 has no row for
 * it. What is left for the system to own is an arrangement and a rank, which is what a copied
 * file carries safely: every colour and distance below resolves through the package.
 *
 * IT IS NOT A `NavTree`, and that was the first answer. The shape fits — a nav landmark, one
 * current item, two levels — but a nav tree makes a node with children a `<button aria-expanded>`
 * rather than a link, so every heading that has a sub-heading under it would stop being somewhere
 * you can go. A table of contents has no sections to open; it has places, all of them reachable.
 *
 * WHAT IT IS INSTEAD IS `Tabs`, TURNED VERTICAL. A list of section names where exactly one is
 * current, and §26's own sentence for how that one is marked: by INK and a RULE, never by a
 * louder fill. A fill here would be a row you PICK from a list — the row family's vocabulary,
 * which the sidebar beside this already speaks — and putting it in the gutter too would be two
 * sidebars on one page. `Accordion` made the same cut one component over ("is it a row tho?").
 *
 * SO THE PARTS ARE ALL BORROWED, EACH FROM THE COMPONENT THAT ARGUED IT:
 *
 *  - The links are `Breadcrumb`'s, not `Link`'s: the tone-less foreground roles in two ranks,
 *    and an underline that RESTS TRANSPARENT and paints under the pointer. Both are the same
 *    carve-out from WCAG 1.4.1 that §39 states — technique F73 is about a link inside a block of
 *    text, where hue is all that separates it from the words; a whole item in a list is not that
 *    case. `Link` itself is refused for §39's other reason too: it rests on `accent` and STAMPS
 *    it, and a stamped family re-scopes all three foreground roles onto that family's inks.
 *  - The mark on the current item is `Tabs`' indicator: the family's glyph role, and the label
 *    in the full ink — no heavier weight, because a semibold entry is wider than a medium one
 *    and the column would reflow on every scroll (§26's own measured argument).
 *  - The rail that mark is a segment of is `Separator`'s line and `Blockquote`'s (§7's edge
 *    order): `--color-border`, carrying no identity, so it reads as texture rather than as a
 *    second colour competing with the words.
 *  - The indent is `Tree`'s: one geometric step, so a sub-heading is told from its parent by
 *    where it starts and not by a third ink. Alignment by geometry, never by per-node judgement.
 *
 * NOTHING MOVES. The rail exists at rest in the quiet colour and CHANGES colour when its item
 * becomes current, which is Link's underline mechanism rotated ninety degrees: a border appearing
 * is a discrete change that arrives in one frame, and a border changing colour is a paint (§8).
 *
 * REFUSED, each for a reason the system already states:
 *
 *  - **The column, its width, and where it stops fitting.** A block may not decide those: they
 *    are measurements about this page's layout rather than about anything's box, and the docs'
 *    own `prose.css` states them on the class it passes in. It is also why nothing here is
 *    sticky — what this sits in is the caller's region, exactly as a footer's ground is the
 *    page's.
 *  - **Levels past three.** A table of contents that mirrors every heading has stopped being a
 *    summary; what to hand over is the caller's call, which is `Breadcrumb`'s `maxItems` refusal
 *    (§3) one component over.
 *  - **Smooth scrolling on click.** That is `scroll-behavior` on the document, a decision about
 *    the whole page, and a reader who asked their system for stillness must not be given it.
 *  - **`size` and `tone`.** A block is not a component with an API to grow — the steps are stated
 *    once, below, and another step is an edit to your copy.
 */
import * as React from "react";

import { Stack, Text } from "@kookie-ui/react";

import "./table-of-contents.css";

export type TocEntry = {
  /** The heading's `id`, which is both the anchor and what the observer watches. */
  id: string;
  title: string;
  /** Two levels. A third is a summary that has stopped summarising — see the refusals. */
  level: 2 | 3;
};

export type TableOfContentsProps = {
  /** The headings, in document order. The order is load-bearing: the observer resolves ties by
      taking the first entry it finds visible, which is only "the topmost" while this list agrees
      with the page. */
  entries: readonly TocEntry[];
  /** The words above the list. A prop because a copied file may not bake English — `Notice`'s
      `dismissLabel` set that precedent — and it names the navigation as well as heading it. */
  label?: string;
  /**
   * The id to mark, when the caller already knows it. Leave it unset and the block watches the
   * page: controlled and uncontrolled, the package's own pairing. `null` is a stated "none".
   */
  current?: string | null;
  /** The column this sits in is the caller's — see the refusals. */
  className?: string;
};

/**
 * The band a heading has to be inside to count as the one you are at: the top third of the
 * viewport. Below that band a heading is something you are reading TOWARDS, not at.
 *
 * A negative bottom margin rather than a scroll handler, which is the whole reason this is an
 * IntersectionObserver: the browser says when the answer changed instead of this asking on every
 * frame. §8's "no JS at interaction time" is the package's law and does not bind a block, but the
 * reason behind it does.
 */
const BAND = "0px 0px -66% 0px";

export function TableOfContents({
  entries,
  label = "On this page",
  current,
  className,
}: TableOfContentsProps) {
  const [seen, setSeen] = React.useState<string | null>(null);
  const controlled = current !== undefined;

  /* The ids as a string, not the array: a caller that builds `entries` inline hands over a new
     array on every render, and an effect keyed on that identity would re-observe the whole page
     every time anything above it changed. What this effect depends on is WHICH headings there
     are. */
  const ids = entries.map((entry) => entry.id).join(" ");

  React.useEffect(() => {
    if (controlled) return;
    const order = ids ? ids.split(" ") : [];
    const nodes = order
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) visible.add(record.target.id);
          else visible.delete(record.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) {
          setSeen(first);
          return;
        }
        /* NOTHING IS IN THE BAND, which is most of a long section and all of the bottom of the
           page — the case a plain "topmost intersecting heading" spelling leaves blank, so the
           mark disappears exactly where the reader is furthest from the top and wants it most.
           The honest answer there is the last heading they have already passed. Measured rather
           than tracked, and only once the observer has already woken us. */
        let passed: string | null = null;
        for (const node of nodes) {
          if (node.getBoundingClientRect().top >= 0) break;
          passed = node.id;
        }
        setSeen(passed ?? order[0] ?? null);
      },
      { rootMargin: BAND },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [controlled, ids]);

  if (entries.length === 0) return null;
  const active = controlled ? current : seen;

  return (
    /* ONE TYPE STATEMENT FOR THE WHOLE THING, which is `Breadcrumb`'s arrangement: the `<nav>`
       wears the step and everything inside inherits it, so no rule below names a size.

       STEP 2, WHICH IS §15's "label and meta". The argument for the prose's own 3 is a real
       one — these are the page's own headings written out, not captions on something else —
       and it loses on both counts. At 3 they read as a second column of prose competing with
       the one they point into; at 2 they read as what they are. It also costs the entries
       their wrapping: in a 14rem column, seven of nine entries on a long page break to two
       lines at 16px against three of nine at 14. */
    <Text size="2" render={<nav aria-label={label} className={className} />}>
      <Stack gap="3">
        {/* ABOVE THE RAIL, and that is the separation — the label is not an entry, so it does not
            stand on the line the entries stand on. The faint rung is legal here for §15's stated
            reason: it is the EXCEPTION rung, for something deliberately stood down, and what is
            stood down is a caption over a list that is already obviously a list. */}
        <Text size="2" emphasis="quiet">
          {label}
        </Text>
        <ul className="kb-toc-list">
          {entries.map((entry) => {
            const isCurrent = active === entry.id;
            return (
              <li
                key={entry.id}
                className="kb-toc-item"
                data-level={entry.level}
                /* THE TONE IS STAMPED ON THE ITEM AND NOT ON THE NAV, and the difference is the
                   trap `Breadcrumb` names: `.kui-type[data-tone]` re-declares all three
                   foreground roles onto the family's ink trio, so stamping it where the type step
                   is would repaint every word in this list in a blue grey. A plain `<li>` is not
                   `.kui-type`, so what it picks up is the tone indirection alone — which is all
                   the rule reads. */
                {...(isCurrent ? { "data-current": "", "data-tone": "accent" } : {})}
              >
                <a
                  href={`#${entry.id}`}
                  className="kb-toc-link"
                  /* `location`, not `page`: this is the current place WITHIN a page, which is
                     what ARIA defines the value for. The sidebar beside this says `page`, for the
                     other question — which chapter you are in. */
                  aria-current={isCurrent ? "location" : undefined}
                >
                  {entry.title}
                </a>
              </li>
            );
          })}
        </ul>
      </Stack>
    </Text>
  );
}
