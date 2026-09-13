'use client';

import * as React from 'react';
import { Box, ShellNavGroup, ShellNavItem, ShellPaneHeader, ShellScroll, TextField, Toolbar } from '@kookie-ui/react';
import { registry, CATEGORY_LABELS, type AnyNodeDefinition, type Category } from 'studio-core';

import { SearchIcon } from '@/app/icons';

/**
 * The catalog as a searchable column. A click adds the node at the middle of the view.
 *
 * The pane's own chrome floats, as the docs sidebar's does: the rows pass behind the search and
 * fade on the way. `leading` is the frame's way home, handed in so the catalog stays a catalog.
 */
export function NodeLibrary({ onAdd, leading }: { onAdd: (type: string) => void; leading?: React.ReactNode }) {
  const [query, setQuery] = React.useState('');

  const groups = React.useMemo(() => {
    const hits = registry.search(query);
    const byCategory = new Map<Category, AnyNodeDefinition[]>();
    for (const def of hits) {
      const list = byCategory.get(def.category);
      if (list) list.push(def);
      else byCategory.set(def.category, [def]);
    }
    return [...byCategory.entries()];
  }, [query]);

  return (
    <>
      <ShellPaneHeader float>
        <Toolbar backdrop>
          {leading}
          {/* The field takes the rest of the row. A flex item's automatic minimum size is its
              content's, so without `minInlineSize: 0` it refuses to shrink and runs off the
              pane's edge. The wrapper is the control, so the wrapper is what gets sized. */}
          {/* "Search", not "Search nodes": beside the way home the field is ~167px, and the longer
              placeholder clipped to "Search node". The icon already says search; the accessible
              name keeps the full words. */}
          <TextField
            type="search"
            aria-label="Search nodes"
            placeholder="Search"
            leading={<SearchIcon />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flexGrow: 1, minInlineSize: 0 }}
          />
        </Toolbar>
      </ShellPaneHeader>
      <ShellScroll fade>
        {/* The pane's chrome FLOATS over this scroller, so the rows spend the reach the pane
            publishes — the same two lines the docs nav uses. The scroller already insets by the
            pane's padding, which is why that padding comes back off. */}
        <Box
          style={{
            paddingBlockStart: 'calc(var(--kui-pane-inset-block-start) - var(--kui-sf-p))',
            paddingBlockEnd: 'calc(var(--kui-pane-inset-block-end) - var(--kui-sf-p))',
          }}
        >
          {groups.map(([category, defs]) => (
            <ShellNavGroup key={category} label={CATEGORY_LABELS[category]}>
              {defs.map((def) => (
                <ShellNavItem key={def.type} title={def.description} onClick={() => onAdd(def.type)}>
                  {def.label}
                </ShellNavItem>
              ))}
            </ShellNavGroup>
          ))}
        </Box>
      </ShellScroll>
    </>
  );
}
