"use client";

/**
 * Search (2026-08-21) — the package's `Command` since 2026-09-04.
 *
 * It was once a palette assembled by hand: a `Dialog` holding a `TextField` and a list of
 * `Row`s, with its own `active` index and its own arrow/Enter branches. DECISIONS §44's whole
 * claim is that the keyboard model belongs to the package and no app should write it twice.
 *
 * THREE THINGS ARE THIS APP'S AND STAYED. **The ranking**, which is why `filter` is `null` here
 * rather than a matcher passed through: `searchEntries` scores an exact title over a prefix over
 * a substring over the haystack, and caps at twelve. A boolean predicate can do neither, so the
 * app narrows its own array and hands it in — the path §44 described and could not offer until
 * `onQueryChange` existed. §44's refusal of fuzzy reordering is untouched and is about something
 * else: a palette of COMMANDS keeps the table's order because muscle memory is most of what it
 * is for, and prose has no order of its own to keep. **The rows are links**, which is what
 * `render` on `CommandItem` was opened for the same day — a result is a place, and a row that
 * navigates without being an anchor has no middle-click, no open-in-new-tab, no URL on the
 * status bar and nothing announced as a link. **And ⌘K is bound here**, because which chord
 * opens a palette is the app's decision (§44 refuses to own it) and Chrome's own ⌘K takes the
 * address bar unless the default is prevented.
 *
 * WHAT WENT, and neither is a loss. The title and the description paragraph: §44 refuses a title
 * because the field is the affordance, and the description was definitional — it explained what
 * the index covers to someone who had not yet typed. What it had to say is said where it is
 * decision-relevant, in the empty state, at the moment a search has come back with nothing.
 */
import * as React from "react";
import Link from "next/link";
import {
  Button,
  Command,
  CommandContent,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Flex,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kookie-ui/react";

import { EmptyState } from "../../blocks/empty-state";
import { SearchIcon } from "../icons";
import { searchEntries, type SearchEntry } from "./search";

export function DocsSearch({ index }: { index: readonly SearchEntry[] }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const results = React.useMemo(() => searchEntries(index, query), [index, query]);

  // ⌘K / Ctrl-K. Bound on the document because a palette has to open from anywhere, and
  // `preventDefault` because Chrome's own ⌘K focuses the address bar.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    // The tab bar's search seat (2026-09-09): a second opener in another component, so it
    // asks by event rather than by lifting the state.
    const onAsk = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("kd:search", onAsk);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("kd:search", onAsk);
    };
  }, []);

  return (
    <>
      {/* An icon button, not a fake input (2026-08-28, Kushagra: "this isn't a real search,
          might as well use an icon button"). The full-width bar dressed a BUTTON as a text
          field — a promise this component never keeps, since typing never happens here, only
          in the panel it opens — and it cost a whole row beside the wordmark for one glyph's
          worth of actual affordance. `⌘K` moves into the tooltip, the one place a shortcut
          hint belongs on a control that already states its name. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              /* It floats in the sidebar's chrome band since 2026-08-30, with rows passing
                 behind it — which is exactly what the material defends (§10), so it states
                 its backdrop. */
              backdrop
              onClick={() => setOpen(true)}
              aria-label="Search the documentation"
            >
              <SearchIcon />
            </Button>
          }
        />
        <TooltipContent>Search (⌘K)</TooltipContent>
      </Tooltip>

      {/* SIZE 3, and it is the APP's now rather than this call site's (2026-09-05): the docs
          root states `size="3"` once, which is the width the dialog this replaced already had —
          a result is a title plus the section it sits in, and at the 440px of size 2 that pair
          wraps onto two lines for most of the index. The number did not change; the number of
          places stating it did. */}
      <Command items={results} open={open} onOpenChange={setOpen}>
        <CommandContent
          aria-label="Search the documentation"
          /* The app has already narrowed AND ranked, so Base UI must not narrow again — a
             second pass over a scored list can only lose the score. */
          filter={null}
          onQueryChange={setQuery}
        >
          <CommandInput
            aria-label="Search query"
            placeholder="Type to search"
            leading={<SearchIcon />}
          />
          <CommandList>
            {(entry: SearchEntry) => (
              <CommandItem key={entry.href} value={entry} render={<Link href={entry.href} />}>
                {/* NOT `Text`, AND THAT IS THE POINT (2026-09-06). Both halves were pinned at
                    step 2, so when the palette's rows moved one step up the boxes grew and the
                    words stayed where they were — a size-2 result sitting in a size-3 row. `Text`
                    could not fix it either: it rests at step 3 whatever it sits in, which is
                    right for body copy on a page and wrong for the label of a control. A row
                    prices its own label, so these inherit it, and what tells the title from the
                    section it sits in is weight and ink rather than size. */}
                <Flex align="baseline" gap="3" wrap="wrap">
                  <span className="kd-hit-title">{entry.title}</span>
                  <span className="kd-hit-context">{entry.context}</span>
                </Flex>
              </CommandItem>
            )}
          </CommandList>
          {/* What the description used to say, said where it is decision-relevant: a reader who
              has typed and got nothing is the one who needs to know what the index covers.

              AND ONLY THEN. The index refuses a query under two characters, so an untouched
              field has no results by construction and the panel opened saying "Nothing matches"
              before anyone had typed anything — an answer to a question nobody asked, and the
              first thing you saw. The gate is the app's because the minimum is: `searchEntries`
              is what decides that one character is not a search. */}
          {query.trim().length >= 2 ? (
          <CommandEmpty>
            <EmptyState
              title="Nothing matches"
              description="The index covers chapter titles, their summaries and their section headings — not the text of every paragraph."
            />
          </CommandEmpty>
          ) : null}
        </CommandContent>
      </Command>
    </>
  );
}
