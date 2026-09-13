'use client';

import * as React from 'react';
import { Box, Theme } from '@kookie-ui/react';
import {
  KookieFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Entity,
  type EntityChange,
  type KookieFlowInstance,
  type OnEvaluate,
  type OnStatusChange,
  type Viewport,
} from '@kushagradhawan/kookie-flow';
import { registry, SOCKET_TYPES } from 'studio-core';

import { CanvasShortcuts } from './canvas-shortcuts';
import type { EditorBus } from './editor-bus';
import { SelectionBridge } from './selection-bridge';
import { ViewportBridge } from './viewport-bridge';

interface CanvasProps {
  flowRef: React.RefObject<KookieFlowInstance | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
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
}

/**
 * The graph itself, behind a memo boundary.
 *
 * Everything the editor does that is not the graph — a keystroke in the name field, undo becoming
 * available — re-renders `Editor`. Without this boundary each of those re-rendered the whole flow:
 * the R3F root, every GL layer, the widget tree. Every prop here is stable across such a render,
 * so the boundary actually holds.
 */
function CanvasImpl(props: CanvasProps) {
  const entityTypes = React.useMemo(() => registry.entityTypes(), []);
  return (
    <Box ref={props.containerRef} className="kd-canvas" position="absolute" inset="0">
      <KookieFlow
        ref={props.flowRef}
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
        showMinimap
        minimapProps={{ position: 'bottom-right', width: 160, height: 112 }}
        header="inside"
        accentHeader
        ThemeComponent={Theme}
        ariaLabel="Studio graph"
      >
        <CanvasShortcuts
          onEntitiesChange={props.onEntitiesChange}
          onEdgesChange={props.onEdgesChange}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
        <SelectionBridge bus={props.bus} />
        <ViewportBridge onViewport={props.onViewport} />
      </KookieFlow>
    </Box>
  );
}

export const Canvas = React.memo(CanvasImpl);
