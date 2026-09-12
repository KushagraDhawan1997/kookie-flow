"use client";
/**
 * THE TAB BAR (2026-09-09, Kushagra: "when I want it responsive, I want tabs, not necessarily
 * derived from sidebar, but declared by me"). Four places and a search seat, declared here and
 * nowhere derived: the docs have no rail, so `ShellTabBar` is the sidebar-only app's way of
 * saying what a phone gets. Nothing on a wide window. Which tab is current comes from the
 * route, the way the tree marks its current chapter. Search is a `ShellRailAction`, not a
 * fifth tab: it opens a dialog rather than going anywhere, so it sits outside the pill of
 * places as its own pane (§27, 2026-09-09).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShellRailAction, ShellRailItem, ShellRailList, ShellTabBar } from "@kookie-ui/react";

import { BoxIcon, CodeIcon, HomeIcon, SearchIcon, StructureIcon } from "../icons";

/* SEVEN SECTIONS, FOUR TABS. The four are where a reader starts, the thing everything on the
   canvas is, the data work an app is built around, and the reference they return to. Edges,
   Interaction and Styling are one press away in search and in the sidebar; a fifth, sixth and
   seventh tab would shrink every label below reading size on a phone. */
const TABS = [
  { label: "Start", href: "/", icon: HomeIcon, at: (p: string) => p === "/" || p.startsWith("/start/") },
  { label: "Entities", href: "/entities/model", icon: BoxIcon, at: (p: string) => p.startsWith("/entities/") },
  { label: "Data", href: "/data/evaluation", icon: StructureIcon, at: (p: string) => p.startsWith("/data/") },
  { label: "API", href: "/api/kookie-flow", icon: CodeIcon, at: (p: string) => p.startsWith("/api/") },
] as const;

export function DocsTabBar() {
  const pathname = usePathname() ?? "/";
  return (
    <ShellTabBar aria-label="Sections" flush={false} backdrop>
      <ShellRailList>
        {TABS.map(({ label, href, icon: Icon, at }) => (
          <ShellRailItem key={href} label={label} current={at(pathname)} render={<Link href={href} />}>
            <Icon />
          </ShellRailItem>
        ))}
      </ShellRailList>
      <ShellRailAction label="Search" onClick={() => document.dispatchEvent(new CustomEvent("kd:search"))}>
        <SearchIcon />
      </ShellRailAction>
    </ShellTabBar>
  );
}
