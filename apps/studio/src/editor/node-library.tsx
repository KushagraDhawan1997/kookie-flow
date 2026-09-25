'use client';

import * as React from 'react';
import {
  Command,
  CommandCollection,
  CommandContent,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  Text,
  Toolbar,
  ToolbarButton,
} from '@kushagradhawan/kookie-ui-react';
import { registry, CATEGORY_LABELS, type AnyNodeDefinition, type Category } from 'studio-core';

import { modelForNode } from '@/app/(app)/models/models';
import { PlusIcon, SearchIcon } from '@/app/icons';
import { ProviderLogo } from '@/app/provider-logos';

type OnAdd = (type: string) => void;

/**
 * The catalog as a strip of tools at the canvas's edge. + opens a palette over the whole catalog,
 * and so does ⌘K from anywhere in the editor. Choosing a node adds it at the middle of the view.
 */
export function NodeLibrary({ onAdd }: { onAdd: OnAdd }) {
  const [open, setOpen] = React.useState(false);

  // ⌘K / Ctrl-K. On the document, in the capture phase, so the canvas's own key handling cannot
  // take it first; `preventDefault` because Chrome's ⌘K focuses the address bar.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <>
      <Toolbar size="3" orientation="vertical" backdrop aria-label="Add nodes">
        <ToolbarButton iconOnly emphasis="loud" aria-label="Add node" onClick={() => setOpen(true)}>
          <PlusIcon />
        </ToolbarButton>
      </Toolbar>
      {/* Outside the toolbar. React carries a portal's key events up the component tree, and in
          the palette the up and down arrows belong to its list, not to the toolbar's focus. */}
      <NodePalette open={open} onOpenChange={setOpen} onAdd={onAdd} />
    </>
  );
}

/** One category's matching nodes. Base UI reads only `items`; `key` names the section. */
interface Section {
  key: Category;
  items: AnyNodeDefinition[];
}

interface NodePaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: OnAdd;
}

/**
 * The catalog in sections, one per category, in the catalog's order.
 *
 * The matcher is the catalog's own rather than Base UI's: `registry.search` reads descriptions and
 * socket names too, so "prompt" finds the generators. The sections arrive narrowed, with any
 * category nothing matched left out, so the palette is told not to narrow them again.
 */
function NodePalette({ open, onOpenChange, onAdd }: NodePaletteProps) {
  const [query, setQuery] = React.useState('');
  // The field opens empty, so the list does too: cleared while rendering the open itself, so its
  // first frame lists the whole catalog. Cleared on close instead, the list refilled while the
  // panel was still on its way out, under the words that had narrowed it.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery('');
  }
  const sections = React.useMemo(() => {
    const byCategory = new Map<Category, AnyNodeDefinition[]>();
    for (const def of registry.search(query)) {
      const list = byCategory.get(def.category);
      if (list) list.push(def);
      else byCategory.set(def.category, [def]);
    }
    return Array.from(byCategory, ([key, items]): Section => ({ key, items }));
  }, [query]);

  return (
    <Command items={sections} open={open} onOpenChange={onOpenChange}>
      <CommandContent aria-label="Add node" filter={null} onQueryChange={setQuery}>
        <CommandInput aria-label="Search nodes" placeholder="Search nodes" leading={<SearchIcon />} />
        <CommandList>
          {(section: Section) => (
            <CommandGroup key={section.key} items={section.items}>
              <CommandGroupLabel>{CATEGORY_LABELS[section.key]}</CommandGroupLabel>
              <CommandCollection>
                {(def: AnyNodeDefinition) => (
                  <CommandItem key={def.type} value={def} leading={<NodeMark type={def.type} />} onClick={() => onAdd(def.type)}>
                    {def.label}
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
        <CommandEmpty>
          <Text>No node matches.</Text>
        </CommandEmpty>
      </CommandContent>
    </Command>
  );
}

/** The maker's mark on a row that adds a model; nothing on a row that runs none. */
function NodeMark({ type }: { type: string }) {
  const model = modelForNode(type);
  if (!model) return null;
  return <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} decorative={false} />;
}
