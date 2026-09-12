'use client';

import * as React from 'react';
import NextLink from 'next/link';
import {
  Box,
  Flex,
  Shell,
  ShellContent,
  ShellHeader,
  ShellInspector,
  ShellSidebar,
  ShellTrigger,
  TextField,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from '@kookie-ui/react';
import {
  screenToWorld,
  useGraph,
  type Connection,
  type EntityChange,
  type KookieFlowInstance,
  type XYPosition,
} from '@kushagradhawan/kookie-flow';
import {
  compileOps,
  createOnEvaluate,
  registry,
  replacedWires,
  valueBag,
  type GraphDocument,
  type GraphOp,
} from 'studio-core';

import { AppearanceToggle } from '@/app/appearance-toggle';
import { HomeIcon, PanelLeftIcon, PanelRightIcon, RedoIcon, RunIcon, UndoIcon } from '@/app/icons';
import { ports } from '@/runtime/ports';
import { Canvas } from './canvas';
import { Inspector } from './inspector';
import { NodeLibrary } from './node-library';
import { EditorBus } from './editor-bus';
import { SaveStatus } from './save-status';
import { useAutosave } from './use-autosave';

/** A node's box for placement, where the graph states no size of its own. */
const NODE_W = 240;
const NODE_H = 180;
const NODE_GAP = 24;

/** How long a canvas widget's edits are gathered before they are folded into the graph. */
const WIDGET_FOLD_MS = 250;

interface EditorProps {
  id: string;
  name: string;
  initial: GraphDocument;
  /** The revision this document was loaded at; every save is conditional on it. */
  revision: number;
}

export function Editor({ id, name: initialName, initial, revision }: EditorProps) {
  // The library's own undo shortcuts are off: a pending widget fold has to be applied before the
  // graph steps back, or the fold lands afterwards and re-applies what was just undone. The
  // canvas binds Cmd+Z itself (canvas-shortcuts.tsx) and flushes first.
  const graph = useGraph({
    initialEntities: initial.entities,
    initialEdges: initial.edges,
    history: { shortcuts: false },
  });
  const { entities, edges, onEntitiesChange, onEdgesChange, undo, redo, canUndo, canRedo } = graph;
  const { onConnect: connectEdge } = graph;
  const flowRef = React.useRef<KookieFlowInstance | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [name, setName] = React.useState(initialName);
  const autosave = useAutosave(id, entities, edges, name, flowRef, initial, revision);

  // The latest graph, for callbacks that must not close over a stale render.
  const graphRef = React.useRef({ entities, edges });
  graphRef.current = { entities, edges };

  const bus = React.useMemo(() => new EditorBus(), []);
  React.useEffect(() => () => bus.dispose(), [bus]);
  const onEvaluate = React.useMemo(() => createOnEvaluate({ registry, ports }), []);

  React.useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    if (initial.entities.length > 0) flow.setViewport(initial.viewport);
    // A loaded graph is marked stale by nothing: the store is created holding these same entities
    // and edges, so the first sync diffs to nothing. Run all of it once so the board opens with
    // every value on screen rather than every node waiting.
    void flow.evaluateAll();
  }, [initial]);

  /**
   * Where a node from the library lands: the middle of what is on screen, moved down and across
   * past anything already there. Nodes placed earlier in the same batch count too — they are not
   * in the graph yet, so without remembering them a batch of five would stack on one spot.
   */
  const placeAt = React.useCallback((taken: XYPosition[]) => {
    const flow = flowRef.current;
    const el = containerRef.current;
    let x = 0;
    let y = 0;
    if (flow && el) {
      const centre = screenToWorld({ x: el.clientWidth / 2, y: el.clientHeight / 2 }, flow.getViewport());
      x = Math.round(centre.x - NODE_W / 2);
      y = Math.round(centre.y - NODE_H / 2);
    }
    const overlaps = (px: number, py: number) => {
      const hit = (ox: number, oy: number, ow: number, oh: number) =>
        px < ox + ow + NODE_GAP && px + NODE_W + NODE_GAP > ox && py < oy + oh + NODE_GAP && py + NODE_H + NODE_GAP > oy;
      if (taken.some((p) => hit(p.x, p.y, NODE_W, NODE_H))) return true;
      return graphRef.current.entities.some((e) => hit(e.position.x, e.position.y, e.width ?? NODE_W, e.height ?? NODE_H));
    };
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        const cx = x + col * (NODE_W + NODE_GAP);
        const cy = y + row * (NODE_H + NODE_GAP);
        if (!overlaps(cx, cy)) return { x: cx, y: cy };
      }
    }
    return { x, y };
  }, []);

  /**
   * The op door: the node library, the inspector, and later the agent. Canvas gestures — drag,
   * wire, delete, paste, widget — report straight through `useGraph`'s own handlers instead.
   */
  const applyOps = React.useCallback(
    (ops: GraphOp[]) => {
      const placed: XYPosition[] = [];
      const result = compileOps(graphRef.current, ops, registry, {
        placeAt: () => {
          const position = placeAt(placed);
          placed.push(position);
          return position;
        },
      });
      // Both batches in one tick, so history records one step for the lot.
      if (result.entityChanges.length) onEntitiesChange(result.entityChanges);
      if (result.edgeChanges.length) onEdgesChange(result.edgeChanges);
      const removed = result.entityChanges.flatMap((c) => (c.type === 'remove' ? [c.id] : []));
      if (removed.length) bus.forget(removed);
      for (const error of result.errors) console.warn('[studio] op refused:', error.message, error.op);
      return result;
    },
    [bus, onEntitiesChange, onEdgesChange, placeAt]
  );

  /** A new wire replaces whatever the input held; strict mode already refused bad types. */
  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const held = replacedWires(graphRef.current.edges, connection.target, connection.targetSocket);
      if (held.length) onEdgesChange(held.map((edgeId) => ({ type: 'remove' as const, id: edgeId })));
      connectEdge(connection);
    },
    [connectEdge, onEdgesChange]
  );

  /**
   * Canvas widgets keep a local value while a slider moves and report every change here. The
   * report is folded into `data.values` once the gesture goes quiet — a fold is a whole-graph
   * update, so doing it mid-drag rebuilds the store and every GL buffer several times a second
   * for a value the canvas is already drawing from its own override. The fold is what an undo
   * steps back over and what a save writes.
   *
   * A Map, not an object: an entity id is data, and `__proto__` as a key on a plain object
   * writes to the prototype.
   */
  const pendingValues = React.useRef(new Map<string, Map<string, unknown>>());
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushWidgetValues = React.useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const pending = pendingValues.current;
    if (pending.size === 0) return;
    pendingValues.current = new Map();
    const byId = new Map(graphRef.current.entities.map((e) => [e.id, e]));
    const changes: EntityChange[] = [];
    for (const [entityId, touched] of pending) {
      const entity = byId.get(entityId);
      if (!entity) continue;
      changes.push({
        type: 'data',
        id: entityId,
        data: { values: { ...valueBag(entity), ...Object.fromEntries(touched) } },
      });
    }
    if (changes.length) onEntitiesChange(changes);
  }, [onEntitiesChange]);

  const onWidgetChange = React.useCallback(
    (entityId: string, socketId: string, value: unknown) => {
      const bag = pendingValues.current.get(entityId) ?? new Map<string, unknown>();
      bag.set(socketId, value);
      pendingValues.current.set(entityId, bag);
      // Restart the timer on every change: a continuous drag folds once, when it settles.
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null;
        flushWidgetValues();
      }, WIDGET_FOLD_MS);
    },
    [flushWidgetValues]
  );

  React.useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    []
  );

  /** Step history with the canvas's pending values folded in first, or the fold lands after. */
  const stepBack = React.useCallback(() => {
    flushWidgetValues();
    undo();
  }, [flushWidgetValues, undo]);
  const stepForward = React.useCallback(() => {
    flushWidgetValues();
    redo();
  }, [flushWidgetValues, redo]);

  const onValues = React.useCallback(
    (nodeId: string, values: Record<string, unknown>) => applyOps([{ op: 'set_values', id: nodeId, values }]),
    [applyOps]
  );
  const onLabel = React.useCallback(
    (nodeId: string, label: string) => applyOps([{ op: 'set_label', id: nodeId, label }]),
    [applyOps]
  );
  const onRemove = React.useCallback((nodeId: string) => applyOps([{ op: 'remove_node', id: nodeId }]), [applyOps]);
  const onAdd = React.useCallback((type: string) => applyOps([{ op: 'add_node', type }]), [applyOps]);

  return (
    <Box height="100dvh">
      <Shell>
        <ShellHeader>
          <Toolbar>
            <Flex gap="2" align="center">
              <ToolbarButton iconOnly aria-label="All graphs" render={<NextLink href="/" />}>
                <HomeIcon />
              </ToolbarButton>
              <ShellTrigger
                target="sidebar"
                render={
                  <ToolbarButton iconOnly aria-label="Toggle node library">
                    <PanelLeftIcon />
                  </ToolbarButton>
                }
              />
              <TextField
                aria-label="Graph name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                style={{ inlineSize: 240 }}
              />
              <SaveStatus store={autosave.status} />
            </Flex>
            <Flex gap="2" align="center">
              <ToolbarGroup>
                <ToolbarButton iconOnly aria-label="Undo" disabled={!canUndo} onClick={stepBack}>
                  <UndoIcon />
                </ToolbarButton>
                <ToolbarButton iconOnly aria-label="Redo" disabled={!canRedo} onClick={stepForward}>
                  <RedoIcon />
                </ToolbarButton>
              </ToolbarGroup>
              <ToolbarSeparator />
              <ToolbarButton emphasis="loud" tone="accent" leading={<RunIcon />} onClick={() => void flowRef.current?.evaluateDirty()}>
                Run
              </ToolbarButton>
              <ToolbarButton onClick={() => void flowRef.current?.evaluateAll()}>Run all</ToolbarButton>
              <ToolbarSeparator />
              <ShellTrigger
                target="inspector"
                render={
                  <ToolbarButton iconOnly aria-label="Toggle inspector">
                    <PanelRightIcon />
                  </ToolbarButton>
                }
              />
              <AppearanceToggle inToolbar />
            </Flex>
          </Toolbar>
        </ShellHeader>

        <ShellSidebar aria-label="Node library" defaultOpen width={264}>
          <NodeLibrary onAdd={onAdd} />
        </ShellSidebar>

        {/* The pane's padding is for content that reads; a canvas takes the whole box. */}
        <ShellContent style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
          <Canvas
            flowRef={flowRef}
            containerRef={containerRef}
            bus={bus}
            entities={entities}
            edges={edges}
            onEntitiesChange={onEntitiesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onWidgetChange={onWidgetChange}
            onEvaluate={onEvaluate}
            onStatusChange={bus.onStatusChange}
            onViewport={autosave.noteViewport}
            onUndo={stepBack}
            onRedo={stepForward}
          />
        </ShellContent>

        <ShellInspector aria-label="Inspector" defaultOpen width={320}>
          <Inspector
            entities={entities}
            edges={edges}
            flowRef={flowRef}
            bus={bus}
            onValues={onValues}
            onLabel={onLabel}
            onRemove={onRemove}
          />
        </ShellInspector>
      </Shell>
    </Box>
  );
}
