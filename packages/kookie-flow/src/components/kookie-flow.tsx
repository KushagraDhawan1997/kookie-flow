import {
  useEffect,
  useRef,
  useLayoutEffect,
  useCallback,
  useState,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Stats } from '@react-three/drei';
import { FlowProvider, useFlowStoreApi } from './context';
import { Grid } from './grid';
import { Nodes } from './nodes';
import { Edges } from './edges';
import { DOMLayer } from './dom-layer';
import { SelectionBox } from './selection-box';
import { GRID_COLORS, DEFAULT_VIEWPORT } from '../core/constants';
import { screenToWorld, getNodeAtPosition, getNodesInBox } from '../utils/geometry';
import type { KookieFlowProps, Node } from '../types';
import * as THREE from 'three';

// Detect Safari for specific optimizations
const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

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
  onNodeClick,
  onPaneClick,
  defaultViewport = DEFAULT_VIEWPORT,
  minZoom = 0.1,
  maxZoom = 4,
  showGrid = true,
  showMinimap = false,
  showStats = false,
  scaleTextWithZoom = false,
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
      <InputHandler
        className={className}
        style={containerStyle}
        minZoom={minZoom}
        maxZoom={maxZoom}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
      >
        <FlowCanvas showGrid={showGrid} showStats={showStats} />
        <DOMLayer nodeTypes={nodeTypes} scaleTextWithZoom={scaleTextWithZoom}>{children}</DOMLayer>
        <FlowSync
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
        />
      </InputHandler>
    </FlowProvider>
  );
}

/**
 * Input handler for pan/zoom controls and selection.
 * Handles: wheel zoom, middle-click pan, space+drag pan, touch gestures,
 * click-to-select, box selection, keyboard shortcuts.
 */
interface InputHandlerProps {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  minZoom: number;
  maxZoom: number;
  onNodeClick?: (node: Node) => void;
  onPaneClick?: () => void;
}

// Minimum distance (in pixels) to consider a pointer move as a drag
const DRAG_THRESHOLD = 5;

