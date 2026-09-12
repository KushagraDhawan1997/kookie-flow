/**
 * The empty state: what a region shows when it has nothing to show.
 *
 * WHY THIS IS A BLOCK AND NOT A COMPONENT. Its substance is entirely the app's — which words,
 * which mark, which action — and §11 has no row for it. What is left for the system to own is an
 * arrangement and a rank, which is exactly what a copied file carries safely: every colour,
 * distance and step below resolves through the package.
 *
 * WHAT APPLE DOES, checked rather than remembered. The HIG has no empty-state
 * COMPONENT — the same finding as the message family, where their answer is guidance in the
 * Onboarding and Writing register rather than a component page. But SwiftUI ships
 * `ContentUnavailableView` (iOS 17), and its slots are the four below, in this order: a label
 * carrying a title and a symbol, a description, and actions last — the same four, in the same
 * order, as the arrangement below.
 *
 * THREE STATES, AND `reason` IS NOT A PROP. This is the part every system gets wrong, and it is
 * editorial rather than structural:
 *
 *   1. **Nothing yet.** Nothing has been created. The action CREATES the first one.
 *   2. **Nothing matched.** A search or a filter emptied the list. The action CLEARS the filter,
 *      quietly — offering "Create your first project" under a search that returned nothing is the
 *      specific mistake this block exists to prevent, and it is what most libraries ship.
 *   3. **Nothing available.** It failed, or you may not see it. The action RETRIES.
 *
 * They differ in words and in rank, not in arrangement, so a `reason` prop would switch nothing.
 * The taxonomy lives in the demos and in the prose, where an editorial rule can be taught. Apple
 * agrees on the split and reaches the same conclusion by a different road: their one concession
 * is `ContentUnavailableView.search(text:)`, a separate constructor whose words are already
 * written — which we cannot copy, because it bakes English. `Notice`'s `dismissLabel` set that
 * precedent: Apple ships localisations and a copied file does not.
 *
 * IT IS NOT A `Notice`, and the boundary is the one §29 draws by asking what made the message
 * appear. A notice is a message BESIDE content that still exists, and its placement is the
 * caller's. This IS the region's content — there is nothing behind it — so a notice here would be
 * a message in a box of chrome around nothing.
 *
 * REFUSED, each for a reason the system already states:
 *
 *  - **More than one primary action.** `action` and `secondary` are two named slots rather than
 *    an `actions` array, and the type IS the rule: an array is an invitation, and three buttons
 *    in an empty state is the failure. §11's one-focal-point rule, held by anatomy the way
 *    `AlertDialog` holds it.
 *  - **An illustration set, or `variant="search" | "error"`.** §8 ships no icon set, and a named
 *    set of states is a product vocabulary the system must not own (`Badge`'s own refusal).
 *  - **`size`, `tone`, `emphasis`.** A block is not a component with an API to grow — the steps
 *    are stated once, below, and other steps are an edit to your copy.
 *  - **A pane, and a `minHeight`.** What this sits in is the caller's region, exactly as a
 *    footer's ground is the page's. It centres when the region has height and hugs when it does
 *    not, so there is no number to pass.
 *  - **`aria-live`.** Whether this should be ANNOUNCED depends on whether it arrived, and only
 *    the caller knows that — was the list always empty, or did your filter just empty it? The
 *    live region belongs on the results region wrapping both the list and this. Saying it here
 *    would announce a first-use state on every page load.
 */
import * as React from "react";
import { Flex, Heading, Stack, Text } from "@kookie-ui/react";

import "./empty-state.css";

export type EmptyStateProps = {
  /** The glyph above the words. A node, because §8 ships no icon set — and optional, because
      "Nothing matched" rarely wants one. */
  mark?: React.ReactNode;
  /** Names what is absent. "No projects yet", never "No data" — the reader knows the screen is
      empty, what they do not know is what would be here. */
  title: string;
  /** One sentence: why it is empty, or what to do about it. */
  description?: React.ReactNode;
  /** The one thing to do. A node rather than data, because an action may open a dialog, and a
      trigger is an element. */
  action?: React.ReactNode;
  /** A quieter second way out — "Learn more", "Clear filters". */
  secondary?: React.ReactNode;
};

export function EmptyState({ mark, title, description, action, secondary }: EmptyStateProps) {
  /* THE RHYTHM IS §15's, AND IT IS ASYMMETRIC ON PURPOSE (rule 5): generous above a heading,
     tight below it, because the space above separates it from what came before and the space
     below binds it to what it introduces. `2` inside the words and `5` around them is the 4x
     that rule asks for, and the difference is what stops the three regions reading as one stack.

     THE STEPS ARE A PAIR, AND THEY MOVE TOGETHER. The house ladder's own rungs are title `6`
     over body `3` — 24 over 16, a ratio of 1.50 — and taking the title to `5` alone would be
     20 over 16, which is 1.25 and under the 1.33 §15 rule 1 asks of adjacent levels. That rule
     is the one that calls a small ratio "not a hierarchy, a rounding error", so a smaller title
     obliges a smaller sentence with it: `5` over `2` is 20 over 14, 1.43, and the hierarchy
     survives.

     `5` and `2` are both steps §15 marks as decisions rather than defaults, which is what this
     paragraph is: the title is a decision because a region's own label should not shout at a page
     that has already been titled, and the sentence is `2` because it is supporting text under a
     label rather than reading matter. */
  return (
    <Stack className="kb-empty" gap="5" align="center" justify="center">
      {mark ? <div className="kb-empty-mark">{mark}</div> : null}

      <Stack gap="2" align="center">
        {/* A SPAN, NOT A HEADING, and the refusal is the footer's column title one region over.
            This is the content of a region the page has usually already titled, so putting it in
            the document outline makes a second heading compete with the real one — and an empty
            state that appears and disappears would add and remove an outline entry as a filter
            changes. The words are still read; what they are not is structure. */}
        <Heading size="5" render={<span />}>
          {title}
        </Heading>
        {description ? (
          <Text size="2" emphasis="medium">
            {description}
          </Text>
        ) : null}
      </Stack>

      {action || secondary ? (
        /* The primary first in DOM order, which is reading order and tab order at once. Wrapping
           rather than shrinking: two buttons in a narrow region stack. */
        <Flex gap="3" align="center" justify="center" wrap="wrap">
          {action}
          {secondary}
        </Flex>
      ) : null}
    </Stack>
  );
}
