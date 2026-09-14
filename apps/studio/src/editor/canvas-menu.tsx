'use client';

import * as React from 'react';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from '@kookie-ui/react';
import { registry } from 'studio-core';

/**
 * What a right-click on the canvas offers: the catalog, one submenu per category in the catalog's
 * order. The panel is v2's — the point it opens at, the platform menu it suppresses, the long press
 * that stands in for a right-click on touch — so all that is here is which rows.
 */
export function AddNodeMenu({ onAdd }: { onAdd: (type: string) => void }) {
  const categories = React.useMemo(() => registry.categories(), []);
  return (
    <ContextMenuContent>
      <MenuGroup>
        <MenuLabel>Add node</MenuLabel>
        {categories.map((category) => (
          <MenuSub key={category.id}>
            <MenuSubTrigger>{category.label}</MenuSubTrigger>
            <MenuSubContent>
              {category.nodes.map((def) => (
                <MenuItem key={def.type} onClick={() => onAdd(def.type)}>
                  {def.label}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ))}
      </MenuGroup>
    </ContextMenuContent>
  );
}
