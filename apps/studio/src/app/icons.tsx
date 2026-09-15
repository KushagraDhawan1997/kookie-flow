/**
 * The studio's glyphs: Hugeicons, one named wrapper per glyph. Call sites say what a glyph MEANS
 * (`RunIcon`), not which drawing was picked, so swapping a drawing is one edit here. Decorative
 * by default; the control that owns the glyph carries the accessible name. No `size`: the slot's
 * box is the system's.
 */
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { iconStroke } from '@kookie-ui/react';
import {
  ComputerIcon,
  Copy01Icon,
  CreditCardIcon,
  Delete02Icon,
  Edit02Icon,
  GridViewIcon,
  Home01Icon,
  Logout01Icon,
  MoreHorizontalIcon,
  Moon02Icon,
  PlayIcon,
  SidebarLeftIcon,
  PlusSignIcon,
  RedoIcon as RedoDrawing,
  Search01Icon,
  SidebarRightIcon,
  Sun03Icon,
  UndoIcon as UndoDrawing,
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
export const PanelRightIcon = glyph(SidebarRightIcon);
export const UndoIcon = glyph(UndoDrawing);
export const RedoIcon = glyph(RedoDrawing);
export const RunIcon = glyph(PlayIcon);
export const TrashIcon = glyph(Delete02Icon);
export const PanelLeftIcon = glyph(SidebarLeftIcon);
export const GraphsIcon = glyph(GridViewIcon);
export const BillingIcon = glyph(CreditCardIcon);
export const MoreIcon = glyph(MoreHorizontalIcon);
export const RenameIcon = glyph(Edit02Icon);
export const DuplicateIcon = glyph(Copy01Icon);
export const SignOutIcon = glyph(Logout01Icon);