function InputHandler({ children, className, style, minZoom, maxZoom, onNodeClick, onPaneClick }: InputHandlerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const store = useFlowStoreApi();

  // Track interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  // Track pointer down position to detect clicks vs drags
  const pointerDownPos = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const hasDragged = useRef(false);

  // Update viewport immediately for responsive input (no RAF batching)
  // Rendering components handle their own batching via dirty flags
  const updateViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    store.getState().setViewport(viewport);
  }, [store]);

  // Touch gesture state
  const touchState = useRef<{
    touches: Map<number, { x: number; y: number }>;
    initialDistance: number | null;
    initialZoom: number;
    lastCenter: { x: number; y: number } | null;
  }>({
    touches: new Map(),
    initialDistance: null,
    initialZoom: 1,
    lastCenter: null,
  });

  // Handle wheel zoom - using native event for { passive: false }
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const { viewport } = store.getState();

      // Normalize wheel delta across browsers
      // Safari often uses larger delta values
      let delta = -e.deltaY;
      if (e.deltaMode === 1) delta *= 40; // Line mode
      if (e.deltaMode === 2) delta *= 800; // Page mode
      delta *= 0.001;

      const newZoom = Math.max(minZoom, Math.min(maxZoom, viewport.zoom * (1 + delta)));
      if (newZoom === viewport.zoom) return;

      // Zoom towards cursor position
      const worldX = (cursorX - viewport.x) / viewport.zoom;
      const worldY = (cursorY - viewport.y) / viewport.zoom;

      const newX = cursorX - worldX * newZoom;
      const newY = cursorY - worldY * newZoom;

      updateViewport({ x: newX, y: newY, zoom: newZoom });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [store, minZoom, maxZoom, updateViewport]);

  // Handle pointer down
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      // Middle-click or space+left-click: start panning
      if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
        e.preventDefault();
        setIsPanning(true);
        lastPointerPos.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      // Left-click: potentially start selection or box selection
      if (e.button === 0) {
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Store the pointer down position
        pointerDownPos.current = { x: worldPos.x, y: worldPos.y, screenX: e.clientX, screenY: e.clientY };
        hasDragged.current = false;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [isSpaceDown, store]
  );

  // Handle pointer move
  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      // Handle panning
      if (isPanning && lastPointerPos.current) {
        const deltaX = e.clientX - lastPointerPos.current.x;
        const deltaY = e.clientY - lastPointerPos.current.y;

        lastPointerPos.current = { x: e.clientX, y: e.clientY };

        const { viewport } = store.getState();
        updateViewport({
          x: viewport.x + deltaX,
          y: viewport.y + deltaY,
          zoom: viewport.zoom,
        });
        return;
      }

      // Check for drag threshold to start box selection
      if (pointerDownPos.current && !isBoxSelecting) {
        const dx = e.clientX - pointerDownPos.current.screenX;
        const dy = e.clientY - pointerDownPos.current.screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > DRAG_THRESHOLD) {
          hasDragged.current = true;

          // Check if we're clicking on empty space (start box selection)
          const { nodes, viewport } = store.getState();
          const clickedNode = getNodeAtPosition(
            { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
            nodes
          );

          if (!clickedNode) {
            // Start box selection
            setIsBoxSelecting(true);
            store.getState().setSelectionBox({
              start: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
              end: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
            });
          }
        }
      }

      // Update box selection
      if (isBoxSelecting) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport, selectionBox } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        if (selectionBox) {
          store.getState().setSelectionBox({
            start: selectionBox.start,
            end: worldPos,
          });
        }
      }
    },
    [isPanning, isBoxSelecting, store, updateViewport]
  );

  // Handle pointer up
  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      // End panning
      if (isPanning) {
        setIsPanning(false);
        lastPointerPos.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        return;
      }

      // End box selection
      if (isBoxSelecting) {
        const { selectionBox, nodes } = store.getState();
        if (selectionBox) {
          // Find all nodes in the selection box
          const selectedNodes = getNodesInBox(selectionBox.start, selectionBox.end, nodes);
          const selectedIds = selectedNodes.map((n) => n.id);

          // Select the nodes (additive with Ctrl/Cmd key)
          if (e.ctrlKey || e.metaKey) {
            // Add to existing selection
            const currentlySelected = nodes.filter((n) => n.selected).map((n) => n.id);
            const newSelection = [...new Set([...currentlySelected, ...selectedIds])];
            store.getState().selectNodes(newSelection);
          } else {
            store.getState().selectNodes(selectedIds);
          }
        }
        store.getState().setSelectionBox(null);
        setIsBoxSelecting(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }

      // Handle click (no drag occurred)
      if (pointerDownPos.current && !hasDragged.current && e.button === 0) {
        const { nodes, viewport } = store.getState();
        const clickedNode = getNodeAtPosition(
          { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
          nodes
        );

        if (clickedNode) {
          // Click on node: select it
          const additive = e.ctrlKey || e.metaKey;
          store.getState().selectNode(clickedNode.id, additive);
          onNodeClick?.(clickedNode);
        } else {
          // Click on empty space: deselect all
          store.getState().deselectAll();
          onPaneClick?.();
        }

        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }

      pointerDownPos.current = null;
    },
    [isPanning, isBoxSelecting, store, onNodeClick, onPaneClick]
  );

  // Handle keyboard events for space key, Ctrl+A, and Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: enable pan mode
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpaceDown(true);
      }

      // Ctrl+A or Cmd+A: select all nodes
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault();
        store.getState().selectAll();
      }

      // Escape: deselect all or cancel box selection
      if (e.code === 'Escape') {
        if (isBoxSelecting) {
          store.getState().setSelectionBox(null);
          setIsBoxSelecting(false);
        } else {
          store.getState().deselectAll();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        if (isPanning) {
          setIsPanning(false);
          lastPointerPos.current = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isPanning, isBoxSelecting, store]);

  // Prevent context menu on middle click
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  }, []);

  // Touch handlers for pinch-to-zoom and two-finger pan
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        touchState.current.touches.set(touch.identifier, {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        });
      }

      if (touchState.current.touches.size === 2) {
        const touches = Array.from(touchState.current.touches.values());
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        touchState.current.initialDistance = Math.sqrt(dx * dx + dy * dy);
        touchState.current.initialZoom = store.getState().viewport.zoom;
        touchState.current.lastCenter = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2,
        };
      }
    },
    [store]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        touchState.current.touches.set(touch.identifier, {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        });
      }

      const touches = Array.from(touchState.current.touches.values());

      if (touches.length === 2 && touchState.current.initialDistance !== null) {
        e.preventDefault();

        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const center = {
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2,
        };

        const scale = distance / touchState.current.initialDistance;
        const newZoom = Math.max(
          minZoom,
          Math.min(maxZoom, touchState.current.initialZoom * scale)
        );

        const { viewport } = store.getState();

        const worldX = (center.x - viewport.x) / viewport.zoom;
        const worldY = (center.y - viewport.y) / viewport.zoom;

        let newX = center.x - worldX * newZoom;
        let newY = center.y - worldY * newZoom;

        if (touchState.current.lastCenter) {
          const panDx = center.x - touchState.current.lastCenter.x;
          const panDy = center.y - touchState.current.lastCenter.y;
          newX += panDx;
          newY += panDy;
        }

        touchState.current.lastCenter = center;

        updateViewport({ x: newX, y: newY, zoom: newZoom });
      }
    },
    [store, minZoom, maxZoom, updateViewport]
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      touchState.current.touches.delete(e.changedTouches[i].identifier);
    }

    if (touchState.current.touches.size < 2) {
      touchState.current.initialDistance = null;
      touchState.current.lastCenter = null;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        cursor: isPanning ? 'grabbing' : isSpaceDown ? 'grab' : isBoxSelecting ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

interface FlowCanvasProps {
  showGrid: boolean;
  showStats: boolean;
}

function FlowCanvas({ showGrid, showStats }: FlowCanvasProps) {
  // WebGL context attributes optimized for Safari
  const glConfig = useMemo(() => ({
    // Disable MSAA on Safari - it's expensive and often causes issues
    antialias: !isSafari,
    alpha: true,
    // Request high-performance GPU
    powerPreference: 'high-performance' as const,
    // These help Safari performance
    stencil: false,
    depth: false,
    // Preserve drawing buffer can help with some Safari rendering issues
    preserveDrawingBuffer: false,
    // Fail if performance is poor
    failIfMajorPerformanceCaveat: false,
  }), []);

  return (
    <Canvas
      orthographic
      // Use 'always' frameloop for consistent frame timing
      // Components use dirty flags to skip unnecessary work
      frameloop="always"
      camera={{
        position: [0, 0, 100],
        zoom: 1,
        near: 0.1,
        far: 1000,
      }}
      style={{ position: 'absolute', top: 0, left: 0 }}
      gl={glConfig}
      // Disable R3F's built-in color management for simpler pipeline
      flat
      // Use legacy lights for simpler rendering
      legacy
    >
      {showStats && <Stats />}
      <Invalidator />
      <CameraController />
      {showGrid && <Grid />}
      <Edges />
      <Nodes />
      <SelectionBox />
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

  useEffect(() => {
    store.getState().setNodes(nodes);
  }, [nodes, store]);

  useEffect(() => {
    store.getState().setEdges(edges);
  }, [edges, store]);

  useEffect(() => {
    if (!onNodesChange) return;

    const unsubscribe = store.subscribe(
      (state) => state.nodes,
      (newNodes, prevNodes) => {
        // Generate change events (simplified)
      }
    );

    return unsubscribe;
  }, [store, onNodesChange]);

  return null;
}

/**
 * Triggers R3F re-render when store state changes.
 * With frameloop="demand", we only render when invalidate() is called.
 * Throttled to avoid excessive invalidations.
 */
function Invalidator() {
  const { invalidate } = useThree();
  const store = useFlowStoreApi();
  const pendingRef = useRef(false);

  useEffect(() => {
    // Throttled invalidation - only one pending at a time
    const scheduleInvalidate = () => {
      if (!pendingRef.current) {
        pendingRef.current = true;
        requestAnimationFrame(() => {
          pendingRef.current = false;
          invalidate();
        });
      }
    };

    return store.subscribe(scheduleInvalidate);
  }, [store, invalidate]);

  return null;
}

/**
 * Camera controller for pan/zoom.
 * Updates orthographic camera bounds based on viewport and canvas size.
 */
function CameraController() {
  const { camera, size } = useThree();
  const store = useFlowStoreApi();

  // Track last values to detect changes (for subscription optimization only)
  const lastRef = useRef({ x: 0, y: 0, zoom: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;

    const updateCamera = () => {
      const { viewport } = store.getState();
      const { width, height } = size;
      const { x, y, zoom } = viewport;

      // Skip only if BOTH viewport AND size haven't changed
      const last = lastRef.current;
      if (
        x === last.x &&
        y === last.y &&
        zoom === last.zoom &&
        width === last.width &&
        height === last.height
      ) {
        return;
      }

      lastRef.current = { x, y, zoom, width, height };

      camera.left = -x / zoom;
      camera.right = (width - x) / zoom;
      camera.top = y / zoom;
      camera.bottom = (y - height) / zoom;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    };

    // Run immediately (handles initial load + resize)
    updateCamera();

    // Subscribe to viewport changes
    return store.subscribe(updateCamera);
  }, [camera, size, store]);

  return null;
}
