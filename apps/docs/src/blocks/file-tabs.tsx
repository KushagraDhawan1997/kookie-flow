"use client";

/**
 * A code figure with several files in it.
 *
 * TABS, NOT A SEGMENTED CONTROL, and §26 settles it in one sentence: a tab bar switches what is
 * under it and a segmented control sets a value in place. Picking `footer.css` over `footer.tsx`
 * replaces the thing below the bar, so it is a tab bar — and the package's own `Tabs` already
 * carries the roles, the arrow keys and the travelling rule, so this file states none of them.
 *
 * THE BAR SITS ON THE CODE, NOT IN THE FIGURE'S CHROME ROW. The figure's row is at the top,
 * above the live specimen, which would put the tabs a demo's height away from what they switch
 * — the one arrangement §26's sentence forbids. So the code half gets its own row back for this
 * case: tabs on one wall, the copy button on the other.
 *
 * AND THE COPY BUTTON MOVES WITH THE TABS, which is the whole reason this is a client component
 * rather than markup the server could emit. The button hands over the file you are looking at;
 * knowing which one that is is state, and the state belongs to the same element that draws the
 * bar. Everything expensive has already happened on the server — the lines arrive tokenized, so
 * what ships here is a `useState` and a list.
 */
import * as React from "react";
import { Box, Stack, Tabs, TabsList, TabsPanel, TabsTab, Toolbar, ToolbarGroup, type Size } from "@kookie-ui/react";

import { CodeSampleView } from "./code-sample";
import { CopyButton } from "./copy-button";
import type { CodeLine } from "./highlight";

export type TabbedFile = {
  /** The tab's label, and what a reader calls the file. */
  name: string;
  lines: readonly CodeLine[];
  focused: boolean;
  diff: boolean;
  /** What the copy button hands over: the source with every annotation stripped. */
  copyText: string;
  lang: string;
};

export function FileTabs({
  files,
  controls,
  size = "2",
  lineNumbers = false,
  maxLines,
}: {
  files: readonly TabbedFile[];
  /** The figure's own controls — the props trigger — which sit beside the copy button. */
  controls?: React.ReactNode;
  size?: Size;
  /** Passed straight through to every panel. The figure decides it once — see `specimen.tsx`
      — so switching tabs cannot switch whether the lines are numbered. */
  lineNumbers?: boolean;
  maxLines?: number;
}) {
  const [active, setActive] = React.useState(files[0]!.name);
  const current = files.find((file) => file.name === active) ?? files[0]!;

  return (
    /* THE BAR AND WHAT IT SWITCHES ARE TWO THINGS. Drawn flush, the first line of code sits
       on the bar's own hairline and the two read as one block. `4` is the interval a label
       takes from what it names elsewhere in this figure — the same step the demo's label
       takes above it — and the panel is what the bar names. */
    <Tabs
      value={active}
      onValueChange={(value) => setActive(String(value))}
      render={<Stack gap="4" />}
    >
      {/* ITERATING: the figure's floating chrome, rendered HERE because the copy button has to
          hand over the file you are LOOKING AT, and which one that is is this component's
          state. The figure is a server component, so it cannot hold it. */}
      <Box className="kd-figure-chrome">
        <Toolbar size="3">
          <span />
          <ToolbarGroup backdrop>
            {controls}
            <CopyButton code={current.copyText} size="3" iconOnly />
          </ToolbarGroup>
        </Toolbar>
      </Box>
      {/* The row: the bar on the reading wall, the action on the other, which is the same
          arrangement the figure's own chrome row uses one level up — and the same COMPONENT,
          so the alignment, the split and the air are stated once rather than three times across
          these blocks.

          WHAT IT DOES NOT BUY HERE IS THE KEYBOARD, and that was measured before it was
          written: a `TabsList` is already a roving composite, so nested in a toolbar it keeps
          its own arrow keys and they never escape to the button beside it — from the last tab,
          ArrowRight wraps to the first tab, exactly as it does with no toolbar at all. Two
          composites, and the inner one wins. The copy button stays reachable by Tab, which is
          what it was before. So this row takes the toolbar for its layout and announces itself
          honestly; the tab bar's own keyboard is untouched. */}
      <Toolbar size={size}>
        <TabsList size={size} aria-label="Files">
          {files.map((file) => (
            <TabsTab key={file.name} value={file.name}>
              {file.name}
            </TabsTab>
          ))}
        </TabsList>
      </Toolbar>
      {files.map((file) => (
        <TabsPanel key={file.name} value={file.name}>
          <CodeSampleView
            lines={file.lines}
            focused={file.focused}
            diff={file.diff}
            lang={file.lang}
            size={size}
            {...(lineNumbers ? { lineNumbers: true } : {})}
            {...(maxLines === undefined ? {} : { maxLines })}
            // Hosted and bare for the same reasons the single-file figure states: the figure IS
            // the well, and the row above is the only chrome.
            hosted
            bare
          />
        </TabsPanel>
      ))}
    </Tabs>
  );
}
