import {
  useEffect,
  useRef,
  useLayoutEffect,
  useCallback,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ForwardedRef,
} from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Stats } from '@react-three/drei';
import { FlowProvider, useFlowStoreApi } from './context';
import { Grid } from './grid';
import { Nodes } from './nodes';
import { Edges } from './edges';
import { Sockets } from './sockets';
import { ConnectionLine } from './connection-line';
import { DOMLayer } from './dom-layer';
import { SelectionBox } from './selection-box';
import { MultiWeightTextRenderer } from './text-renderer';
import { Minimap } from './minimap';
import { WidgetsLayer } from './widgets-layer';
import { ThemeProvider, StyleProvider, FontProvider, useTheme, useSocketLayout } from '../contexts';
import { resolveSocketTypes } from '../utils/socket-types';
import { DEFAULT_VIEWPORT, DEFAULT_SOCKET_TYPES, AUTO_SCROLL_EDGE_THRESHOLD, AUTO_SCROLL_MAX_SPEED } from '../core/constants';
import { screenToWorld, getSocketAtPosition, getEdgeAtPosition } from '../utils/geometry';
import { validateConnection, isSocketCompatible } from '../utils/connections';
import { boundsFromCorners } from '../core/spatial';
import type { KookieFlowProps, KookieFlowInstance, FitViewOptions, Node, Edge, SocketType, Connection, ConnectionMode, IsValidConnectionFn, EdgeType, TextRenderMode } from '../types';
import * as THREE from 'three';

// Detect Safari for specific optimizations
const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Main KookieFlow component.
 * Renders a WebGL canvas with an optional DOM overlay.
 *
 * Supports ref for imperative API access (fitView, getViewport, etc.)
 */
export const KookieFlow = forwardRef<KookieFlowInstance, KookieFlowProps>(
  function KookieFlow(
    {
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
      minimapProps,
      showStats = false,
      textRenderMode = 'dom',
      font = 'google-sans',
      scaleTextWithZoom = false,
      showSocketLabels = true,
      showEdgeLabels = true,
      snapToGrid = false,
      snapGrid = [20, 20],
      defaultEdgeType = 'bezier',
      connectionMode = 'loose',
      isValidConnection,
      className,
      children,
      // Styling props (Milestone 2)
      size = '2',
      variant = 'surface',
      radius,
      header = 'none',
      accentHeader = false,
      nodeStyle,
      // Widget props (Phase 7D)
      widgetTypes,
      onWidgetChange,
      showWidgets = true,
      ThemeComponent,
      defaultNodeWidth,
      socketLabelWidth,
    },
    ref
  ) {
    const resolvedSocketTypes = { ...DEFAULT_SOCKET_TYPES, ...socketTypes };

    return (
      <ThemeProvider>
        <StyleProvider
          size={size}
          variant={variant}
          radius={radius}
          header={header}
          accentHeader={accentHeader}
          nodeStyle={nodeStyle}
        >
          <FontProvider font={font}>
            <ThemedFlowContainer
              ref={ref}
              nodes={nodes}
              edges={edges}
              defaultViewport={defaultViewport}
              className={className}
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
              showGrid={showGrid}
              showStats={showStats}
              textRenderMode={textRenderMode}
              showSocketLabels={showSocketLabels}
              showEdgeLabels={showEdgeLabels}
              nodeTypes={nodeTypes}
              scaleTextWithZoom={scaleTextWithZoom}
              showMinimap={showMinimap}
              minimapProps={minimapProps}
              widgetTypes={widgetTypes}
              onWidgetChange={onWidgetChange}
              showWidgets={showWidgets}
              ThemeComponent={ThemeComponent}
              defaultNodeWidth={defaultNodeWidth}
              socketLabelWidth={socketLabelWidth}
            >
              {children}
            </ThemedFlowContainer>
          </FontProvider>
        </StyleProvider>
      </ThemeProvider>
    );
  }
);

/**
 * Inner container that has access to theme tokens for styling.
 */
interface ThemedFlowContainerProps {
  nodes: Node[];
  edges: Edge[];
  defaultViewport?: KookieFlowProps['defaultViewport'];
  className?: string;
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
  showGrid: boolean;
  showStats: boolean;
  textRenderMode: TextRenderMode;
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  nodeTypes: KookieFlowProps['nodeTypes'];
  scaleTextWithZoom: boolean;
  showMinimap: boolean;
  minimapProps?: KookieFlowProps['minimapProps'];
  children?: React.ReactNode;
  // Widget props (Phase 7D)
  widgetTypes?: KookieFlowProps['widgetTypes'];
  onWidgetChange?: KookieFlowProps['onWidgetChange'];
  showWidgets: boolean;
  ThemeComponent?: KookieFlowProps['ThemeComponent'];
  defaultNodeWidth?: number;
  socketLabelWidth?: number;
}

