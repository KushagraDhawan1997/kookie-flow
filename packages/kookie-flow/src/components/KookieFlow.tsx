import { useEffect, useRef, type CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { FlowProvider, useFlowStoreApi } from './context';
import { Grid } from './Grid';
import { Nodes } from './Nodes';
import { Edges } from './Edges';
import { DOMLayer } from './DOMLayer';
import { GRID_COLORS, DEFAULT_VIEWPORT } from '../core/constants';
import type { KookieFlowProps } from '../types';

/**
 * Main KookieFlow component.
 * Renders a WebGL canvas with an optional DOM overlay.
 */
export function KookieFlow({
  nodes,
  edges,
  nodeTypes = {},
  socketTypes = {},
  onNodesChange,
  onEdgesChange,
  onConnect,
  defaultViewport = DEFAULT_VIEWPORT,
  minZoom = 0.1,
  maxZoom = 4,
  showGrid = true,
  showMinimap = false,
  snapToGrid = false,
  snapGrid = [20, 20],
  className,
  children,
}: KookieFlowProps) {
  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: GRID_COLORS.background,
  };

  return (
    <FlowProvider initialState={{ nodes, edges, viewport: defaultViewport }}>
      <div className={className} style={containerStyle}>
        <FlowCanvas showGrid={showGrid} />
        <DOMLayer nodeTypes={nodeTypes}>{children}</DOMLayer>
        <FlowSync
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
        />
      </div>
    </FlowProvider>
  );
}

interface FlowCanvasProps {
  showGrid: boolean;
}

function FlowCanvas({ showGrid }: FlowCanvasProps) {
  return (
    <Canvas
      orthographic
      camera={{
        position: [0, 0, 100],
        zoom: 1,
        near: 0.1,
        far: 1000,
      }}
      style={{ position: 'absolute', top: 0, left: 0 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      }}
    >
      <CameraController />
      {showGrid && <Grid />}
      <Edges />
      <Nodes />
    </Canvas>
  );
}

/**
 * Syncs external props with internal store.
 */
interface FlowSyncProps {
  nodes: KookieFlowProps['nodes'];
  edges: KookieFlowProps['edges'];
  onNodesChange?: KookieFlowProps['onNodesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
}

function FlowSync({ nodes, edges, onNodesChange, onEdgesChange }: FlowSyncProps) {
  const store = useFlowStoreApi();

  // Sync props to store
  useEffect(() => {
    store.getState().setNodes(nodes);
  }, [nodes, store]);

  useEffect(() => {
    store.getState().setEdges(edges);
  }, [edges, store]);

  // Subscribe to store changes and call external callbacks
  useEffect(() => {
    if (!onNodesChange) return;

    const unsubscribe = store.subscribe(
      (state) => state.nodes,
      (newNodes, prevNodes) => {
        // Generate change events
        // This is simplified - real implementation would diff properly
      }
    );

    return unsubscribe;
  }, [store, onNodesChange]);

  return null;
}

/**
 * Camera controller for pan/zoom.
 */
function CameraController() {
  // TODO: Implement pan/zoom controls
  // Will use pointer events to update viewport
  return null;
}
