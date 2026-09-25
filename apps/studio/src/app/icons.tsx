/**
 * The studio's glyphs: Hugeicons, one named wrapper per glyph. Call sites say what a glyph MEANS
 * (`RunIcon`), not which drawing was picked, so swapping a drawing is one edit here. Decorative
 * by default; the control that owns the glyph carries the accessible name. No `size`: the slot's
 * box is the system's.
 */
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { iconStroke } from '@kushagradhawan/kookie-ui-react';
import {
  ArrowLeft01Icon,
  ComputerIcon,
  Copy01Icon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  Edit02Icon,
  Home01Icon,
  Image01Icon,
  ImageAdd01Icon,
  ArrowExpand01Icon,
  Scissor01Icon,
  Video01Icon,
  WorkflowSquare01Icon,
  AiMagicIcon,
  ArrowRight01Icon,
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
  ArrowUp02Icon,
  StopIcon as StopGlyph,
  RefreshIcon,
  ArrowUpRight01Icon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  Tick02Icon,
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
export const GraphsIcon = glyph(WorkflowSquare01Icon);
export const BillingIcon = glyph(CreditCardIcon);
export const MoreIcon = glyph(MoreHorizontalIcon);
export const RenameIcon = glyph(Edit02Icon);
export const DuplicateIcon = glyph(Copy01Icon);
export const SignOutIcon = glyph(Logout01Icon);
export const BackIcon = glyph(ArrowLeft01Icon);
export const TemplatesIcon = glyph(DashboardSquare01Icon);
export const ModelsIcon = glyph(AiMagicIcon);
export const ImageIcon = glyph(Image01Icon);
export const EditImageIcon = glyph(ImageAdd01Icon);
export const VideoIcon = glyph(Video01Icon);
export const UpscaleIcon = glyph(ArrowExpand01Icon);
export const CutoutIcon = glyph(Scissor01Icon);
export const CanvasIcon = glyph(WorkflowSquare01Icon);
export const ArrowRightIcon = glyph(ArrowRight01Icon);
export const SendIcon = glyph(ArrowUp02Icon);
export const StopIcon = glyph(StopGlyph);
export const RetryIcon = glyph(RefreshIcon);
export const CopyIcon = glyph(Copy01Icon);
export const ExternalIcon = glyph(ArrowUpRight01Icon);
export const ChevronDownIcon = glyph(ArrowDown01Icon);
export const ArrowDownIcon = glyph(ArrowDown02Icon);
export const CheckIcon = glyph(Tick02Icon);
export const AutoIcon = glyph(AiMagicIcon);
