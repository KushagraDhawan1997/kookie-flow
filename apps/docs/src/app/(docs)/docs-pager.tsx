"use client";

/**
 * THE WAY BACKWARD AND FORWARD, IN THE BAND (2026-09-07, Kushagra: "add next and previous doc
 * to toolbar, will be buttons not icon buttons").
 *
 * The same two places the page's own footer offers, said at the top as well — a reader who has
 * decided to move on should not have to scroll to the end of the thing they are leaving to do
 * it. The footer pair stays: one is where you arrive when you finish reading, the other is
 * there the whole time.
 *
 * MARKS, IN ONE GROUP (2026-09-07, Kushagra: "make them icon buttons, in one group, use arrow
 * not chevron"). They carried the destination's title for an hour and it cost the band most of
 * its width on a chapter with a long neighbour; every other control in this row is icon-only,
 * and a pair of words among them read as a different kind of thing. The title survives where it
 * costs nothing — in each one's tooltip and its accessible name, so what you are going to is
 * still said, on the press before the press.
 *
 * ARROWS, NOT CHEVRONS, and this repo's own icon file states the difference: an arrow says GO
 * somewhere, a chevron says the next one along. Once the word is gone the glyph carries the
 * whole meaning, and what these do is go.
 *
 * ONE GROUP, because now they are two marks with nothing else to say they belong together —
 * which is the case a track exists for (§45), and the reason the wordy version did not have one.
 *
 * The `ToolbarButton` is what enrols each one in the row's composite — a plain Button in a
 * toolbar is a tab stop the arrow keys never reach.
 *
 * THE LIST COMES FROM THE SERVER, on `PageActions`' own reasoning: reading order is a fact
 * `chapters.ts` already holds, and importing it here would pull every chapter's compiled MDX
 * into the browser to answer a question about two titles. So the chrome hands over the order as
 * data and this file only finds itself in it.
 */
import { usePathname } from "next/navigation";
import {
  ToolbarButton,
  ToolbarGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToolbarOverflow,
} from "@kookie-ui/react";
import Link from "next/link";

import { ArrowLeftIcon, ArrowRightIcon } from "../icons";

/** One stop on the walk. The path is what identifies it; the title is what a reader reads. */
export type PagerStop = { path: string; title: string };

export function DocsPager({ stops }: { stops: readonly PagerStop[] }) {
  const pathname = usePathname();
  /* IN THE MENU A TOOLTIP SAYS NOTHING NEW. Here it carries the whole title where the button
     only draws an arrow, so it is the one thing on this control that is not repetition — but a
     menu row prints those same words, and a floating layer over a panel is a composition the
     family has no answer for. The `aria-label` the button already carries becomes the row. */
  const overflow = useToolbarOverflow();
  const index = stops.findIndex((stop) => stop.path === pathname);
  // A ROUTE OUTSIDE THE WALK DRAWS NOTHING — the front door, a 404.
  // Same shape as the page actions beside it: handed the answer, never guessing from the path.
  if (index === -1) return null;

  const prev = stops[index - 1];
  const next = stops[index + 1];
  if (!prev && !next) return null;

  const seat = (stop: PagerStop, words: string, Glyph: typeof ArrowLeftIcon) => {
    const control = (
      <ToolbarButton iconOnly aria-label={words} render={<Link href={stop.path} />}>
        <Glyph />
      </ToolbarButton>
    );
    if (overflow) return control;
    return (
      <Tooltip>
        <TooltipTrigger render={control} />
        <TooltipContent>{stop.title}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <ToolbarGroup>
      {prev ? seat(prev, `Previous: ${prev.title}`, ArrowLeftIcon) : null}
      {next ? seat(next, `Next: ${next.title}`, ArrowRightIcon) : null}
    </ToolbarGroup>
  );
}