const ThemedFlowContainer = forwardRef<KookieFlowInstance, ThemedFlowContainerProps>(
  function ThemedFlowContainer(
    {
      nodes,
      edges,
      defaultViewport,
      className,
      minZoom,
      maxZoom,
      snapToGrid,
      snapGrid,
      socketTypes,
      connectionMode,
      isValidConnection,
      defaultEdgeType,
      edgesSelectable,
      onNodeClick,
      onEdgeClick,
      onPaneClick,
      onConnect,
      onNodesChange,
      onEdgesChange,
      showGrid,
      showStats,
      textRenderMode,
      showSocketLabels,
      showEdgeLabels,
      nodeTypes,
      scaleTextWithZoom,
      showMinimap,
      minimapProps,
      children,
      widgetTypes,
      onWidgetChange,
      showWidgets,
      ThemeComponent,
      defaultNodeWidth,
      socketLabelWidth,
    },
    ref
  ) {
    const tokens = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    // Resolve socket type colors from theme tokens (memoized)
    const resolvedSocketTypes = useMemo(
      () => resolveSocketTypes(socketTypes, tokens),
      [socketTypes, tokens]
    );

    // Use CSS variable with fallback for standalone mode (no Kookie UI)
    // This avoids hydration mismatch since server and client render the same string
    const containerStyle: CSSProperties = {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: 'var(--gray-2, #191919)',
    };

    return (
      <div ref={containerRef} className={className} style={containerStyle}>
        <FlowProvider initialState={{ nodes, edges, viewport: defaultViewport }}>
          <FlowInstanceHandle ref={ref} containerRef={containerRef} minZoom={minZoom} maxZoom={maxZoom} />
          <InputHandler
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
            <FlowCanvas showGrid={showGrid} showStats={showStats} defaultEdgeType={defaultEdgeType} socketTypes={resolvedSocketTypes} textRenderMode={textRenderMode} showSocketLabels={showSocketLabels} showEdgeLabels={showEdgeLabels} />
            <DOMLayer nodeTypes={nodeTypes} scaleTextWithZoom={scaleTextWithZoom} defaultEdgeType={defaultEdgeType} showNodeLabels={textRenderMode === 'dom'} showSocketLabels={textRenderMode === 'dom' ? showSocketLabels : false} showEdgeLabels={textRenderMode === 'dom' ? showEdgeLabels : false}>{children}</DOMLayer>
            {showWidgets && (
              <WidgetsLayer
                socketTypes={resolvedSocketTypes}
                widgetTypes={widgetTypes}
                onWidgetChange={onWidgetChange}
                ThemeComponent={ThemeComponent}
                defaultNodeWidth={defaultNodeWidth}
                socketLabelWidth={socketLabelWidth}
              />
            )}
            {showMinimap && <Minimap {...minimapProps} />}
            <FlowSync
              nodes={nodes}
              edges={edges}
              socketTypes={resolvedSocketTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
            />
          </InputHandler>
        </FlowProvider>
      </div>
    );
  }
);

/**
 * Component that exposes the imperative API via ref.
 * Lives inside FlowProvider to access the store.
 */
interface FlowInstanceHandleProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  minZoom: number;
  maxZoom: number;
}

