'use client';

import * as React from 'react';
import { Box, ContextMenu, ContextMenuTrigger, Theme } from '@kookie-ui/react';
import {
  KookieFlow,
  screenToWorld,
  Toolbar,
  type Connection,
  type Edge,
  type EdgeChange,
  type Entity,
  type EntityChange,
  type KookieFlowInstance,
  type OnEvaluate,
  type OnStatusChange,
  type Viewport,
  type XYPosition,
} from '@kushagradhawan/kookie-flow';
import { registry, SOCKET_TYPES } from 'studio-core';

import { AddNodeMenu } from './canvas-menu';
import { CanvasShortcuts } from './canvas-shortcuts';
import type { EditorBus } from './editor-bus';
import { withRunToolbar } from './node-toolbar';
import { SelectionBridge } from './selection-bridge';
import { StoreBridge, type FlowStoreApi } from './store-bridge';
import { ViewportBridge } from './viewport-bridge';

interface CanvasProps {
  flowRef: React.RefObject<KookieFlowInstance | null>;
  /** The part of the canvas no pane covers, which a new node's landing spot is measured on. */
  visibleRef: React.RefObject<HTMLDivElement | null>;
  bus: EditorBus;
  entities: Entity[];
  edges: Edge[];
  /**
   * The stored view, which the canvas starts on. Moved there after mount instead, the canvas spent
   * its first commit at the origin, autosave read that as a pan, and opening a graph wrote the
   * origin over the view it was saved with.
   */
  defaultViewport: Viewport;
  onEntitiesChange: (changes: EntityChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onWidgetChange: (entityId: string, socketId: string, value: unknown) => void;
  onEvaluate: OnEvaluate;
  onStatusChange: OnStatusChange;
  onViewport: (viewport: Viewport) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Add a node: at a world position, or without one wherever the editor places new nodes. */
  onAdd: (type: string, position?: XYPosition) => void;
}

/** A right-click, with Base UI's escape for standing its own handler down. */
type ContextMenuEvent = React.MouseEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void };

/**
 * The canvas runs on under the floating inspector, which is glass over it. What has to stay in
 * view clears the inspector's reach instead, which the frame publishes on the content pane and is
 * zero while the inspector is closed: the minimap's corner, and a box that is measured and never
 * seen, whose middle is where a new node lands.
 */
const VISIBLE_PART: React.CSSProperties = {
  insetInlineEnd: 'var(--kui-shell-inset-inline-end, 0px)',
  pointerEvents: 'none',
};
/** The library's own 10px corner, moved past the reach. */
const MINIMAP_CLEAR: React.CSSProperties = { right: 'calc(10px + var(--kui-shell-inset-inline-end, 0px))' };

/**
 * The graph itself, behind a memo boundary.
 *
 * Everything the editor does that is not the graph — a keystroke in the name field, undo becoming
 * available — re-renders `Editor`. Without this boundary each of those re-rendered the whole flow:
 * the R3F root, every GL layer, the widget tree. Every prop here is stable across such a render,
 * so the boundary actually holds.
 */
function CanvasImpl(props: CanvasProps) {
  const { flowRef, bus, onAdd } = props;
  const entityTypes = React.useMemo(() => withRunToolbar(registry.entityTypes(), flowRef, bus), [flowRef, bus]);
  const storeRef = React.useRef<FlowStoreApi | null>(null);
  // Where the last right-click landed, in world space. A ref, so opening the menu renders nothing
  // but the menu.
  const pointRef = React.useRef<XYPosition | undefined>(undefined);

  /**
   * Base UI runs this before its own handler and lets it stand that down. The menu opens on the
   * canvas's empty ground only. A node under the pointer is not a place to add one, and neither is
   * a control over the canvas (the minimap, a node's toolbar); both get no menu at all, since the
   * platform's own means nothing over a graph. A text field keeps the platform's, where paste and
   * spelling live.
   */
  const onContextMenu = React.useCallback(
    (event: ContextMenuEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable]')) {
        event.preventBaseUIHandler?.();
        return;
      }
      if (target?.closest('button, [role="toolbar"], .kd-minimap') || storeRef.current?.getState().hoveredEntityId) {
        event.preventDefault();
        event.preventBaseUIHandler?.();
        return;
      }
      const flow = flowRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const world = flow
        ? screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, flow.getViewport())
        : null;
      pointRef.current = world ? { x: Math.round(world.x), y: Math.round(world.y) } : undefined;
    },
    [flowRef]
  );
  const addAtPoint = React.useCallback((type: string) => onAdd(type, pointRef.current), [onAdd]);

  return (
    <ContextMenu>
      {/* The canvas is the trigger itself, through `render`: a wrapper would stand between the
          content pane and the box that fills it. */}
      <ContextMenuTrigger
        onContextMenu={onContextMenu}
        render={<Box className="kd-canvas" position="absolute" inset="0" />}
      >
        <Box ref={props.visibleRef} position="absolute" inset="0" style={VISIBLE_PART} />
        <KookieFlow
          ref={flowRef}
          entities={props.entities}
          edges={props.edges}
          entityTypes={entityTypes}
          socketTypes={SOCKET_TYPES}
          defaultViewport={props.defaultViewport}
          onEntitiesChange={props.onEntitiesChange}
          onEdgesChange={props.onEdgesChange}
          onConnect={props.onConnect}
          onWidgetChange={props.onWidgetChange}
          onEvaluate={props.onEvaluate}
          onStatusChange={props.onStatusChange}
          connectionMode="strict"
          allowCycles={false}
          showGrid
          // An empty graph has nothing to map, and an empty white box in the corner reads as broken.
          showMinimap={props.entities.length > 0}
          minimapProps={{
            position: 'bottom-right',
            width: 160,
            height: 112,
            className: 'kd-minimap',
            style: MINIMAP_CLEAR,
          }}
          header="inside"
          ThemeComponent={Theme}
          ariaLabel="Studio graph"
        >
          <Toolbar />
          <CanvasShortcuts
            onEntitiesChange={props.onEntitiesChange}
            onEdgesChange={props.onEdgesChange}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
          />
          <SelectionBridge bus={bus} />
          <ViewportBridge onViewport={props.onViewport} />
          <StoreBridge storeRef={storeRef} />
        </KookieFlow>
      </ContextMenuTrigger>
      <AddNodeMenu onAdd={addAtPoint} />
    </ContextMenu>
  );
}

export const Canvas = React.memo(CanvasImpl);
