/**
 * The empty state: what a region shows when it has nothing to show.
 *
 * COPIED FROM KookieUI v2's docs block (`apps/docs/blocks/empty-state.tsx`), where it is argued: a
 * block rather than a component, because its words, mark and action are all the app's. Kept as
 * that file has it, so its rules still hold here:
 *
 *  - Three states, told apart by words and rank rather than by a prop. Nothing yet: the action
 *    creates the first one. Nothing matched: it clears the filter, quietly. Nothing available: it
 *    retries.
 *  - One action and one quieter way out, as two slots rather than an array.
 *  - The title is a span, not a heading. The region is usually titled already, and a state that
 *    comes and goes should not add and remove an outline entry.
 *  - It centres when its region has a height and hugs when it does not, so there is no
 *    `minHeight` to pass. The centring and the measure are in `empty-state.css`.
 */
import * as React from 'react';
import { Flex, Heading, Stack, Text } from '@kookie-ui/react';

import './empty-state.css';

export interface EmptyStateProps {
  /** The glyph above the words. Optional: an absence rarely wants one, an outcome may. */
  mark?: React.ReactNode;
  /** Names what is absent: "No nodes yet", never "No data". */
  title: string;
  /** One sentence: why it is empty, or what to do about it. */
  description?: React.ReactNode;
  /** The one thing to do. */
  action?: React.ReactNode;
  /** A quieter second way out. */
  secondary?: React.ReactNode;
}

export function EmptyState({ mark, title, description, action, secondary }: EmptyStateProps) {
  // Generous around the words and tight inside them, 5 against 2. The title steps down to 5 only
  // with the sentence at 2: 20 over 14 keeps the jump between them a hierarchy.
  return (
    <Stack className="kd-empty" gap="5" align="center" justify="center">
      {mark ? <div className="kd-empty-mark">{mark}</div> : null}
      <Stack gap="2" align="center">
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
        <Flex gap="3" align="center" justify="center" wrap="wrap">
          {action}
          {secondary}
        </Flex>
      ) : null}
    </Stack>
  );
}
