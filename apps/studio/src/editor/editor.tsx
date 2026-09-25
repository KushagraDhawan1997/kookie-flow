'use client';

import * as React from 'react';
import NextLink from 'next/link';
import {
  Box,
  Button,
  Flex,
  MenuItem,
  SegmentedControl,
  SegmentedItem,
  Shell,
  ShellContent,
  ShellInspector,
  ShellPaneFooter,
  ShellPaneHeader,
  ShellTrigger,
  SplitButton,
  TextField,
  Toolbar,
  ToolbarButton,
} from '@kushagradhawan/kookie-ui-react';
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
import { BalanceMenu } from '@/app/balance-menu';
import { PanelRightIcon, RedoIcon, RunIcon, UndoIcon } from '@/app/icons';
import { Wordmark } from '@/app/wordmark';
import { ports } from '@/runtime/ports';
import { pendingAskKey } from '@/shared/agent';
import { AgentPanel } from './agent/agent-panel';
import { createAgentHost } from './agent/host';
import { AgentSession } from './agent/session';
import { Canvas } from './canvas';
import { Inspector } from './inspector';
import { NodeLibrary } from './node-library';
import { EditorBus } from './editor-bus';
import { SaveStatus } from './save-status';
import { useAutosave } from './use-autosave';

/** The side panel: a conversation needs more room than an inspector, and the person can drag it. */
const PANE_WIDTH = 480;
const PANE_MIN = 360;
const PANE_MAX = 760;
const PANE_WIDTH_KEY = 'studio:pane-width';

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
  const visibleRef = React.useRef<HTMLDivElement | null>(null);
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
    // The canvas already starts on the stored view (`defaultViewport`). A reload that outran this
    // tab's last save opens on what the tab last had instead, since the render is a revision
    // behind it; see `useAutosave`.
    const { carried } = autosave;
    if (carried) {
      graph.setEntities(carried.doc.entities);
      graph.setEdges(carried.doc.edges);
      setName(carried.name);
      flow.setViewport(carried.doc.viewport);
    }
    // A loaded graph is marked stale by nothing: the store is created holding these same entities
    // and edges, so the first sync diffs to nothing. Restore all of it once so the board opens with
    // every value on screen: cheap nodes run, and paid ones fetch what they already made but submit
    // nothing, since opening a graph is not pressing Run.
    void flow.restoreAll();
  }, [initial]);

  /**
   * Where a node from the library lands: the middle of the canvas the inspector leaves in view,
   * moved down and across past anything already there. Nodes placed earlier in the same batch count
   * too — they are not in the graph yet, so without remembering them a batch of five would stack on
   * one spot.
   */
  const placeAt = React.useCallback((taken: XYPosition[]) => {
    const flow = flowRef.current;
    const el = visibleRef.current;
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
        sizeOf: (entity) => flowRef.current?.getEntityBounds(entity.id) ?? null,
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

  /**
   * The agent's hands on this graph. Built once: it reads the graph and the engine through refs, so
   * nothing the agent does re-renders the editor.
   */
  // Through a ref, so the host and the conversation it serves are made once per graph, whatever
  // identity `applyOps` has this render.
  const applyOpsRef = React.useRef(applyOps);
  applyOpsRef.current = applyOps;
  const agentHost = React.useMemo(
    () =>
      createAgentHost({
        graph: () => graphRef.current,
        flow: () => flowRef.current,
        bus,
        applyOps: (ops) => applyOpsRef.current(ops),
      }),
    [bus]
  );
  const agentSession = React.useMemo(() => new AgentSession(id, agentHost), [id, agentHost]);
  React.useEffect(() => {
    agentSession.open();
    return () => agentSession.close();
  }, [agentSession]);

  // The right pane holds the agent and the inspector. It opens on the agent when an ask is waiting
  // from Home, and otherwise rests closed, as the inspector always has.
  const [paneWidth, setPaneWidthState] = React.useState(PANE_WIDTH);
  React.useEffect(() => {
    // After mount, not at first render: the server rendered the default width.
    try {
      const stored = Number(window.localStorage.getItem(PANE_WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= PANE_MIN && stored <= PANE_MAX) setPaneWidthState(stored);
    } catch {
      // Storage refused: the default width is fine.
    }
  }, []);
  const setPaneWidth = React.useCallback((width: number) => {
    setPaneWidthState(width);
    try {
      window.localStorage.setItem(PANE_WIDTH_KEY, String(width));
    } catch {
      // Storage refused: the width lasts the session.
    }
  }, []);
  const [paneOpen, setPaneOpen] = React.useState(false);
  const [paneView, setPaneView] = React.useState<'agent' | 'inspect'>('agent');
  React.useEffect(() => {
    if (window.sessionStorage.getItem(pendingAskKey(id))) {
      setPaneView('agent');
      setPaneOpen(true);
    }
  }, [id]);

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
  const onArrange = React.useCallback(() => {
    applyOps([{ op: 'arrange' }]);
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 160, duration: 300, maxZoom: 1 }));
  }, [applyOps]);
  const onRemove = React.useCallback((nodeId: string) => applyOps([{ op: 'remove_node', id: nodeId }]), [applyOps]);
  /** Without a position, a node lands where `placeAt` puts it; the canvas's menu passes the click's. */
  const onAdd = React.useCallback(
    (type: string, position?: XYPosition) => applyOps([{ op: 'add_node', type, position }]),
    [applyOps]
  );

  return (
    <Box height="100dvh">
      {/* NO HEADER, as the docs site has none. Everything that row held was either the frame's
          own chrome or a control for the graph on the canvas, and neither belongs in a band
          across the whole window: the mark leads the graph's own row and is the way home, and
          the graph's controls float over the graph. */}
      {/* The pane's width is the frame's token, not the pane's own `width`: the frame publishes the
          safe area the toolbar and the minimap keep clear of from its token, and a pane overriding
          its width would leave that stale (Kookie warns of it). */}
      <Shell style={{ '--shell-inspector-w': `${paneWidth}px` } as React.CSSProperties}>
        {/* NO SIDEBAR. A catalog of a few dozen nodes is reached for, not read, so it is a menu
            and a search on a strip at the canvas's edge, and the canvas has the column's width. */}
        {/* A canvas takes the whole box, and the pane's controls float over it: the graph passes
            behind them, as a docs page passes behind its band. */}
        <ShellContent flush style={{ position: 'relative', overflow: 'hidden' }}>
          <ShellPaneHeader float>
            <Toolbar size="3" backdrop>
              {/* The mark is the way home, as the docs site's is. The link carries the name: the
                  word inside it is a picture of the name and hidden from assistive tech. */}
              <NextLink href="/" aria-label="Studio, home" style={{ color: 'inherit', textDecoration: 'none' }}>
                <Wordmark />
              </NextLink>
              {/* NO SEPARATORS, as the docs band has none: each control is its own capsule and the
                  air between capsules does the separating. The gap is one step wider than the
                  row's own, or two neighbouring capsules read as one long capsule with a seam. */}
              <Flex gap="3" align="center">
                <TextField
                  aria-label="Graph name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  style={{ inlineSize: 240 }}
                />
                {/* Run is what changed, the common case; running everything again is the rarer ask,
                    so it waits behind the chevron. */}
                <SplitButton
                  emphasis="loud"
                  tone="accent"
                  leading={<RunIcon />}
                  onClick={() => void flowRef.current?.evaluateDirty()}
                  menuLabel="More run options"
                  menu={<MenuItem onClick={() => void flowRef.current?.evaluateAll()}>Run all</MenuItem>}
                >
                  Run
                </SplitButton>
                <BalanceMenu inToolbar />
                <ShellTrigger
                  target="inspector"
                  render={
                    <ToolbarButton iconOnly aria-label="Toggle the agent and inspector">
                      <PanelRightIcon />
                    </ToolbarButton>
                  }
                />
              </Flex>
            </Toolbar>
          </ShellPaneHeader>
          <Canvas
            flowRef={flowRef}
            visibleRef={visibleRef}
            bus={bus}
            entities={entities}
            edges={edges}
            defaultViewport={initial.viewport}
            onEntitiesChange={onEntitiesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onWidgetChange={onWidgetChange}
            onEvaluate={onEvaluate}
            onStatusChange={bus.onStatusChange}
            onViewport={autosave.noteViewport}
            onUndo={stepBack}
            onRedo={stepForward}
            onAdd={onAdd}
            onArrange={onArrange}
          />
          {/* Halfway down the left edge, in line with the header's own inset. */}
          <Box
            position="absolute"
            style={{
              insetInlineStart: 'calc(var(--kui-sf-p) + var(--kui-shell-inset-inline-start, 0px))',
              insetBlockStart: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1,
            }}
          >
            <NodeLibrary onAdd={onAdd} />
          </Box>
          {/* The bottom row: appearance, undo and redo each as its own button, then the save line,
              muted, out of the way of the graph's own controls. */}
          <ShellPaneFooter float>
            <Toolbar size="3" backdrop>
              <Flex gap="3" align="center">
                <AppearanceToggle inToolbar />
                <ToolbarButton iconOnly aria-label="Undo" disabled={!canUndo} onClick={stepBack}>
                  <UndoIcon />
                </ToolbarButton>
                <ToolbarButton iconOnly aria-label="Redo" disabled={!canRedo} onClick={stepForward}>
                  <RedoIcon />
                </ToolbarButton>
                <SaveStatus store={autosave.status} />
              </Flex>
            </Toolbar>
          </ShellPaneFooter>
        </ShellContent>

        {/* Not flush: it floats with the frame's gap around it, over the graph. SOLID all the same
            (Kushagra, 2026-09-17): a glass pane let the canvas read through the conversation. The
            glass is on what floats over the chat inside it instead, the tabs here and the composer
            and the jump button in the panel, each stating `backdrop` for itself; a `Box backdrop`
            region would have to wrap the pane's children, and the pane lays out its direct
            children. Wide enough for a conversation and resizable; the width is remembered on the
            Shell's token. */}
        <ShellInspector
          aria-label="Agent and inspector"
          flush={false}
          open={paneOpen}
          onOpenChange={setPaneOpen}
          resizable
          minWidth={PANE_MIN}
          maxWidth={PANE_MAX}
          onResize={setPaneWidth}
          resizeLabel="Resize the panel"
        >
          {/* Floating over the agent's transcript, which fades under it; pinned above the inspector,
              whose fields it must not cover. */}
          <ShellPaneHeader float={paneView === 'agent'}>
            <SegmentedControl
              backdrop
              value={paneView}
              onValueChange={(value) => setPaneView(value === 'inspect' ? 'inspect' : 'agent')}
              aria-label="Pane"
            >
              <SegmentedItem value="agent">Agent</SegmentedItem>
              <SegmentedItem value="inspect">Inspect</SegmentedItem>
            </SegmentedControl>
            {/* Beside the tabs, as a chat panel's "new chat" sits in its header (Cursor, Claude,
                ChatGPT), not as a row of the conversation it clears. */}
            {paneView === 'agent' && (
              <Button emphasis="quiet" backdrop onClick={() => void agentSession.startOver()}>
                Start over
              </Button>
            )}
          </ShellPaneHeader>
          {paneView === 'agent' ? (
            <AgentPanel session={agentSession} />
          ) : (
            <Inspector
              entities={entities}
              edges={edges}
              flowRef={flowRef}
              bus={bus}
              onValues={onValues}
              onLabel={onLabel}
              onRemove={onRemove}
            />
          )}
        </ShellInspector>
      </Shell>
    </Box>
  );
}
