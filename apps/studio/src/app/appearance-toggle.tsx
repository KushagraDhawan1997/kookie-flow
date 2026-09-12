'use client';

import { Button, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, ToolbarButton } from '@kookie-ui/react';

import { setAppearance, useAppearance, type AppearanceChoice } from './appearance';
import { MoonIcon, SunIcon, SystemIcon } from './icons';

const CHOICES: readonly AppearanceChoice[] = ['system', 'light', 'dark'];
const LABELS: Record<AppearanceChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const MARKS: Record<AppearanceChoice, () => React.ReactElement> = {
  system: SystemIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/**
 * An icon-only picker whose glyph is the current value; a menu of radio rows underneath.
 * `inToolbar` enrols it in a surrounding Toolbar's keyboard composite; a ToolbarButton outside
 * one throws, so the plain page gets a Button.
 */
export function AppearanceToggle({ inToolbar = false }: { inToolbar?: boolean }) {
  const { choice } = useAppearance();
  const Mark = MARKS[choice];
  const label = `Appearance: ${LABELS[choice]}`;
  return (
    <Menu>
      <MenuTrigger
        render={
          inToolbar ? (
            <ToolbarButton iconOnly aria-label={label}>
              <Mark />
            </ToolbarButton>
          ) : (
            <Button iconOnly aria-label={label}>
              <Mark />
            </Button>
          )
        }
      />
      <MenuContent>
        <MenuRadioGroup value={choice} onValueChange={(value) => setAppearance(value as AppearanceChoice)}>
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
