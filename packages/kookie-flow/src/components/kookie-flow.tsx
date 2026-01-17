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
import { Sockets } from './sockets';
import { ConnectionLine } from './connection-line';
import { DOMLayer } from './dom-layer';
import { SelectionBox } from './selection-box';
import { GRID_COLORS, DEFAULT_VIEWPORT, DEFAULT_SOCKET_TYPES, AUTO_SCROLL_EDGE_THRESHOLD, AUTO_SCROLL_MAX_SPEED } from '../core/constants';
import { screenToWorld, getSocketAtPosition, getEdgeAtPosition } from '../utils/geometry';
import { validateConnection, isSocketCompatible } from '../utils/connections';
import { boundsFromCorners } from '../core/spatial';
import type { KookieFlowProps, Node, Edge, SocketType, Connection, ConnectionMode, IsValidConnectionFn, EdgeType } from '../types';
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
  onEdgeClick,
  onPaneClick,
  edgesSelectable = true,
  defaultViewport = DEFAULT_VIEWPORT,
  minZoom = 0.1,
  maxZoom = 4,
  showGrid = true,
  showMinimap = false,
  showStats = false,
  scaleTextWithZoom = false,
  snapToGrid = false,
  snapGrid = [20, 20],
  defaultEdgeType = 'bezier',
  connectionMode = 'loose',
  isValidConnection,
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

  const resolvedSocketTypes = { ...DEFAULT_SOCKET_TYPES, ...socketTypes };

  return (
    <FlowProvider initialState={{ nodes, edges, viewport: defaultViewport }}>
      <InputHandler
        className={className}
        style={containerStyle}
        minZoom={minZoom}
        maxZoom={maxZoom}
        snapToGrid={snapToGrid}
        snapGrid={snapGrid}
        socketTypes={resolvedSocketTypes}
        connectionMode={connectionMode}
        isValidConnection={isValidConnection}
        defaultEdgeType={defaultEdgeType}
        edgesSelectable={edgesSelectable}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
      >
        <FlowCanvas showGrid={showGrid} showStats={showStats} defaultEdgeType={defaultEdgeType} socketTypes={resolvedSocketTypes} />
        <DOMLayer nodeTypes={nodeTypes} scaleTextWithZoom={scaleTextWithZoom}>{children}</DOMLayer>
        <FlowSync
          nodes={nodes}
          edges={edges}
          socketTypes={resolvedSocketTypes}
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
  snapToGrid: boolean;
  snapGrid: [number, number];
  socketTypes: Record<string, SocketType>;
  connectionMode: ConnectionMode;
  isValidConnection?: IsValidConnectionFn;
  defaultEdgeType: EdgeType;
  edgesSelectable: boolean;
  onNodeClick?: (node: Node) => void;
  onEdgeClick?: (edge: Edge) => void;
  onPaneClick?: () => void;
  onConnect?: (connection: Connection) => void;
  onNodesChange?: KookieFlowProps['onNodesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
}

// Minimum distance (in pixels) to consider a pointer move as a drag
const DRAG_THRESHOLD = 5;

function InputHandler({ children, className, style, minZoom, maxZoom, snapToGrid, snapGrid, socketTypes, connectionMode, isValidConnection, defaultEdgeType, edgesSelectable, onNodeClick, onEdgeClick, onPaneClick, onConnect, onNodesChange, onEdgesChange }: InputHandlerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const store = useFlowStoreApi();

  // Track interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  // Track pointer down position to detect clicks vs drags
  const pointerDownPos = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const hasDragged = useRef(false);

  // Track drag state for node dragging
  const dragState = useRef<{
    nodeIds: string[];
    startPositions: Map<string, { x: number; y: number }>;
    startWorldPos: { x: number; y: number };
    containerRect: { width: number; height: number }; // Cached to avoid layout queries in RAF
  } | null>(null);

  // Auto-scroll state for dragging near viewport edges
  const autoScrollRef = useRef<{
    rafId: number;
    lastScreenPos: { x: number; y: number } | null;
    active: boolean;
  }>({ rafId: 0, lastScreenPos: null, active: false });

  // Update viewport immediately for responsive input (no RAF batching)
  // Rendering components handle their own batching via dirty flags
  const updateViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    store.getState().setViewport(viewport);
  }, [store]);

  // Auto-scroll when dragging near viewport edges
  const runAutoScroll = useCallback(() => {
    autoScrollRef.current.rafId = 0;

    // Exit if not dragging or no position tracked
    if (!isDragging || !dragState.current || !autoScrollRef.current.lastScreenPos) {
      autoScrollRef.current.active = false;
      return;
    }

    const { x: screenX, y: screenY } = autoScrollRef.current.lastScreenPos;
    const { width, height } = dragState.current.containerRect;

    // Calculate proximity to each edge (0 = not near, 1 = at edge)
    const leftProximity = Math.max(0, 1 - screenX / AUTO_SCROLL_EDGE_THRESHOLD);
    const rightProximity = Math.max(0, 1 - (width - screenX) / AUTO_SCROLL_EDGE_THRESHOLD);
    const topProximity = Math.max(0, 1 - screenY / AUTO_SCROLL_EDGE_THRESHOLD);
    const bottomProximity = Math.max(0, 1 - (height - screenY) / AUTO_SCROLL_EDGE_THRESHOLD);

    // No edge proximity = stop scrolling
    if (leftProximity === 0 && rightProximity === 0 && topProximity === 0 && bottomProximity === 0) {
      autoScrollRef.current.active = false;
      return;
    }

    // Calculate scroll direction and magnitude (proportional to proximity)
    const scrollX = (rightProximity - leftProximity) * AUTO_SCROLL_MAX_SPEED;
    const scrollY = (bottomProximity - topProximity) * AUTO_SCROLL_MAX_SPEED;

    const { viewport } = store.getState();

    // 1. Pan viewport (opposite direction - scrolling right means panning left)
    store.getState().setViewport({
      x: viewport.x - scrollX,
      y: viewport.y - scrollY,
      zoom: viewport.zoom,
    });

    // 2. Update node positions based on new viewport
    // No compensation needed: viewport pan increases cursor's worldPos,
    // which increases delta, which moves the node with the viewport
    const currentWorldPos = screenToWorld(
      { x: screenX, y: screenY },
      store.getState().viewport
    );
    let deltaX = currentWorldPos.x - dragState.current.startWorldPos.x;
    let deltaY = currentWorldPos.y - dragState.current.startWorldPos.y;

    if (snapToGrid) {
      deltaX = Math.round(deltaX / snapGrid[0]) * snapGrid[0];
      deltaY = Math.round(deltaY / snapGrid[1]) * snapGrid[1];
    }

    const updates = dragState.current.nodeIds.map((id) => {
      const startPos = dragState.current!.startPositions.get(id)!;
      return {
        id,
        position: { x: startPos.x + deltaX, y: startPos.y + deltaY },
      };
    });
    store.getState().updateNodePositions(updates);

    // Schedule next frame
    autoScrollRef.current.active = true;
    autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
  }, [isDragging, snapToGrid, snapGrid, store]);

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
        containerRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // Left-click: potentially start selection, box selection, or connection
      if (e.button === 0) {
        const { viewport, nodes } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket click first
        const socket = getSocketAtPosition(
          worldPos,
          nodes,
          viewport,
          { width: rect.width, height: rect.height }
        );

        if (socket) {
          // Start connection draft with current mouse position
          store.getState().startConnectionDraft(socket, worldPos);
          setIsConnecting(true);
          // Capture pointer to the container, not e.target, to ensure we receive move events
          containerRef.current?.setPointerCapture(e.pointerId);
          return;
        }

        // Store the pointer down position
        pointerDownPos.current = { x: worldPos.x, y: worldPos.y, screenX: e.clientX, screenY: e.clientY };
        hasDragged.current = false;
        containerRef.current?.setPointerCapture(e.pointerId);
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

      // Handle connection draft
      if (isConnecting) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport, nodes, nodeMap, connectionDraft } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket hover during connection
        const hoveredSocket = getSocketAtPosition(
          worldPos,
          nodes,
          viewport,
          { width: rect.width, height: rect.height }
        );
        store.getState().setHoveredSocketId(hoveredSocket);

        // Check type compatibility for visual feedback (always show, regardless of mode)
        // Use nodeMap for O(1) lookups in hot path
        let isTypeCompatible = true;
        if (hoveredSocket && connectionDraft) {
          isTypeCompatible = isSocketCompatible(
            connectionDraft.source,
            hoveredSocket,
            nodeMap,
            socketTypes
          );
        }

        // Update connection draft position and validity (for visual feedback)
        store.getState().updateConnectionDraft(worldPos, isTypeCompatible);
        return;
      }

      // Check for drag threshold to start box selection or node dragging
      if (pointerDownPos.current && !isBoxSelecting && !isDragging) {
        const dx = e.clientX - pointerDownPos.current.screenX;
        const dy = e.clientY - pointerDownPos.current.screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > DRAG_THRESHOLD) {
          hasDragged.current = true;

          // Check if we're clicking on a node or empty space
          // Use quadtree for O(log n) hit testing
          const { quadtree, nodeMap, selectedNodeIds } = store.getState();
          const candidateIds = quadtree.queryPoint(
            pointerDownPos.current.x,
            pointerDownPos.current.y
          );
          const clickedNode = candidateIds.length > 0 ? nodeMap.get(candidateIds[0]) : null;

          if (clickedNode) {
            // Start node dragging
            let dragNodeIds: string[];

            if (selectedNodeIds.has(clickedNode.id)) {
              // Drag all selected nodes
              dragNodeIds = [...selectedNodeIds];
            } else {
              // Select and drag just this node
              store.getState().selectNode(clickedNode.id);
              dragNodeIds = [clickedNode.id];
            }

            // Store initial positions
            const startPositions = new Map<string, { x: number; y: number }>();
            for (const id of dragNodeIds) {
              const node = nodeMap.get(id);
              if (node) startPositions.set(id, { x: node.position.x, y: node.position.y });
            }

            // Cache container rect once to avoid layout queries in RAF loop
            const rect = containerRef.current?.getBoundingClientRect();
            dragState.current = {
              nodeIds: dragNodeIds,
              startPositions,
              startWorldPos: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
              containerRect: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
            };
            setIsDragging(true);
          } else {
            // Start box selection
            setIsBoxSelecting(true);
            store.getState().setSelectionBox({
              start: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
              end: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
            });
          }
        }
      }

      // Update node dragging
      if (isDragging && dragState.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Calculate delta from drag start
        let deltaX = worldPos.x - dragState.current.startWorldPos.x;
        let deltaY = worldPos.y - dragState.current.startWorldPos.y;

        // Apply snap to grid if enabled
        if (snapToGrid) {
          deltaX = Math.round(deltaX / snapGrid[0]) * snapGrid[0];
          deltaY = Math.round(deltaY / snapGrid[1]) * snapGrid[1];
        }

        // Update all dragged node positions
        const updates = dragState.current.nodeIds.map((id) => {
          const startPos = dragState.current!.startPositions.get(id)!;
          return {
            id,
            position: { x: startPos.x + deltaX, y: startPos.y + deltaY },
          };
        });

        store.getState().updateNodePositions(updates);

        // Track screen position and trigger auto-scroll if near edges
        // Reuse object to avoid allocation in hot path
        if (autoScrollRef.current.lastScreenPos) {
          autoScrollRef.current.lastScreenPos.x = screenX;
          autoScrollRef.current.lastScreenPos.y = screenY;
        } else {
          autoScrollRef.current.lastScreenPos = { x: screenX, y: screenY };
        }
        if (!autoScrollRef.current.active && autoScrollRef.current.rafId === 0) {
          autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
        }
        return;
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
        return;
      }

      // Update hover state (only when not dragging or box selecting)
      if (!pointerDownPos.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport, hoveredNodeId, hoveredSocketId, nodes, quadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check socket hover first
        const newHoveredSocket = getSocketAtPosition(
          worldPos,
          nodes,
          viewport,
          { width: rect.width, height: rect.height }
        );

        // Update socket hover if changed
        if (
          newHoveredSocket?.nodeId !== hoveredSocketId?.nodeId ||
          newHoveredSocket?.socketId !== hoveredSocketId?.socketId
        ) {
          store.getState().setHoveredSocketId(newHoveredSocket);
        }

        // Use quadtree for O(log n) hit testing for nodes
        const candidateIds = quadtree.queryPoint(worldPos.x, worldPos.y);
        const newHoveredId = candidateIds.length > 0 ? candidateIds[0] : null;

        // Only update if changed to avoid unnecessary re-renders
        if (newHoveredId !== hoveredNodeId) {
          store.getState().setHoveredNodeId(newHoveredId);
        }
      }
    },
    [isPanning, isBoxSelecting, isDragging, isConnecting, snapToGrid, snapGrid, socketTypes, store, updateViewport, runAutoScroll]
  );

  // Handle pointer up
  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      // End connection draft
      if (isConnecting) {
        const { connectionDraft, hoveredSocketId, nodeMap } = store.getState();

        if (connectionDraft && hoveredSocketId) {
          // Check if connection is valid (use nodeMap for O(1))
          const isValid = validateConnection(
            connectionDraft.source,
            hoveredSocketId,
            nodeMap,
            socketTypes,
            connectionMode,
            isValidConnection
          );

          if (isValid) {
            // Check type compatibility separately for invalid flag
            // In loose mode, connection is allowed but marked invalid if types don't match
            const isTypeCompatible = isSocketCompatible(
              connectionDraft.source,
              hoveredSocketId,
              nodeMap,
              socketTypes
            );

            // Determine source and target based on input/output
            const isSourceInput = connectionDraft.source.isInput;
            const connection: Connection = {
              source: isSourceInput ? hoveredSocketId.nodeId : connectionDraft.source.nodeId,
              sourceSocket: isSourceInput ? hoveredSocketId.socketId : connectionDraft.source.socketId,
              target: isSourceInput ? connectionDraft.source.nodeId : hoveredSocketId.nodeId,
              targetSocket: isSourceInput ? connectionDraft.source.socketId : hoveredSocketId.socketId,
              invalid: !isTypeCompatible,
            };

            // Call onConnect callback
            onConnect?.(connection);
          }
        }

        // Cancel the draft
        store.getState().cancelConnectionDraft();
        setIsConnecting(false);
        containerRef.current?.releasePointerCapture(e.pointerId);
        return;
      }

      // End panning
      if (isPanning) {
        setIsPanning(false);
        lastPointerPos.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        return;
      }

      // End node dragging
      if (isDragging) {
        // Cancel auto-scroll
        if (autoScrollRef.current.rafId) {
          cancelAnimationFrame(autoScrollRef.current.rafId);
          autoScrollRef.current.rafId = 0;
        }
        autoScrollRef.current.active = false;
        autoScrollRef.current.lastScreenPos = null;

        setIsDragging(false);
        dragState.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }

      // End box selection
      if (isBoxSelecting) {
        const { selectionBox, quadtree, selectedNodeIds } = store.getState();
        if (selectionBox) {
          // Use quadtree for O(log n) range query
          const bounds = boundsFromCorners(
            selectionBox.start.x,
            selectionBox.start.y,
            selectionBox.end.x,
            selectionBox.end.y
          );
          const selectedIds = quadtree.queryRange(bounds);

          // Select the nodes (additive with Ctrl/Cmd key)
          if (e.ctrlKey || e.metaKey) {
            // Add to existing selection - use Set for O(1) merge
            const newSelection = [...new Set([...selectedNodeIds, ...selectedIds])];
            store.getState().selectNodes(newSelection);
          } else {
            store.getState().selectNodes(selectedIds);
          }
        }
        store.getState().setSelectionBox(null);
        setIsBoxSelecting(false);
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }

      // Handle click (no drag occurred)
      if (pointerDownPos.current && !hasDragged.current && e.button === 0) {
        // Use quadtree for O(log n) hit testing
        const { quadtree, nodeMap, edges, viewport } = store.getState();
        const clickPos = { x: pointerDownPos.current.x, y: pointerDownPos.current.y };
        const candidateIds = quadtree.queryPoint(clickPos.x, clickPos.y);
        const clickedNode = candidateIds.length > 0 ? nodeMap.get(candidateIds[0]) : null;

        if (clickedNode) {
          // Click on node: select it
          const additive = e.ctrlKey || e.metaKey;
          store.getState().selectNode(clickedNode.id, additive);
          onNodeClick?.(clickedNode);
        } else if (edgesSelectable) {
          // Check for edge click
          const clickedEdge = getEdgeAtPosition(clickPos, edges, nodeMap, defaultEdgeType, viewport);
          if (clickedEdge) {
            const additive = e.ctrlKey || e.metaKey;
            store.getState().selectEdge(clickedEdge.id, additive);
            onEdgeClick?.(clickedEdge);
          } else {
            // Click on empty space: deselect all
            store.getState().deselectAll();
            onPaneClick?.();
          }
        } else {
          // Click on empty space: deselect all
          store.getState().deselectAll();
          onPaneClick?.();
        }

        containerRef.current?.releasePointerCapture(e.pointerId);
      }

      pointerDownPos.current = null;
    },
    [isPanning, isDragging, isBoxSelecting, isConnecting, socketTypes, connectionMode, isValidConnection, defaultEdgeType, edgesSelectable, store, onNodeClick, onEdgeClick, onPaneClick, onConnect]
  );

  // Cleanup auto-scroll RAF on unmount
  useEffect(() => {
    return () => {
      if (autoScrollRef.current.rafId) {
        cancelAnimationFrame(autoScrollRef.current.rafId);
      }
    };
  }, []);

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

      // Escape: cancel connection, box selection, or deselect all
      if (e.code === 'Escape') {
        if (isConnecting) {
          store.getState().cancelConnectionDraft();
          setIsConnecting(false);
        } else if (isBoxSelecting) {
          store.getState().setSelectionBox(null);
          setIsBoxSelecting(false);
        } else {
          store.getState().deselectAll();
        }
      }

      // Delete/Backspace: delete selected nodes and edges
      if (e.code === 'Delete' || e.code === 'Backspace') {
        const { selectedNodeIds, selectedEdgeIds, edges } = store.getState();

        // Collect all edges to delete: selected edges + edges connected to deleted nodes
        const edgeIdsToDelete = new Set(selectedEdgeIds);
        if (selectedNodeIds.size > 0) {
          for (const edge of edges) {
            if (selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)) {
              edgeIdsToDelete.add(edge.id);
            }
          }
        }

        // Delete edges (selected + dangling)
        if (edgeIdsToDelete.size > 0) {
          const edgeChanges = Array.from(edgeIdsToDelete).map(id => ({
            type: 'remove' as const,
            id,
          }));
          onEdgesChange?.(edgeChanges);
          store.getState().applyEdgeChanges(edgeChanges);
        }

        // Delete selected nodes
        if (selectedNodeIds.size > 0) {
          const nodeChanges = Array.from(selectedNodeIds).map(id => ({
            type: 'remove' as const,
            id,
          }));
          onNodesChange?.(nodeChanges);
          store.getState().applyNodeChanges(nodeChanges);
        }

        // Clear selection
        store.getState().deselectAll();
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
  }, [isPanning, isBoxSelecting, isConnecting, store, onNodesChange, onEdgesChange]);

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
        cursor: isPanning || isDragging ? 'grabbing' : isSpaceDown ? 'grab' : isBoxSelecting ? 'crosshair' : isConnecting ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => {
        handlePointerUp(e);
        store.getState().setHoveredNodeId(null);
        store.getState().setHoveredSocketId(null);
      }}
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
  defaultEdgeType: import('../types').EdgeType;
  socketTypes: Record<string, SocketType>;
}

