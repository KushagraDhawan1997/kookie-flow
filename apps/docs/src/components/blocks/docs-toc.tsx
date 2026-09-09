'use client';

import * as React from 'react';

import { TableOfContents, type TocEntry } from './table-of-contents';

/**
 * The adapter between this site's MDX and v2's TableOfContents block.
 *
 * The block takes `entries` rather than reading the page, which is the right shape for a site
 * that knows its headings at build time. This one does not: the chapters are MDX rendered by
 * `rehype-slug`, so the ids exist only once the page is in the DOM. So the scanning half —
 * which is all the old kookie-blocks TableOfContents was — lives here, and the rendering,
 * the observer and the naming stay in the block.
 */
export function DocsToc() {
  const [entries, setEntries] = React.useState<readonly TocEntry[]>([]);

  React.useEffect(() => {
    const contentArea = document.querySelector('[data-content-area]');
    if (!contentArea) return;

    const found: TocEntry[] = Array.from(contentArea.querySelectorAll('h2, h3'))
      .filter((h): h is HTMLHeadingElement => h.id !== '')
      .map((h) => ({
        id: h.id,
        title: h.textContent ?? '',
        level: h.tagName === 'H2' ? (2 as const) : (3 as const),
      }))
      .filter((e) => e.title !== '');

    setEntries(found);
  }, []);

  if (entries.length === 0) return null;

  return <TableOfContents entries={entries} />;
}