const FlowInstanceHandle = forwardRef<KookieFlowInstance, FlowInstanceHandleProps>(
  function FlowInstanceHandle({ containerRef, minZoom, maxZoom }, ref) {
    const store = useFlowStoreApi();

    useImperativeHandle(ref, () => ({
      fitView: (options?: FitViewOptions) => {
        const container = containerRef.current;
        const width = container?.clientWidth ?? window.innerWidth;
        const height = container?.clientHeight ?? window.innerHeight;

        // Merge user options with component-level zoom constraints
        const mergedOptions: FitViewOptions = {
          ...options,
          minZoom: options?.minZoom ?? minZoom,
          maxZoom: options?.maxZoom ?? 1, // Default to not zooming in past 100%
        };

        store.getState().fitView(mergedOptions, width, height);
      },

      getViewport: () => {
        return store.getState().viewport;
      },

      setViewport: (viewport) => {
        store.getState().setViewport(viewport);
      },

      zoomIn: (step = 0.25) => {
        const state = store.getState();
        state.zoom(step);
      },

      zoomOut: (step = 0.25) => {
        const state = store.getState();
        state.zoom(-step);
      },

      getNodes: () => {
        return store.getState().nodes;
      },

      getEdges: () => {
        return store.getState().edges;
      },

      getSelectedNodes: () => {
        const state = store.getState();
        return state.nodes.filter(n => state.selectedNodeIds.has(n.id));
      },

      getSelectedEdges: () => {
        const state = store.getState();
        return state.edges.filter(e => state.selectedEdgeIds.has(e.id));
      },

      setCenter: (x, y, options) => {
        const container = containerRef.current;
        const width = container?.clientWidth ?? window.innerWidth;
        const height = container?.clientHeight ?? window.innerHeight;
        const state = store.getState();
        const zoom = options?.zoom ?? state.viewport.zoom;

        // Calculate offset to center the point (x, y) in the viewport
        const offsetX = width / 2 - x * zoom;
        const offsetY = height / 2 - y * zoom;

        state.setViewport({ x: offsetX, y: offsetY, zoom });
      },
    }), [store, containerRef, minZoom, maxZoom]);

    return null;
  }
);

/**
 * Input handler for pan/zoom controls and selection.
 * Handles: wheel zoom, middle-click pan, space+drag pan, touch gestures,
 * click-to-select, box selection, keyboard shortcuts.
 */
interface InputHandlerProps {
  children: React.ReactNode;
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

function InputHandler({ children, minZoom, maxZoom, snapToGrid, snapGrid, socketTypes, connectionMode, isValidConnection, defaultEdgeType, edgesSelectable, onNodeClick, onEdgeClick, onPaneClick, onConnect, onNodesChange, onEdgesChange }: InputHandlerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const store = useFlowStoreApi();

  // Cached container rect - updated via ResizeObserver (avoids layout thrashing)
  // This prevents expensive getBoundingClientRect() calls in hot paths (pointer move handlers)
  const cachedRectRef = useRef<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const socketLayout = useSocketLayout();

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
    cursorOffset: { x: number; y: number }; // Offset from cursor to primary node position at click time
    containerRect: { width: number; height: number }; // Cached to avoid layout queries in RAF
  } | null>(null);

  // Pending drag info - captured at click time, used when threshold is crossed
  const pendingDragRef = useRef<{
    clickedNodeId: string;
    cursorOffset: { x: number; y: number }; // cursor position - node position at click time
  } | null>(null);

  // Auto-scroll state for dragging near viewport edges
  const autoScrollRef = useRef<{
    rafId: number;
    lastScreenPos: { x: number; y: number } | null;
    active: boolean;
  }>({ rafId: 0, lastScreenPos: null, active: false });

  // Pre-allocated array for quadtree queries (avoids GC in hot paths)
  const queryResultsRef = useRef<string[]>([]);

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
    // Use cursor offset approach (same as main drag handler)
    const currentWorldPos = screenToWorld(
      { x: screenX, y: screenY },
      store.getState().viewport
    );

    // Calculate primary node position using cursor offset
    let primaryX = currentWorldPos.x - dragState.current.cursorOffset.x;
    let primaryY = currentWorldPos.y - dragState.current.cursorOffset.y;

    if (snapToGrid) {
      primaryX = Math.round(primaryX / snapGrid[0]) * snapGrid[0];
      primaryY = Math.round(primaryY / snapGrid[1]) * snapGrid[1];
    }

    // Calculate delta from primary node's start position
    const primaryNodeId = dragState.current.nodeIds[0];
    const primaryStartPos = dragState.current.startPositions.get(primaryNodeId)!;
    const deltaX = primaryX - primaryStartPos.x;
    const deltaY = primaryY - primaryStartPos.y;

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

      // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
      const rect = cachedRectRef.current;
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

  // Cache container rect via ResizeObserver - avoids layout thrashing from getBoundingClientRect()
  // This runs once on mount and updates only when container size changes
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial measurement (only once, at mount)
    const rect = container.getBoundingClientRect();
    cachedRectRef.current = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    // Update on resize (no layout query - ResizeObserver provides size directly)
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        // contentRect gives us width/height without forcing layout
        cachedRectRef.current.width = entry.contentRect.width;
        cachedRectRef.current.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(container);