function FlowCanvas({ showGrid, showStats, defaultEdgeType, socketTypes }: FlowCanvasProps) {
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
      <Edges defaultEdgeType={defaultEdgeType} socketTypes={socketTypes} />
      <Sockets socketTypes={socketTypes} />
      <Nodes />
      <SelectionBox />
      <ConnectionLine socketTypes={socketTypes} />
    </Canvas>
  );
}

/**
 * Syncs external props with internal store.
 */
interface FlowSyncProps {
  nodes: KookieFlowProps['nodes'];
  edges: KookieFlowProps['edges'];
  socketTypes: Record<string, SocketType>;
  onNodesChange?: KookieFlowProps['onNodesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
}

function FlowSync({ nodes, edges, socketTypes, onNodesChange, onEdgesChange }: FlowSyncProps) {
  const store = useFlowStoreApi();

  useEffect(() => {
    store.getState().setNodes(nodes);
  }, [nodes, store]);

  // Compute invalid flag for edges that don't have it (e.g., loaded from external source)
  // This runs once when edges change, not every frame
  // Only creates new edge objects when actually needed to avoid triggering subscriptions
  useEffect(() => {
    const { nodeMap } = store.getState();

    // First pass: check if any edge needs invalid flag computed
    let needsComputation = false;
    for (const edge of edges) {
      if (edge.invalid === undefined && edge.sourceSocket && edge.targetSocket) {
        needsComputation = true;
        break;
      }
    }

    if (needsComputation) {
      // Second pass: only create new objects for edges that need computation
      const processedEdges: typeof edges = [];
      for (const edge of edges) {
        if (edge.invalid !== undefined || !edge.sourceSocket || !edge.targetSocket) {
          // Keep original object reference
          processedEdges.push(edge);
        } else {
          // Compute type compatibility and create new object
          const isValid = isSocketCompatible(
            { nodeId: edge.source, socketId: edge.sourceSocket, isInput: false },
            { nodeId: edge.target, socketId: edge.targetSocket, isInput: true },
            nodeMap,
            socketTypes
          );
          processedEdges.push({ ...edge, invalid: !isValid });
        }
      }
      store.getState().setEdges(processedEdges);
    } else {
      store.getState().setEdges(edges);
    }
  }, [edges, socketTypes, store]);

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
