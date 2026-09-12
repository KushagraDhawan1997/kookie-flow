"use client";

/**
 * Copy-to-clipboard for a code sample. The one interactive part of a code block, and the
 * only reason any of this is a client component — everything else about a fence is decided
 * at build time.
 *
 * The confirmation is the BUTTON ITSELF saying so, not a toast: a toast is a floating layer
 * announcing something the thing you just pressed can say itself, and this system has no toast
 * anyway (§11 lists one; it has never shipped). It reverts on a timer, which is state, not
 * motion — nothing here reads a motion token.
 *
 * WHAT SAYS IT depends on what the button has. A labelled button changes its label; an
 * icon-only one changes its GLYPH to a check, and its accessible name with it, so a screen
 * reader hears the confirmation a sighted reader sees.
 *
 * A `ToolbarButton`, and that is a contract rather than a preference: every place this button
 * lives is a chrome row over a pane, and those rows are `Toolbar`s. A plain
 * Button cannot enrol in a toolbar's roving tab stop, so an unregistered control in one is a
 * stop the arrow keys never reach; and `ToolbarButton` throws outside a toolbar, which makes
 * the requirement loud rather than a comment nobody reads.
 */
import * as React from "react";
import { ToolbarButton, type Size } from "@kookie-ui/react";

import { CopyIcon } from "../app/icons";

export function CopyButton({
  code,
  label = "Copy",
  size = "1",
  icon,
  iconOnly,
}: {
  code: string;
  /** The accessible name, always. `iconOnly` decides whether it is also painted. */
  label?: string;
  /** The block's index, passed through — the chrome rides the same ladder as the pane. */
  size?: Size;
  /**
   * The resting glyph, for a button whose label already says what it copies. The code button
   * leaves it unset and gets a copy mark, because "Copy" is a verb with no object and the
   * glyph is what names the object. The NAME button passes a file mark instead: its label is
   * the object, so a copy mark there would say the same thing twice, and two identical marks
   * at either end of one pane would read as two of the same control.
   *
   * The CONFIRMATION is not overridable. Whatever the resting glyph, a press shows the check
   * — that is the button reporting what happened, and a component that let a call site
   * silence it would let a call site ship a copy that never says it copied.
   */
  icon?: React.ReactNode;
  /**
   * Paint the glyph alone. "Copy" beside a copy mark says one thing twice, and on a code
   * figure the button sits in a corner where a verb earns no room — every editor, terminal
   * and code host on the web has trained this glyph.
   *
   * The name does not go away, it stops being PAINTED: `aria-label` carries it, and Button's
   * own type refuses an icon-only control without one, so this cannot silently ship a button
   * a screen reader announces as "button".
   */
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  // Held in a ref so a second press restarts one timer rather than racing two, and so the
  // pending one is cleared on unmount — a page can navigate away mid-timeout.
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  /* THE GLYPH IS THE RESTING ONE, ALWAYS. Writing `copied ? <CheckIcon/> : ...` would swap
     the element and therefore swap it in one frame — React unmounts the outgoing glyph, and
     an unmounted element cannot leave.

     `done` is the button's own state, and it draws the confirmation: it mounts the system's tick
     beside this glyph, stacked in one cell, and CSS crosses them. The tick is the same
     drawing a checkbox's mark is. What stays here is the STATE and its timer, which is the
     rule §29 states one component over — a control that ran its own clock would decide, for
     every app, how long "just now" lasts.

     One glyph expression for both arms: an icon-only button puts it in `children` (there the
     glyph IS the content), a labelled one puts it in `leading` (there it adorns a label).
     The package's own comment states that split; this is the only place it has to be honoured. */
  const glyph = icon ?? <CopyIcon />;

  return (
    // Medium is the rung a `ToolbarButton` takes outside a group, so no emphasis is stated;
    // `backdrop` because this button FLOATS over the code — a floating control takes the
    // theme's material (glass).
    <ToolbarButton
      size={size}
      backdrop
      done={copied}
      {...(iconOnly
        ? { iconOnly: true as const, "aria-label": copied ? "Copied" : label }
        : { leading: glyph })}
      onClick={() => {
        // `?.` because clipboard access is absent on insecure origins — a docs site served
        // over plain HTTP on a LAN is the ordinary case, and there the press should do
        // nothing rather than throw an unhandled rejection into the console.
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {iconOnly ? glyph : copied ? "Copied" : label}
    </ToolbarButton>
  );
}
