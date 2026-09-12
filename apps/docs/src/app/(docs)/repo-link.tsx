"use client";

import {
  ToolbarButton,
  ToolbarGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToolbarOverflow,
} from "@kookie-ui/react";

import { GitHubIcon } from "../icons";

/**
 * WHERE THE PROJECT LIVES — one control at the trailing edge of the band.
 *
 * IT IS A CLIENT COMPONENT FOR ONE REASON: `useToolbarOverflow()`. It sits last in the row, so
 * it is the first thing the overflow collapses on a narrow window, and in the menu the tooltip
 * has to go — a tooltip may only say what its control already says (§32), and a menu row says it
 * in words. `docs-chrome.tsx` renders on the server and cannot ask the question, which is the
 * whole of why these ten lines are their own file rather than three inline ones.
 */
export function RepoLink({ label, name, href }: { label: string; name: string; href: string }) {
  const overflow = useToolbarOverflow();
  const control = (
    <ToolbarButton iconOnly aria-label={name} render={<a href={href} target="_blank" rel="noreferrer" />}>
      <GitHubIcon />
    </ToolbarButton>
  );
  return (
    <ToolbarGroup>
      {overflow ? (
        control
      ) : (
        <Tooltip>
          <TooltipTrigger render={control} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
    </ToolbarGroup>
  );
}
