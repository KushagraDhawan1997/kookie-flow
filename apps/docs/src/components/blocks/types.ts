/**
 * The docs navigation shape, previously imported as `DocsNavigationConfig` from
 * `@kushagradhawan/kookie-blocks`. Declared locally because that package peer-depends on
 * KookieUI v1 and did not come with the app to v2.
 */

/** A Hugeicons icon array, which is what `@hugeicons/core-free-icons` exports. */
export type NavIcon = Parameters<
  typeof import('@hugeicons/react').HugeiconsIcon
>[0]['icon'];

export interface DocsNavItem {
  href: string;
  title: string;
  icon?: NavIcon;
}

export interface DocsNavGroup {
  label: string;
  items: DocsNavItem[];
}

export interface DocsNavigationConfig {
  groups: DocsNavGroup[];
}
