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

import { modelForNode } from '@/app/(app)/models/models';
import { ProviderLogo } from '@/app/provider-logos';

/**
 * What a right-click on the canvas offers: the catalog, one submenu per category in the catalog's
 * order, then Tidy up, which lays the graph out by its wiring (the same op the agent uses). The panel is v2's — the point it opens at, the platform menu it suppresses, the long press
 * that stands in for a right-click on touch — so all that is here is which rows.
 */
export function AddNodeMenu({ onAdd, onArrange }: { onAdd: (type: string) => void; onArrange: () => void }) {
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
                <MenuItem key={def.type} leading={<NodeMark type={def.type} />} onClick={() => onAdd(def.type)}>
                  {def.label}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ))}
      </MenuGroup>
      <MenuGroup>
        <MenuItem onClick={onArrange}>Tidy up</MenuItem>
      </MenuGroup>
    </ContextMenuContent>
  );
}

/**
 * The maker's mark for a row that adds a model, which is what tells four generators apart at a
 * glance. A node that runs no model draws nothing, so the plain categories keep their bare rows.
 */
function NodeMark({ type }: { type: string }) {
  const model = modelForNode(type);
  if (!model) return null;
  return <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} decorative={false} />;
}
