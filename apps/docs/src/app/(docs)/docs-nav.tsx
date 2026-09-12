"use client";

/**
 * The sidebar's contents — plain nav groups (Kushagra: "lets try sidebar"). A NavTree is a
 * machine for DISCLOSURE, and this navigation has none to do: seven chapter sections, all of it
 * two levels deep with nothing to open. Sections are headings (`ShellNavGroup`, which is the
 * part that connects a heading to the rows under it) and every row is a `ShellNavItem` link.
 *
 * What is given up is the collapse. What is bought is that every destination is one press away
 * and the column has one kind of thing in it.
 *
 * A client component for exactly one reason — `usePathname`, because "you are here" is
 * information and the row announces it as `aria-current="page"` as well as painting it.
 *
 * DATA IS PASSED IN, not imported. The chapter registry's entries carry compiled MDX, so
 * importing it here would drag every chapter into the client bundle to render a list of names.
 * The layout reads the registry on the server and hands this the two fields a link needs.
 */
import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, ShellNavGroup, ShellNavItem, ShellScroll } from "@kookie-ui/react";

import {
  BoardIcon,
  BoltIcon,
  BoxIcon,
  BreadcrumbIcon,
  BuildIcon,
  CodeBlockIcon,
  CodeIcon,
  ColorIcon,
  CommandIcon,
  CompassIcon,
  ContextMenuIcon,
  CopyIcon,
  CursorIcon,
  FileIcon,
  InstallIcon,
  KbdIcon,
  LayersIcon,
  LayoutIcon,
  LinkIcon,
  MatrixIcon,
  NavTreeIcon,
  PaperclipIcon,
  PreviewIcon,
  SettingsIcon,
  SliderIcon,
  SurfaceIcon,
  SwitchIcon,
  TextIcon,
  ThemeIcon,
  ToolbarIcon,
  TreeIcon,
  TypeIcon,
  UndoIcon,
  VocabularyIcon,
} from "../icons";

/**
 * THE ROWS CARRY NO GLYPH. One word turns them back on and nothing else has to move.
 *
 * The table below is intact and every wrapper it names is still exported from `../icons`, so
 * this is a switch rather than a deletion — the alternative was ripping out the table and the
 * imports above it, which makes the way back a rewrite instead of an edit.
 *
 * What it costs while it is off: the table still references those wrappers, so the glyphs are
 * still in the client bundle. If that matters more than the easy way back, the change is to
 * delete this table and its import block; nothing else reads either.
 */
const ROW_ICONS = false;

/* ONE glyph per row, keyed by href because the section data crosses the server boundary as
   `{href, label}` (see the DATA IS PASSED IN note above) and a React component cannot ride in
   it without dragging the elements the other way. A row with no entry here renders bare — the
   lookup is optional by construction, so a new chapter fails nothing and simply
   shows up iconless until it is named here. */
const NAV_ICONS: Record<string, React.ComponentType> = {
  "/start/installation": InstallIcon,
  "/start/quick-start": BuildIcon,
  "/start/state": SwitchIcon,
  "/entities/model": BoxIcon,
  "/entities/sockets": SliderIcon,
  "/entities/types": VocabularyIcon,
  "/entities/frames": SurfaceIcon,
  "/entities/text": TextIcon,
  "/entities/media": PreviewIcon,
  "/edges/edges": LinkIcon,
  "/edges/connections": BreadcrumbIcon,
  "/data/evaluation": BoltIcon,
  "/data/saving": FileIcon,
  "/data/history": UndoIcon,
  "/data/arrange": LayoutIcon,
  "/data/store": LayersIcon,
  "/data/graph-queries": TreeIcon,
  "/data/clipboard": CopyIcon,
  "/interaction/camera": CompassIcon,
  "/interaction/selection": CursorIcon,
  "/interaction/keyboard": KbdIcon,
  "/interaction/toolbar": ToolbarIcon,
  "/interaction/context-menu": ContextMenuIcon,
  "/interaction/drawing": BoardIcon,
  "/interaction/drop-and-paste": PaperclipIcon,
  "/styling/theming": ThemeIcon,
  "/styling/entities": ColorIcon,
  "/styling/fonts": TypeIcon,
  "/styling/minimap": MatrixIcon,
  "/api/kookie-flow": CodeBlockIcon,
  "/api/instance": CommandIcon,
  "/api/hooks": CodeIcon,
  "/api/utilities": SettingsIcon,
  "/api/types": NavTreeIcon,
};

export type NavLink = { href: string; label: string };
export type NavSection = {
  id: string;
  title: string;
  links: readonly NavLink[];
};

/** One row. The href IS the identity, which is the whole current-page wiring. */
function NavRow({ href, label, current }: NavLink & { current: boolean }) {
  const Icon = ROW_ICONS ? NAV_ICONS[href] : undefined;
  return (
    <ShellNavItem
      current={current}
      render={<Link href={href} />}
      {...(Icon ? { leading: <Icon /> } : {})}
    >
      {label}
    </ShellNavItem>
  );
}

export function DocsNav({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();
  const row = (link: NavLink) => (
    <NavRow key={link.href} {...link} current={pathname === link.href} />
  );

  return (
    /* `fade` pairs with the pane's floating chrome (2026-08-30): the rows pass behind the
       wordmark row and the footer, and the fade is what keeps them legible while they do. */
    <ShellScroll fade>
      {/* The pane's chrome FLOATS over this scroller, so the nav spends the published reach
          (§27, the safe-area pattern at pane scale): the rows REST clear of the chrome and
          scroll behind it. Minus the viewport's own re-pad, because the scroller already
          insets by the pane's padding. */}
      <Box
        style={{
          paddingBlockStart:
            "calc(var(--kui-pane-inset-block-start) - var(--kui-sf-p))",
          paddingBlockEnd:
            "calc(var(--kui-pane-inset-block-end) - var(--kui-sf-p))",
        }}
      >
        {sections.map((section) => (
          <ShellNavGroup key={section.id} label={section.title}>
            {section.links.map(row)}
          </ShellNavGroup>
        ))}
      </Box>
    </ShellScroll>
  );
}
