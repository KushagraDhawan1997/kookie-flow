/**
 * The studio's glyphs: Hugeicons, one named wrapper per glyph. Call sites say what a glyph MEANS
 * (`RunIcon`), not which drawing was picked, so swapping a drawing is one edit here. Decorative
 * by default; the control that owns the glyph carries the accessible name. No `size`: the slot's
 * box is the system's.
 */
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { iconStroke } from '@kookie-ui/react';
import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  ComputerIcon,
  Delete02Icon,
  Home01Icon,
  Moon02Icon,
  PlayIcon,
  PlusSignIcon,
  Search01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  Sun03Icon,
} from '@hugeicons/core-free-icons';

const glyph = (icon: IconSvgElement) =>
  function Glyph() {
    return <HugeiconsIcon icon={icon} strokeWidth={iconStroke} aria-hidden />;
  };

export const SunIcon = glyph(Sun03Icon);
export const MoonIcon = glyph(Moon02Icon);
export const SystemIcon = glyph(ComputerIcon);
export const HomeIcon = glyph(Home01Icon);
export const PlusIcon = glyph(PlusSignIcon);
export const SearchIcon = glyph(Search01Icon);
export const PanelLeftIcon = glyph(SidebarLeftIcon);
export const PanelRightIcon = glyph(SidebarRightIcon);
export const UndoIcon = glyph(ArrowTurnBackwardIcon);
export const RedoIcon = glyph(ArrowTurnForwardIcon);
export const RunIcon = glyph(PlayIcon);
export const TrashIcon = glyph(Delete02Icon);
