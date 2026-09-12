'use client';

import * as React from 'react';
import { ShellNavGroup, ShellNavItem, ShellPaneHeader, ShellScroll, TextField } from '@kookie-ui/react';
import { registry, CATEGORY_LABELS, type AnyNodeDefinition, type Category } from 'studio-core';

import { SearchIcon } from '@/app/icons';

/** The catalog as a searchable column. A click adds the node at the middle of the view. */
export function NodeLibrary({ onAdd }: { onAdd: (type: string) => void }) {
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
      <ShellPaneHeader>
        <TextField
          type="search"
          aria-label="Search nodes"
          placeholder="Search nodes"
          leading={<SearchIcon />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </ShellPaneHeader>
      <ShellScroll>
        {groups.map(([category, defs]) => (
          <ShellNavGroup key={category} label={CATEGORY_LABELS[category]}>
            {defs.map((def) => (
              <ShellNavItem key={def.type} title={def.description} onClick={() => onAdd(def.type)}>
                {def.label}
              </ShellNavItem>
            ))}
          </ShellNavGroup>
        ))}
      </ShellScroll>
    </>
  );
}