    // Update position on scroll (rare, but needed for correct pointer position calculation)
    const updatePosition = () => {
      // Only update left/top (position can change on scroll, but size won't)
      const rect = container.getBoundingClientRect();
      cachedRectRef.current.left = rect.left;
      cachedRectRef.current.top = rect.top;
    };
    window.addEventListener('scroll', updatePosition, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updatePosition);
    };
  }, []);

  // Handle pointer down
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!containerRef.current) return;
      // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
      const rect = cachedRectRef.current;

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
          { width: rect.width, height: rect.height },
          socketLayout
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

        // Check if clicking on a node - capture offset for smooth dragging
        const { quadtree, nodeMap } = store.getState();
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(worldPos.x, worldPos.y, queryResultsRef.current);
        const clickedNode = queryResultsRef.current.length > 0 ? nodeMap.get(queryResultsRef.current[0]) : null;

        if (clickedNode) {
          // Store cursor offset from node position (React Flow style)
          // This ensures the node doesn't "jump" when drag threshold is crossed
          pendingDragRef.current = {
            clickedNodeId: clickedNode.id,
            cursorOffset: {
              x: worldPos.x - clickedNode.position.x,
              y: worldPos.y - clickedNode.position.y,
            },
          };
        } else {
          pendingDragRef.current = null;
        }

        containerRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [isSpaceDown, store, socketLayout]
  );

  // Handle pointer move
  // IMPORTANT: Use refs and store state (synchronous) for checks instead of React state
  // (which is batched). This prevents issues when events fire before React processes state updates.
  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const { connectionDraft, selectionBox } = store.getState();
      const primaryButtonDown = (e.buttons & 1) !== 0;

      // Safety cleanup: if button was released but we missed the pointerup event
      // (can happen if released outside container), clean up any active state
      if (!primaryButtonDown && e.buttons === 0) {
        if (dragState.current || selectionBox || connectionDraft || pointerDownPos.current || lastPointerPos.current) {
          // Cancel any active operations
          if (autoScrollRef.current.rafId) {
            cancelAnimationFrame(autoScrollRef.current.rafId);
            autoScrollRef.current.rafId = 0;
          }
          autoScrollRef.current.active = false;
          autoScrollRef.current.lastScreenPos = null;

          if (connectionDraft) {
            store.getState().cancelConnectionDraft();
            setIsConnecting(false);
          }
          if (selectionBox) {
            store.getState().setSelectionBox(null);
            setIsBoxSelecting(false);
          }
          if (dragState.current) {
            setIsDragging(false);
          }
          if (lastPointerPos.current) {
            setIsPanning(false);
          }

          dragState.current = null;
          pendingDragRef.current = null;
          pointerDownPos.current = null;
          lastPointerPos.current = null;
          hasDragged.current = false;
        }
        // Fall through to hover state handling below
      }

      // Handle panning (check ref, not React state)
      // Note: panning uses middle button (button 1) or left button with space, check e.buttons appropriately
      if (lastPointerPos.current && e.buttons !== 0) {
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

      // Handle connection draft (check store state, not React state)
      // Also verify primary button is still held
      if (connectionDraft && primaryButtonDown) {
        // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
        const rect = cachedRectRef.current;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport, nodes, nodeMap } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket hover during connection
        const hoveredSocket = getSocketAtPosition(
          worldPos,
          nodes,
          viewport,
          { width: rect.width, height: rect.height },
          socketLayout
        );
        store.getState().setHoveredSocketId(hoveredSocket);

        // Check type compatibility for visual feedback (always show, regardless of mode)
        // Use nodeMap for O(1) lookups in hot path
        let isTypeCompatible = true;
        if (hoveredSocket) {
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
      // Use refs to check state: dragState.current for dragging, selectionBox for box selection
      if (pointerDownPos.current && !selectionBox && !dragState.current) {
        const dx = e.clientX - pointerDownPos.current.screenX;
        const dy = e.clientY - pointerDownPos.current.screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > DRAG_THRESHOLD) {
          hasDragged.current = true;

          // Check if we're clicking on a node or empty space
          // Use quadtree for O(log n) hit testing
          const { quadtree, nodeMap, selectedNodeIds } = store.getState();
          // Clear and reuse pre-allocated array to avoid GC
          queryResultsRef.current.length = 0;
          quadtree.queryPoint(
            pointerDownPos.current.x,
            pointerDownPos.current.y,
            queryResultsRef.current
          );
          const clickedNode = queryResultsRef.current.length > 0 ? nodeMap.get(queryResultsRef.current[0]) : null;

          if (clickedNode) {
            // Start node dragging
            let dragNodeIds: string[];

            if (selectedNodeIds.has(clickedNode.id)) {
              // Drag all selected nodes - put clicked node FIRST so cursor offset calculation works
              // (cursorOffset was captured relative to clicked node, not arbitrary first selected node)
              dragNodeIds = [clickedNode.id, ...[...selectedNodeIds].filter(id => id !== clickedNode.id)];
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

            // Use cursor offset captured at click time (React Flow style)
            // This ensures smooth dragging - cursor stays at same spot on node
            const cursorOffset = pendingDragRef.current?.cursorOffset ?? { x: 0, y: 0 };

            // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
            dragState.current = {
              nodeIds: dragNodeIds,
              startPositions,
              cursorOffset,
              containerRect: { width: cachedRectRef.current.width, height: cachedRectRef.current.height },
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
      // Use ref check (dragState.current) instead of React state (isDragging)
      // Also verify primary button is still held (e.buttons & 1)
      if (dragState.current && (e.buttons & 1)) {
        // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
        const rect = cachedRectRef.current;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Calculate primary node position using cursor offset (React Flow style)
        // This keeps cursor at same spot on node throughout drag
        let primaryX = worldPos.x - dragState.current.cursorOffset.x;
        let primaryY = worldPos.y - dragState.current.cursorOffset.y;

        // Apply snap to grid if enabled
        if (snapToGrid) {
          primaryX = Math.round(primaryX / snapGrid[0]) * snapGrid[0];
          primaryY = Math.round(primaryY / snapGrid[1]) * snapGrid[1];
        }

        // Calculate delta from primary node's start position
        // This delta applies to all dragged nodes to maintain relative positions
        const primaryNodeId = dragState.current.nodeIds[0];
        const primaryStartPos = dragState.current.startPositions.get(primaryNodeId)!;
        const deltaX = primaryX - primaryStartPos.x;
        const deltaY = primaryY - primaryStartPos.y;

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

      // Update box selection (check store state, not React state)
      // Also verify primary button is still held (e.buttons & 1)
      if (selectionBox && (e.buttons & 1)) {
        // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
        const rect = cachedRectRef.current;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        store.getState().setSelectionBox({
          start: selectionBox.start,
          end: worldPos,
        });
        return;
      }

      // Update hover state (only when not dragging or box selecting)
      if (!pointerDownPos.current) {
        // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
        const rect = cachedRectRef.current;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport, hoveredNodeId, hoveredSocketId, nodes, quadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check socket hover first
        const newHoveredSocket = getSocketAtPosition(
          worldPos,
          nodes,
          viewport,
          { width: rect.width, height: rect.height },
          socketLayout
        );

        // Update socket hover if changed
        if (
          newHoveredSocket?.nodeId !== hoveredSocketId?.nodeId ||
          newHoveredSocket?.socketId !== hoveredSocketId?.socketId
        ) {
          store.getState().setHoveredSocketId(newHoveredSocket);
        }

        // Use quadtree for O(log n) hit testing for nodes
        // Clear and reuse pre-allocated array to avoid GC
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(worldPos.x, worldPos.y, queryResultsRef.current);
        const newHoveredId = queryResultsRef.current.length > 0 ? queryResultsRef.current[0] : null;

        // Only update if changed to avoid unnecessary re-renders
        if (newHoveredId !== hoveredNodeId) {
          store.getState().setHoveredNodeId(newHoveredId);
        }
      }
    },
    [snapToGrid, snapGrid, socketTypes, store, updateViewport, runAutoScroll, socketLayout]
  );

  // Handle pointer up
  // IMPORTANT: Use refs and store state (synchronous) for cleanup checks instead of React state
  // (which is batched). This prevents state from getting stuck when onPointerLeave fires
  // before React has processed the state updates from handlePointerMove.
  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const { connectionDraft, selectionBox } = store.getState();

      // End connection draft (check store state, not React state)
      if (connectionDraft) {
        const { hoveredSocketId, nodeMap } = store.getState();

        if (hoveredSocketId) {
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
        pointerDownPos.current = null;
        pendingDragRef.current = null;
        return;
      }

      // End panning (check ref, not React state)
      if (lastPointerPos.current) {
        setIsPanning(false);
        lastPointerPos.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        pendingDragRef.current = null;
        return;
      }

      // End node dragging (check ref, not React state)
      if (dragState.current) {
        // Cancel auto-scroll
        if (autoScrollRef.current.rafId) {
          cancelAnimationFrame(autoScrollRef.current.rafId);
          autoScrollRef.current.rafId = 0;
        }
        autoScrollRef.current.active = false;
        autoScrollRef.current.lastScreenPos = null;

        setIsDragging(false);
        dragState.current = null;
        pendingDragRef.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }

      // End box selection (check store state, not React state)
      if (selectionBox) {
        const { quadtree, selectedNodeIds } = store.getState();
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

        store.getState().setSelectionBox(null);
        setIsBoxSelecting(false);
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        pendingDragRef.current = null;
        return;
      }

      // Handle click (no drag occurred)
      if (pointerDownPos.current && !hasDragged.current && e.button === 0) {
        // Use quadtree for O(log n) hit testing
        const { quadtree, nodeMap, edges, viewport } = store.getState();
        const clickPos = { x: pointerDownPos.current.x, y: pointerDownPos.current.y };
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(clickPos.x, clickPos.y, queryResultsRef.current);
        const clickedNode = queryResultsRef.current.length > 0 ? nodeMap.get(queryResultsRef.current[0]) : null;

        if (clickedNode) {
          // Click on node: select it
          const additive = e.ctrlKey || e.metaKey;
          store.getState().selectNode(clickedNode.id, additive);
          onNodeClick?.(clickedNode);
        } else if (edgesSelectable) {
          // Check for edge click
          const clickedEdge = getEdgeAtPosition(clickPos, edges, nodeMap, defaultEdgeType, viewport, undefined, socketLayout);
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
      pendingDragRef.current = null;
    },
    [socketTypes, connectionMode, isValidConnection, defaultEdgeType, edgesSelectable, store, onNodeClick, onEdgeClick, onPaneClick, onConnect, socketLayout]
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
      // Skip if typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

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
      if (!containerRef.current) return;
      // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
      const rect = cachedRectRef.current;

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
      if (!containerRef.current) return;
      // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
      const rect = cachedRectRef.current;

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
      style={{
        position: 'absolute',
        inset: 0,
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
  textRenderMode: TextRenderMode;
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
}

/**
 * WebGL text rendering layer using MSDF.
 * Uses FontContext to get the appropriate font atlas based on the font prop.
 */
interface WebGLTextLayerProps {
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  defaultEdgeType: EdgeType;
}

function WebGLTextLayer({ showSocketLabels, showEdgeLabels, defaultEdgeType }: WebGLTextLayerProps) {
  // Fonts are provided via FontContext - MultiWeightTextRenderer will use useFont()
  return (
    <MultiWeightTextRenderer
      showSocketLabels={showSocketLabels}
      showEdgeLabels={showEdgeLabels}
      defaultEdgeType={defaultEdgeType}
    />
  );
}

function FlowCanvas({ showGrid, showStats, defaultEdgeType, socketTypes, textRenderMode, showSocketLabels, showEdgeLabels }: FlowCanvasProps) {
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
      {textRenderMode === 'webgl' && (
        <WebGLTextLayer
          showSocketLabels={showSocketLabels}
          showEdgeLabels={showEdgeLabels}
          defaultEdgeType={defaultEdgeType}
        />
      )}
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
 *
 * CRITICAL: Camera update happens in useFrame to ensure it's synchronized
 * with rendering. We get canvas dimensions directly from the GL context
 * (not R3F's size state) to avoid stale values during resize.
 */
function CameraController() {
  const { camera, gl } = useThree();
  const store = useFlowStoreApi();

  // Track last values to detect changes
  const lastRef = useRef({ x: 0, y: 0, zoom: 0, width: 0, height: 0 });

  // Cache canvas size via ResizeObserver to avoid layout thrashing from clientWidth/clientHeight reads
  const cachedSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = gl.domElement;
    // Initialize with current size
    cachedSizeRef.current.width = canvas.clientWidth;
    cachedSizeRef.current.height = canvas.clientHeight;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        cachedSizeRef.current.width = entry.contentRect.width;
        cachedSizeRef.current.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, [gl]);

  // Update camera synchronously before each frame renders
  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;

    const { viewport } = store.getState();
    const { width, height } = cachedSizeRef.current;
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
  }, -1); // Priority -1: run BEFORE other useFrame hooks (default is 0)

  return null;
}
