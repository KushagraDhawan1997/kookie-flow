/**
 * The docs' glyphs — Hugeicons, one named wrapper per glyph (2026-08-10, Kushagra: "The docs
 * app should only use hugeicons").
 *
 * This is not a hole in "no third-party UI". That stance is about COMPONENTS: a design system
 * whose docs run on someone else's buttons argues against itself. §8 says the opposite about
 * icons in as many words — the package ships no icon dependency, icons are `ReactNode` slots,
 * and *the app installs its own set*. The hand-drawn strokes that were here were the app
 * declining to install one, which was fine while three glyphs were enough and stopped being
 * fine the day the playground started showing real screens: a toolbar, a member row and a
 * composer are made of glyphs, and drawing them badly makes the composition the thing under
 * judgement instead of the system.
 *
 * `@hugeicons/react` + `@hugeicons/core-free-icons`, both MIT.
 *
 * THIS APP PINS `@hugeicons/core-free-icons` AT 3.1.1, which predates four drawings the set
 * later added (Blocks, Toolbox, Badge, FolderTree). Those four wrappers wear the nearest 3.1.1
 * drawing under the same export name, so a call site never learns which version is installed.
 *
 * Wrappers rather than re-exports, for two reasons. The call sites say what the glyph MEANS
 * (`SearchIcon`) rather than which drawing was picked (`Search01Icon`), so swapping a drawing
 * is one edit here. And the props that must be right every time — `aria-hidden`, and NOT
 * passing `size` — are set once. Size is deliberately absent: the control layer sizes a slot's
 * svg through `--kui-ct-icon` (recipes.css), and `size` would emit width/height attributes
 * that the CSS then has to beat. It does beat them, presentation attributes losing to any
 * declaration, but relying on that is a mechanism nobody wrote down.
 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { iconStroke } from "@kookie-ui/react";
import {
  AiProgrammingIcon,
  Alert02Icon,
  ComputerIcon,
  GithubIcon,
  NewTwitterIcon,
  Moon02Icon,
  Sun03Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  DashboardSquare01Icon,
  BlurIcon,
  BrowserIcon,
  CheckListIcon,
  ColorsIcon,
  CompassIcon as HugeCompassIcon,
  Cursor01Icon,
  Download01Icon,
  File01Icon,
  IdeaIcon as HugeIdeaIcon,
  Layers01Icon,
  Layout01Icon,
  Megaphone01Icon,
  MotionIcon as HugeMotionIcon,
  RadiusIcon as HugeRadiusIcon,
  Wrench01Icon,
  RulerIcon,
  BookOpen01Icon,
  SmartPhone01Icon,
  Structure01Icon,
  PreferenceHorizontalIcon,
  TextFontIcon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  Attachment01Icon,
  Cancel01Icon,
  Copy01Icon,
  Link02Icon,
  Delete02Icon,
  EyeIcon,
  FlashIcon,
  GridViewIcon,
  LayerIcon,
  PaintBoardIcon,
  ChartLineData01Icon,
  Folder01Icon,
  Home01Icon,
  Mail01Icon,
  Mic01Icon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Notification02Icon,
  PlusSignIcon,
  ReloadIcon,
  Search01Icon,
  Settings02Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  SquareLock02Icon,
  StopIcon,
  Tick02Icon,
  UserMultiple02Icon,
  CheckmarkBadge01Icon,
  Cards01Icon,
  Remove01Icon,
  CheckmarkSquare01Icon,
  CodeIcon as HugeCodeIcon,
  Comment01Icon,
  CommandIcon as HugeCommandIcon,
  CursorPointer01Icon,
  DistributeHorizontalCenterIcon,
  DropdownFieldTypeIcon,
  HierarchyFilesIcon,
  GridIcon as HugeGridIcon,
  Heading01Icon,
  HierarchySquare03Icon,
  InformationCircleIcon,
  KeyboardIcon,
  LayoutThreeColumnIcon,
  LayoutThreeRowIcon,
  LayoutTopIcon,
  Layout05Icon,
  LayoutGridIcon,
  LeftToRightListDashIcon,
  ListViewIcon,
  Loading03Icon,
  Menu01Icon,
  MenuSquareIcon,
  Message01Icon,
  Note03Icon,
  Progress03Icon,
  QuoteDownIcon,
  RadioButtonIcon,
  Rectangular01Icon,
  Route02Icon,
  ScrollVerticalIcon,
  DistributeVerticalCenterIcon,
  SlidersHorizontalIcon,
  SourceCodeSquareIcon,
  SquareIcon,
  SquareSquareIcon,
  StickyNote01Icon,
  Tag01Icon,
  TableIcon as HugeTableIcon,
  TextAlignLeftIcon,
  TextBoldIcon,
  TextIcon as HugeTextIcon,
  ToggleOnIcon,
  TypeCursorIcon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";

/**
 * One shape for every glyph below: decorative by default (the control that owns it carries the
 * accessible name), stroke 1.5, and no size — the slot's box is the system's.
 *
 * The stroke is the PACKAGE's (2026-08-23). It was 1.5 stated here, which is the same literal
 * the package's own chevrons carry — and they did not match, because those are drawn on a 16
 * viewBox and Hugeicons on a 24, so one number painted 1.5px there and 1.0px here. `iconStroke`
 * is the number for the 24 grid, and the package converts it for its own. It is not absolute:
 * `absoluteStrokeWidth` would rescale the stroke against the `size` prop, and this file never
 * passes one — the box comes from CSS, so there is nothing for it to scale against and the
 * flag would silently do nothing.
 */
