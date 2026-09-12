"use client";

import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  ToolbarButton,
} from "@kookie-ui/react";

import { setAppearance, useAppearance, type AppearanceChoice } from "./appearance";
import { MoonIcon, SunIcon, SystemIcon } from "./icons";

const CHOICES: readonly AppearanceChoice[] = ["system", "light", "dark"];
const LABELS: Record<AppearanceChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
/** The glyph IS the value on a control with no words (2026-09-06). Three choices, three
    marks — the sun, the moon, and the machine you asked to decide. */
const MARKS: Record<AppearanceChoice, () => React.ReactElement> = {
  system: SystemIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/**
 * The appearance picker: an icon-only control in the sidebar's footer band.
 *
 * A MENU WITH RADIO ROWS, NOT A SELECT (2026-09-06, Kushagra: "lets use icon button for github.
 * Same for dark or light mode"). It was a `Select` from 2026-08-26, on the argument that
 * picking one of three persistent choices is exactly what a Select is — which is still true,
 * and is not what changed. What changed is that this control has to be a MARK rather than a
 * word: it sits in a band beside an icon-only search and an icon-only repository link, and a
 * pill reading "Light ⌄" between them is a different kind of thing in a row of peers.
 *
 * A `SelectTrigger` cannot be icon-only, and the refusal is deliberate rather than an
 * omission: it takes no `children` because THE VALUE IS THE CONTENT, so a trigger showing
 * something else could disagree with what is chosen. `MenuRadioGroup` is the same question
 * asked where the answer may be drawn — it announces a radio group with `aria-checked` rows,
 * so nothing is lost to a screen reader, and the trigger wears the chosen mark, so nothing is
 * lost to the eye either. It is what every platform ships for this control.
 *
 * `closeOnClick`, because choosing is the whole visit here — the menu's default of staying
 * open is for watching a dot land in a list you are still working through.
 *
 * The word survives in the `aria-label`; the Tooltip an icon-only control usually also takes is
 * unavailable here, and the measurement for that is beside the trigger below.
 */
export function AppearanceToggle() {
  const { choice } = useAppearance();
  const Mark = MARKS[choice];
  return (
    <Menu>
      {/* NO TOOLTIP ON THIS ONE, and it is a finding rather than a preference (2026-09-06,
          Kushagra: "why is it opening on rtop left"). Wrapped as
          `<TooltipTrigger render={<MenuTrigger render={<button/>}/>}/>` the menu opened at the
          window's top-left corner: measured, the positioner reported `--anchor-width: 0px` and
          landed at (0, 4) for a trigger at (279, 844) — the menu's anchor never reached its
          positioner through the outer trigger. Bisected: dropping the Tooltip anchors it
          correctly at (279, 730), and a plain `Button` in place of the `ToolbarButton` fails
          identically, so the broken link is the two floating triggers on one element and not
          this row's own parts. Inverting the nesting is not available — `render` takes an
          ELEMENT, and a `<Tooltip>` root is not one.

          Nothing is lost: the `aria-label` names the control, and what a tooltip would have
          said is what the menu says the moment it opens. The GitHub link beside it keeps its
          tooltip, because a link opens nothing and has no second trigger to disagree with. */}
      <MenuTrigger
        render={
          <ToolbarButton iconOnly backdrop aria-label={`Appearance: ${LABELS[choice]}`}>
            <Mark />
          </ToolbarButton>
        }
      />
      <MenuContent>
        <MenuRadioGroup
          value={choice}
          onValueChange={(value) => setAppearance(value as AppearanceChoice)}
        >
          {CHOICES.map((c) => (
            <MenuRadioItem key={c} value={c} closeOnClick>
              {LABELS[c]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
