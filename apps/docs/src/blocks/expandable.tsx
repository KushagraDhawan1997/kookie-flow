"use client";

/**
 * The expand control for a bounded code block. Behaviour, so it lives in the block layer —
 * the element only knows how to BE bounded (`maxLines`, scrollable); whether to lift the
 * bound is a choice, and this is the one piece of state it takes.
 *
 * WHETHER THE BUTTON APPEARS IS DECIDED ON THE SERVER, not by measurement: the caller counts
 * its lines against the bound and only mounts this wrapper when the bound binds. Measuring
 * `scrollHeight` in an effect makes the toggle pop in after first paint; the whole class of
 * defect disappears when the deciding fact is the line count the renderer already holds.
 *
 * THE BUTTON FLOATS BOTTOM-CENTRE OVER THE PANE, AS GLASS: a floating control over content
 * takes `backdrop`, so the code passes behind it legibly, and no gradient — a scrollable well
 * with a scrollbar already says "more". It goes to the element as `footer` and hangs from the
 * WELL, beside the topbar, so both chrome rows float against the same box.
 *
 * `aria-expanded` and nothing more: the bounded well still scrolls, so no content is ever
 * hidden from anyone — the button changes how much is in view, not what exists. That is why
 * this is not a disclosure pattern and takes none of its wiring.
 */
import * as React from "react";
import { Button, CodeBlock, Flex, type Size } from "@kookie-ui/react";

export function Expandable({
  size,
  maxLines,
  lineCount,
  className,
  topbar,
  band,
  hosted,
  children,
}: {
  size: Size;
  maxLines: number;
  lineCount: number;
  className?: string | undefined;
  /** Passed straight through — the chrome belongs to the well, and this only bounds it. */
  topbar?: React.ReactNode;
  /** Passed straight through — whether that chrome spans is the block's answer, not the bound's. */
  band?: boolean;
  /** Passed straight through — whether the well draws its own pane is the host's answer. */
  hosted?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <CodeBlock
      size={size}
      {...(expanded ? {} : { maxLines })}
      {...(topbar ? { topbar } : {})}
      {...(band ? { band } : {})}
      {...(hosted ? { hosted } : {})}
      {...(className ? { className } : {})}
      footer={
        <Flex justify="center">
          <Button
            size={size}
            backdrop
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : `Show all ${lineCount} lines`}
          </Button>
        </Flex>
      }
    >
      {children}
    </CodeBlock>
  );
}