const glyph = (icon: IconSvgElement) =>
  function Glyph() {
    return <HugeiconsIcon icon={icon} strokeWidth={iconStroke} aria-hidden />;
  };

export const SearchIcon = glyph(Search01Icon);
/* The frame's own chrome (2026-09-06): the repository, and the three appearance choices the
   footer's picker draws. The glyph IS the value here — an icon-only control shows which
   appearance is chosen by which mark it wears — so these three are named for the choice
   rather than for the drawing, like every other wrapper in this file. */
export const GitHubIcon = glyph(GithubIcon);
/* The social marks. `XSocialIcon` rather than `XIcon` because that name is already the CLOSE
   glyph one export down — a dismissal and a platform are two different things wearing one
   letter, and the call site has to be able to tell them apart. */
export const XSocialIcon = glyph(NewTwitterIcon);
export const SunIcon = glyph(Sun03Icon);
export const MoonIcon = glyph(Moon02Icon);
export const SystemIcon = glyph(ComputerIcon);
export const PlusIcon = glyph(PlusSignIcon);
export const XIcon = glyph(Cancel01Icon);
export const CheckIcon = glyph(Tick02Icon);
export const MailIcon = glyph(Mail01Icon);
export const LockIcon = glyph(SquareLock02Icon);
export const BellIcon = glyph(Notification02Icon);
export const MinusIcon = glyph(MinusSignIcon);
export const MoreIcon = glyph(MoreHorizontalIcon);
export const ArrowUpIcon = glyph(ArrowUp02Icon);
export const ArrowLeftIcon = glyph(ArrowLeft02Icon);
export const ArrowRightIcon = glyph(ArrowRight02Icon);
/* The chevrons, which are a different glyph from the arrows above and mean a different thing: an
   arrow says GO somewhere, a chevron says the next one along. */
export const ChevronLeftIcon = glyph(ArrowLeft01Icon);
export const ChevronRightIcon = glyph(ArrowRight01Icon);
export const PaperclipIcon = glyph(Attachment01Icon);
export const HomeIcon = glyph(Home01Icon);
export const FolderIcon = glyph(Folder01Icon);
export const ChartIcon = glyph(ChartLineData01Icon);
export const SettingsIcon = glyph(Settings02Icon);
export const UsersIcon = glyph(UserMultiple02Icon);

/* Editor chrome. Named for the JOB, like every glyph above:
   the toolbar says undo, not "arrow turning backward". */
