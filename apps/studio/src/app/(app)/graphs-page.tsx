'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Flex,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Notice,
  Page,
  Stack,
  Text,
  TextField,
  ToolbarButton,
} from '@kookie-ui/react';

import type { GraphSummary } from '@/server/graphs';
import { EmptyState } from '../empty-state';
import { DuplicateIcon, GraphsIcon, MoreIcon, PlusIcon, RenameIcon, SearchIcon, TrashIcon } from '../icons';
import { LocalTime } from '../local-time';
import { AppPane } from './app-shell';
import './graphs-page.css';

export function GraphsPage({ initial }: { initial: GraphSummary[] }) {
  const router = useRouter();
  const [graphs, setGraphs] = React.useState(initial);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<GraphSummary | null>(null);
  const [deleting, setDeleting] = React.useState<GraphSummary | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch('/api/graphs');
      if (!res.ok) return;
      const body = (await res.json()) as { graphs: GraphSummary[] };
      setGraphs(body.graphs);
    } catch {
      // An offline list is the one that was rendered; nothing to say about it.
    }
  }, []);

  // The browser's back button restores this page from its cache, so what was rendered on the
  // server can be minutes old: a graph renamed since then, or one deleted in another tab, would
  // sit in the list until a reload.
  React.useEffect(() => {
    void reload();
    addEventListener('pageshow', reload);
    return () => removeEventListener('pageshow', reload);
  }, [reload]);

  /** Create one, or copy `from`, and go to it. */
  const create = async (from?: string) => {
    setCreating(true);
    setProblem(null);
    try {
      const res = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(from ? { from } : {}),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      if (from) {
        setCreating(false);
        await reload();
        return;
      }
      // Deliberately still busy: the navigation is under way and this component is about to go.
      // Clearing it here let a second click make a second, orphaned graph.
      router.push(`/g/${id}`);
    } catch (error) {
      setCreating(false);
      setProblem(error instanceof Error ? error.message : 'The graph could not be created.');
    }
  };

  const rename = async (graph: GraphSummary, name: string) => {
    const trimmed = name.trim();
    setRenaming(null);
    if (!trimmed || trimmed === graph.name) return;
    setGraphs((list) => list.map((g) => (g.id === graph.id ? { ...g, name: trimmed } : g)));
    try {
      const res = await fetch(`/api/graphs/${graph.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (error) {
      setProblem(`${graph.name} could not be renamed: ${error instanceof Error ? error.message : 'unknown error'}`);
      void reload();
    }
  };

  const remove = async (graph: GraphSummary) => {
    setProblem(null);
    try {
      const res = await fetch(`/api/graphs/${graph.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      setGraphs((list) => list.filter((g) => g.id !== graph.id));
    } catch (error) {
      setProblem(`${graph.name} could not be deleted: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = needle ? graphs.filter((g) => g.name.toLowerCase().includes(needle)) : graphs;

  const newGraph = (
    <ToolbarButton emphasis="loud" tone="accent" leading={<PlusIcon />} loading={creating} onClick={() => void create()}>
      New graph
    </ToolbarButton>
  );

  return (
    <AppPane actions={newGraph}>
      <Page title="Graphs">
        <Stack gap="6">
          {problem && <Notice tone="destructive">{problem}</Notice>}

          {graphs.length === 0 ? (
            <EmptyState
              mark={<GraphsIcon />}
              title="No graphs yet"
              description="A graph is a canvas of nodes: prompts, models, image and video steps, wired together."
              action={
                <Button emphasis="loud" tone="accent" leading={<PlusIcon />} loading={creating} onClick={() => void create()}>
                  New graph
                </Button>
              }
            />
          ) : (
            <>
              <TextField
                aria-label="Search graphs"
                placeholder="Search"
                leading={<SearchIcon />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="kd-graphs-search"
              />

              {shown.length === 0 ? (
                <EmptyState
                  title="No graphs match"
                  description={`Nothing is called “${query.trim()}”.`}
                  secondary={<Button onClick={() => setQuery('')}>Clear search</Button>}
                />
              ) : (
                <div className="kd-graphs-grid">
                  {shown.map((graph) => (
                    <GraphCard
                      key={graph.id}
                      graph={graph}
                      onRename={() => setRenaming(graph)}
                      onDuplicate={() => void create(graph.id)}
                      onDelete={() => setDeleting(graph)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </Stack>
      </Page>

      <RenameDialog graph={renaming} onClose={() => setRenaming(null)} onRename={rename} />

      {/* Deleting is permanent and there is no copy anywhere else, so it asks. */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>The graph and everything in it goes for good. There is no copy.</AlertDialogDescription>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleting) void remove(deleting);
              setDeleting(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </AppPane>
  );
}

interface GraphCardProps {
  graph: GraphSummary;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * One graph: its picture, its name and when it was last touched. No card: a card groups or
 * contains, and a tile in a grid needs neither — the picture is the object. The whole tile opens it — the
 * name's link stretches over the card — and the menu sits above that link, so the two presses
 * never collide.
 */
function GraphCard({ graph, onRename, onDuplicate, onDelete }: GraphCardProps) {
  return (
    <div className="kd-graph-card">
      <div className="kd-graph-cover">
        {graph.cover ? (
          // A stored asset of unknown size and origin; Next's image pipeline has nothing to add.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={graph.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <LayoutSketch layout={graph.layout} />
        )}
      </div>
      <Flex align="center" justify="space-between" gap="2" className="kd-graph-meta">
        <Stack gap="0" className="kd-graph-words">
          <NextLink href={`/g/${graph.id}`} className="kd-graph-link">
            <Text size="2" weight="medium" className="kd-graph-name">
              {graph.name}
            </Text>
          </NextLink>
          <Text size="1" emphasis="medium" className="kd-graph-when">
            Edited <LocalTime iso={graph.updatedAt} relative />
            <span className="kd-graph-count">
              {' '}
              · {graph.nodeCount} {graph.nodeCount === 1 ? 'node' : 'nodes'}
            </span>
          </Text>
        </Stack>
        <Menu>
          <MenuTrigger
            render={
              <Button iconOnly emphasis="quiet" className="kd-graph-menu" aria-label={`Actions for ${graph.name}`}>
                <MoreIcon />
              </Button>
            }
          />
          <MenuContent align="end">
            <MenuItem leading={<RenameIcon />} onClick={onRename}>
              Rename
            </MenuItem>
            <MenuItem leading={<DuplicateIcon />} onClick={onDuplicate}>
              Duplicate
            </MenuItem>
            <MenuItem leading={<TrashIcon />} tone="destructive" onClick={onDelete}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </Flex>
    </div>
  );
}

/**
 * The smallest stretch of canvas a cover shows, in canvas units at the cover's 4:3. Fitting the
 * graph alone blew two nodes up to fill the tile; with a floor, a small graph reads as small.
 */
const MIN_VIEW = { w: 1000, h: 750 };

/**
 * A graph with no picture yet still has a shape: a mini-map of its nodes and the wires between
 * them, at their canvas positions. An empty graph draws nothing and the cover's ground carries it.
 */
function LayoutSketch({ layout }: { layout: GraphSummary['layout'] }) {
  // The meta line already says "0 nodes"; the bare ground is the empty graph.
  if (layout.nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of layout.nodes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 120;
  const w = Math.max(maxX - minX + pad * 2, MIN_VIEW.w, ((maxY - minY + pad * 2) * 4) / 3);
  const h = (w * 3) / 4;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (
    <svg
      viewBox={`${cx - w / 2} ${cy - h / 2} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      className="kd-graph-sketch"
    >
      {layout.wires.map((l, i) => {
        const bend = Math.max(60, Math.abs(l.x2 - l.x1) / 2);
        return (
          <path
            key={`w${i}`}
            className="kd-graph-sketch-wire"
            d={`M${l.x1} ${l.y1} C${l.x1 + bend} ${l.y1} ${l.x2 - bend} ${l.y2} ${l.x2} ${l.y2}`}
          />
        );
      })}
      {layout.nodes.map((b, i) => (
        <g key={i}>
          <rect className="kd-graph-sketch-node" x={b.x} y={b.y} width={b.w} height={b.h} rx={20} />
          {b.media && (
            <rect
              className="kd-graph-sketch-band"
              x={b.x + 10}
              y={b.y + 10}
              width={b.w - 20}
              height={Math.min(160, b.h - 20)}
              rx={12}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

interface RenameDialogProps {
  graph: GraphSummary | null;
  onClose: () => void;
  onRename: (graph: GraphSummary, name: string) => void;
}

function RenameDialog({ graph, onClose, onRename }: RenameDialogProps) {
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (graph) setName(graph.name);
  }, [graph]);

  return (
    <Dialog open={graph !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (graph) onRename(graph, name);
          }}
        >
          <Stack gap="5">
            <DialogTitle>Rename graph</DialogTitle>
            <TextField aria-label="Name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
            <Flex gap="3" justify="end">
              <DialogClose render={<Button />}>Cancel</DialogClose>
              <Button type="submit" emphasis="loud" tone="accent" disabled={!name.trim()}>
                Rename
              </Button>
            </Flex>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  );
}