export const UndoIcon = glyph(ArrowTurnBackwardIcon);
export const RedoIcon = glyph(ArrowTurnForwardIcon);
export const PreviewIcon = glyph(EyeIcon);
export const LayersIcon = glyph(LayerIcon);
export const PanelLeftIcon = glyph(SidebarLeftIcon);
export const PanelRightIcon = glyph(SidebarRightIcon);
export const CopyIcon = glyph(Copy01Icon);
export const LinkIcon = glyph(Link02Icon);
/* The code sample's NAME button (2026-08-28). It copies a path, so its glyph names the object
   rather than the verb — the copy mark is the code button's, one pane-width away. */
export const FileIcon = glyph(File01Icon);
export const TrashIcon = glyph(Delete02Icon);
/* The composer's four (2026-08-23). The send button is one control with four meanings, so the
   three it can turn into are named for the meaning rather than the drawing: a filled square is
   the universal stop, and a reload is a retry. `MicIcon` is dictation, which the composer does
   not own — the app draws that button, which is exactly why these live here. */
export const BoltIcon = glyph(FlashIcon);
export const MicIcon = glyph(Mic01Icon);
export const StopSquareIcon = glyph(StopIcon);
export const RetryIcon = glyph(ReloadIcon);

export const WarnIcon = glyph(Alert02Icon);

/* The sidebar's Workbench rows (2026-08-26). Named for the destination's meaning. */
export const BoardIcon = glyph(PaintBoardIcon);
export const MatrixIcon = glyph(GridViewIcon);
export const BlocksIcon = glyph(DashboardSquare01Icon);

/* The chapter rows (2026-08-26). One glyph per chapter, named for the chapter's SUBJECT so the
   nav map in docs-nav.tsx reads as a table of contents. */
export const InstallIcon = glyph(Download01Icon);
/* Sliders, not a paint swatch. A swatch says COLOUR, and colour is one of the eight things a
   Theme sets — it is also its own chapter, two rows down, wearing three overlapping circles.
   What a Theme actually is is several app-wide dials set at once, which is what this glyph
   draws. Checked at 16px against the rest of the column: nothing else in the nav uses
   sliders. */
export const ThemeIcon = glyph(PreferenceHorizontalIcon);
/* A toolbox, not a rocket (a wrench under 3.1.1 — see the note at the top). The rocket is the launch cliché, and it says "ship" where this
   chapter says "build your first screen". The three Getting started glyphs now read as one
   sequence — get it, set it up, build with it — and a toolbox is a closed silhouette that
   survives 16px, where the hammer's diagonal head goes busy. */
export const BuildIcon = glyph(Wrench01Icon);
/* Code with a spark on it, for the chapter about handing this library to an AI agent. Not a
   robot: a robot is the AI cliché the way a rocket is the shipping cliché, and it draws a
   machine where the chapter is about what gets WRITTEN. This glyph names the subject — code,
   produced with help — and it keeps the Getting started column reading as one sequence. */
export const AgentIcon = glyph(AiProgrammingIcon);
export const IdeaIcon = glyph(HugeIdeaIcon);
/* An open book, for a chapter that teaches the words the rest of the site uses. It was a set
   of shapes while the chapter was called Component families, where different shapes stood for
   different kinds of thing. Under the name Vocabulary that reading is gone, and a shapes glyph
   sits next to Radius and Layout in the same nav, where it reads as geometry. */
export const VocabularyIcon = glyph(BookOpen01Icon);
export const ColorIcon = glyph(ColorsIcon);
export const TypeIcon = glyph(TextFontIcon);
export const LayoutIcon = glyph(Layout01Icon);
export const SizeIcon = glyph(RulerIcon);
export const RadiusIcon = glyph(HugeRadiusIcon);
export const MaterialIcon = glyph(BlurIcon);
export const DepthIcon = glyph(Layers01Icon);
export const MotionIcon = glyph(HugeMotionIcon);
export const CursorIcon = glyph(Cursor01Icon);
export const DeviceIcon = glyph(SmartPhone01Icon);
export const StructureIcon = glyph(Structure01Icon);
export const FormIcon = glyph(CheckListIcon);
export const WindowIcon = glyph(BrowserIcon);
export const CompassIcon = glyph(HugeCompassIcon);
export const MegaphoneIcon = glyph(Megaphone01Icon);

/* The component rows (2026-09-07, Kushagra: "Can we assign icons to each component in docs
   sidebar?"). Every row in the sidebar now carries one, which is the point — a leading slot
   that half the rows use is what misaligns a list, and the component group was the last group
   without them.

   Named for the COMPONENT, not for the drawing, like every wrapper above: the glyph is picked
   for what the component is (a Switch wears a switch; a Box wears a plain square) and where no
   drawing exists for the thing itself the pick names its most recognisable use (a Toggle wears
   the bold button every toolbar draws it as). Two components share a drawing under two names
   where the ideas are genuinely the same shape — that is the wrapper's job. */
export const AllComponentsIcon = glyph(LayoutGridIcon);
export const AccordionIcon = glyph(LayoutThreeRowIcon);
export const AvatarIcon = glyph(UserCircleIcon);
export const BadgeIcon = glyph(CheckmarkBadge01Icon);
export const BlockquoteIcon = glyph(QuoteDownIcon);
export const BoxIcon = glyph(SquareIcon);
export const BreadcrumbIcon = glyph(Route02Icon);
export const ButtonIcon = glyph(CursorPointer01Icon);
export const CardIcon = glyph(Cards01Icon);
export const CheckboxIcon = glyph(CheckmarkSquare01Icon);
export const ChipIcon = glyph(Tag01Icon);
export const CodeIcon = glyph(HugeCodeIcon);
export const CodeBlockIcon = glyph(SourceCodeSquareIcon);
export const CommandIcon = glyph(HugeCommandIcon);
export const ComposerIcon = glyph(Message01Icon);
export const ContextMenuIcon = glyph(MenuSquareIcon);
export const DialogIcon = glyph(SquareSquareIcon);
export const FieldIcon = glyph(Note03Icon);
export const FlexIcon = glyph(DistributeHorizontalCenterIcon);
export const GridIcon = glyph(HugeGridIcon);
export const HeadingIcon = glyph(Heading01Icon);
export const KbdIcon = glyph(KeyboardIcon);
export const MenuIcon = glyph(Menu01Icon);
export const NavTreeIcon = glyph(HierarchyFilesIcon);
export const NoticeIcon = glyph(InformationCircleIcon);
export const PopoverIcon = glyph(StickyNote01Icon);
export const ProgressIcon = glyph(Progress03Icon);
export const RadioIcon = glyph(RadioButtonIcon);
export const RadioGroupIcon = glyph(ListViewIcon);
export const RowIcon = glyph(LeftToRightListDashIcon);
export const ScrollAreaIcon = glyph(ScrollVerticalIcon);
export const SegmentedControlIcon = glyph(LayoutThreeColumnIcon);
export const SelectIcon = glyph(DropdownFieldTypeIcon);
export const SeparatorIcon = glyph(Remove01Icon);
export const SliderIcon = glyph(SlidersHorizontalIcon);
export const SpinnerIcon = glyph(Loading03Icon);
export const StackIcon = glyph(DistributeVerticalCenterIcon);
export const SurfaceIcon = glyph(Rectangular01Icon);
export const SwitchIcon = glyph(ToggleOnIcon);
export const TableIcon = glyph(HugeTableIcon);
export const TabsIcon = glyph(Layout05Icon);
export const TextIcon = glyph(HugeTextIcon);
export const TextAreaIcon = glyph(TextAlignLeftIcon);
export const TextFieldIcon = glyph(TypeCursorIcon);
export const ToggleIcon = glyph(TextBoldIcon);
export const ToolbarIcon = glyph(LayoutTopIcon);
export const TooltipIcon = glyph(Comment01Icon);
export const TreeIcon = glyph(HierarchySquare03Icon);
