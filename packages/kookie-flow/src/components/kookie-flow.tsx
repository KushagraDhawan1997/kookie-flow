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
import { Entities } from './nodes';
import { Edges } from './edges';
import { Sockets } from './sockets';
import { RerouteNodes } from './reroute-nodes';
import { TextEntities } from './text-entities';
import { ImageEntities } from './image-entities';
import { TextEditCursor } from './text-edit-cursor';
import { ConnectionLine } from './connection-line';
import { DOMLayer } from './dom-layer';
import { SelectionBox } from './selection-box';
import { EntitySelection } from './entity-selection';
import { MultiWeightTextRenderer } from './text-renderer';
import { Minimap } from './minimap';
import { WidgetsLayer } from './widgets-layer';
import { ThemeProvider, StyleProvider, FontProvider, useTheme, useSocketLayout } from '../contexts';
import { resolveSocketTypes } from '../utils/socket-types';
import {
  DEFAULT_VIEWPORT,
  DEFAULT_SOCKET_TYPES,
  DEFAULT_ENTITY_WIDTH,
  AUTO_SCROLL_EDGE_THRESHOLD,
  AUTO_SCROLL_MAX_SPEED,
  RESIZE_HANDLE_SIZE,
  RESIZE_HANDLE_HIT_TOLERANCE,
  MIN_ENTITY_WIDTH,
  MIN_ENTITY_HEIGHT,
  MIN_FRAME_WIDTH,
  MIN_FRAME_HEIGHT,
  MIN_COMMENT_WIDTH,
  MIN_COMMENT_HEIGHT,
  MIN_TEXT_WIDTH,
  MIN_TEXT_HEIGHT,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../core/constants';
import { resolveTextStyle, calculateTextAutoHeightMSDF } from '../utils/text-texture';
import { useFont } from '../contexts/FontContext';
import type { GlyphMap, KerningMap } from '../utils/text-layout';
import { buildCharPositionsForEntity, hitTestCharOffset, getWordBoundary, getLineBoundary } from '../utils/text-cursor-layout';
import { getEditingTextarea, suppressEditBlur } from './text-edit-overlay';
import type { TextEntityData } from '../types';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { screenToWorld, getSocketAtPosition, getEdgeAtPosition } from '../utils/geometry';
import { validateConnection, isSocketCompatible } from '../utils/connections';
import { boundsFromCorners } from '../core/spatial';
import { setInteractionMode } from './interaction-state';
import type {
  KookieFlowProps,
  KookieFlowInstance,
  FitViewOptions,
  Entity,
  Edge,
  EntityChange,
  SocketType,
  Connection,
  ConnectionMode,
  IsValidConnectionFn,
  EdgeType,
  TextRenderMode,
} from '../types';
import * as THREE from 'three';

// Detect Safari for specific optimizations
const isSafari =
  typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Main KookieFlow component.
 * Renders a WebGL canvas with an optional DOM overlay.
 *
 * Supports ref for imperative API access (fitView, getViewport, etc.)
 */
export const KookieFlow = forwardRef<KookieFlowInstance, KookieFlowProps>(function KookieFlow(
  {
    entities,
    edges,
    entityTypes = {},
    socketTypes = {},
    onEntitiesChange,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onEntityClick,
    onEdgeClick,
    onPaneClick,
    onFileDrop,
    edgesSelectable = true,
    defaultViewport = DEFAULT_VIEWPORT,
    minZoom = MIN_ZOOM,
    maxZoom = MAX_ZOOM,
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
    allowCycles = true,
    className,
    children,
    // Styling props (Milestone 2)
    size = '2',
    variant = 'surface',
    radius,
    header = 'none',
    accentHeader = false,
    entityStyle,
    // Widget props (Phase 7D)
    widgetTypes,
    onWidgetChange,
    showWidgets = true,
    ThemeComponent,
    defaultEntityWidth,
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
        entityStyle={entityStyle}
      >
        <FontProvider font={font}>
          <ThemedFlowContainer
            ref={ref}
            entities={entities}
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
            allowCycles={allowCycles}
            defaultEdgeType={defaultEdgeType}
            edgesSelectable={edgesSelectable}
            onEntityClick={onEntityClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEntitiesChange={onEntitiesChange}
            onEdgesChange={onEdgesChange}
            onFileDrop={onFileDrop}
            showGrid={showGrid}
            showStats={showStats}
            textRenderMode={textRenderMode}
            showSocketLabels={showSocketLabels}
            showEdgeLabels={showEdgeLabels}
            entityTypes={entityTypes}
            scaleTextWithZoom={scaleTextWithZoom}
            showMinimap={showMinimap}
            minimapProps={minimapProps}
            widgetTypes={widgetTypes}
            onWidgetChange={onWidgetChange}
            showWidgets={showWidgets}
            ThemeComponent={ThemeComponent}
            defaultEntityWidth={defaultEntityWidth}
            socketLabelWidth={socketLabelWidth}
          >
            {children}
          </ThemedFlowContainer>
        </FontProvider>
      </StyleProvider>
    </ThemeProvider>
  );
});

/**
 * Inner container that has access to theme tokens for styling.
 */
interface ThemedFlowContainerProps {
  entities: Entity[];
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
  allowCycles: boolean;
  defaultEdgeType: EdgeType;
  edgesSelectable: boolean;
  onEntityClick?: (entity: Entity) => void;
  onEdgeClick?: (edge: Edge) => void;
  onPaneClick?: () => void;
  onConnect?: (connection: Connection) => void;
  onConnectStart?: KookieFlowProps['onConnectStart'];
  onConnectEnd?: KookieFlowProps['onConnectEnd'];
  onEntitiesChange?: KookieFlowProps['onEntitiesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
  onFileDrop?: KookieFlowProps['onFileDrop'];
  showGrid: boolean;
  showStats: boolean;
  textRenderMode: TextRenderMode;
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  entityTypes: KookieFlowProps['entityTypes'];
  scaleTextWithZoom: boolean;
  showMinimap: boolean;
  minimapProps?: KookieFlowProps['minimapProps'];
  children?: React.ReactNode;
  // Widget props (Phase 7D)
  widgetTypes?: KookieFlowProps['widgetTypes'];
  onWidgetChange?: KookieFlowProps['onWidgetChange'];
  showWidgets: boolean;
  ThemeComponent?: KookieFlowProps['ThemeComponent'];
  defaultEntityWidth?: number;
  socketLabelWidth?: number;
}

const ThemedFlowContainer = forwardRef<KookieFlowInstance, ThemedFlowContainerProps>(
  function ThemedFlowContainer(
    {
      entities,
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
      allowCycles,
      defaultEdgeType,
      edgesSelectable,
      onEntityClick,
      onEdgeClick,
      onPaneClick,
      onConnect,
      onConnectStart,
      onConnectEnd,
      onEntitiesChange,
      onEdgesChange,
      onFileDrop,
      showGrid,
      showStats,
      textRenderMode,
      showSocketLabels,
      showEdgeLabels,
      entityTypes,
      scaleTextWithZoom,
      showMinimap,
      minimapProps,
      children,
      widgetTypes,
      onWidgetChange,
      showWidgets,
      ThemeComponent,
      defaultEntityWidth,
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
        <FlowProvider initialState={{ entities, edges, viewport: defaultViewport }}>
          <FlowInstanceHandle
            ref={ref}
            containerRef={containerRef}
            minZoom={minZoom}
            maxZoom={maxZoom}
          />
          <InputHandler
            minZoom={minZoom}
            maxZoom={maxZoom}
            snapToGrid={snapToGrid}
            snapGrid={snapGrid}
            socketTypes={resolvedSocketTypes}
            connectionMode={connectionMode}
            isValidConnection={isValidConnection}
            allowCycles={allowCycles}
            defaultEdgeType={defaultEdgeType}
            edgesSelectable={edgesSelectable}
            onEntityClick={onEntityClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEntitiesChange={onEntitiesChange}
            onEdgesChange={onEdgesChange}
            onFileDrop={onFileDrop}
          >
            <FlowCanvas
              showGrid={showGrid}
              showStats={showStats}
              defaultEdgeType={defaultEdgeType}
              socketTypes={resolvedSocketTypes}
              textRenderMode={textRenderMode}
              showSocketLabels={showSocketLabels}
              showEdgeLabels={showEdgeLabels}
            />
            <DOMLayer
              entityTypes={entityTypes}
              scaleTextWithZoom={scaleTextWithZoom}
              defaultEdgeType={defaultEdgeType}
              showEntityLabels={textRenderMode === 'dom'}
              showSocketLabels={textRenderMode === 'dom' ? showSocketLabels : false}
              showEdgeLabels={textRenderMode === 'dom' ? showEdgeLabels : false}
              onEntitiesChange={onEntitiesChange}
            >
              {children}
            </DOMLayer>
            {showWidgets && (
              <WidgetsLayer
                socketTypes={resolvedSocketTypes}
                widgetTypes={widgetTypes}
                onWidgetChange={onWidgetChange}
                ThemeComponent={ThemeComponent}
                defaultEntityWidth={defaultEntityWidth}
                socketLabelWidth={socketLabelWidth}
              />
            )}
            {showMinimap && <Minimap {...minimapProps} />}
            <FlowSync
              entities={entities}
              edges={edges}
              socketTypes={resolvedSocketTypes}
              onEntitiesChange={onEntitiesChange}
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

    useImperativeHandle(
      ref,
      () => ({
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

        getEntities: () => {
          return store.getState().entities;
        },

        getEdges: () => {
          return store.getState().edges;
        },

        getSelectedEntities: () => {
          const state = store.getState();
          return state.entities.filter((n) => state.selectedEntityIds.has(n.id));
        },

        getSelectedEdges: () => {
          const state = store.getState();
          return state.edges.filter((e) => state.selectedEdgeIds.has(e.id));
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

        // Grouping API (Phase 7C)
        getGroupChildren: (groupId) => {
          return store.getState().getGroupChildren(groupId);
        },

        getGroupDescendants: (groupId) => {
          return store.getState().getGroupDescendants(groupId);
        },

        toggleGroupCollapse: (groupId) => {
          store.getState().toggleGroupCollapse(groupId);
        },

        expandGroup: (groupId) => {
          store.getState().expandGroup(groupId);
        },

        collapseGroup: (groupId) => {
          store.getState().collapseGroup(groupId);
        },

        isGroupCollapsed: (groupId) => {
          return store.getState().isGroupCollapsed(groupId);
        },

        getGroupBounds: (groupId) => {
          return store.getState().getGroupBounds(groupId);
        },
      }),
      [store, containerRef, minZoom, maxZoom]
    );

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
  allowCycles: boolean;
  defaultEdgeType: EdgeType;
  edgesSelectable: boolean;
  onEntityClick?: (entity: Entity) => void;
  onEdgeClick?: (edge: Edge) => void;
  onPaneClick?: () => void;
  onConnect?: (connection: Connection) => void;
  onConnectStart?: KookieFlowProps['onConnectStart'];
  onConnectEnd?: KookieFlowProps['onConnectEnd'];
  onEntitiesChange?: KookieFlowProps['onEntitiesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
  onFileDrop?: KookieFlowProps['onFileDrop'];
}

// Minimum distance (in pixels) to consider a pointer move as a drag
const DRAG_THRESHOLD = 5;

/** Resize handle direction */
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Cursor CSS value for each resize handle */
const RESIZE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

function InputHandler({
  children,
  minZoom,
  maxZoom,
  snapToGrid,
  snapGrid,
  socketTypes,
  connectionMode,
  isValidConnection,
  allowCycles,
  defaultEdgeType,
  edgesSelectable,
  onEntityClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onConnectStart,
  onConnectEnd,
  onEntitiesChange,
  onEdgesChange,
  onFileDrop,
}: InputHandlerProps) {
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

  // Font data for MSDF text measurement (used in resize handler + click-to-position)
  const fontContext = useFont();
  const regularFont = fontContext.regular;
  const regularFontRef = useRef(regularFont);
  regularFontRef.current = regularFont;
  // Refs pointing to FontContext's pre-built maps (stable references, no rebuilding)
  const glyphMapRef = useRef<GlyphMap>(new Map());
  const kerningMapRef = useRef<KerningMap>(new Map());
  if (regularFont) {
    glyphMapRef.current = regularFont.glyphMap;
    kerningMapRef.current = regularFont.kerningMap;
  }

  // Sync socket layout to store so quadtree bounds use correct entity heights
  useEffect(() => {
    store.getState().setSocketLayout(socketLayout);
  }, [store, socketLayout]);

  // Track interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);

  // Subscribe to editingEntityId for cursor styling (text → default)
  useEffect(() => {
    return store.subscribe(
      (s) => s.editingEntityId,
      (id) => setIsEditingText(id !== null)
    );
  }, [store]);
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  // Track pointer down position to detect clicks vs drags
  const pointerDownPos = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(
    null
  );
  const hasDragged = useRef(false);

  // Track drag state for entity dragging
  const dragState = useRef<{
    entityIds: string[];
    startPositions: Map<string, { x: number; y: number }>;
    cursorOffset: { x: number; y: number }; // Offset from cursor to primary entity position at click time
    containerRect: { width: number; height: number }; // Cached to avoid layout queries in RAF
  } | null>(null);

  // Pending drag info - captured at click time, used when threshold is crossed
  const pendingDragRef = useRef<{
    clickedEntityId: string;
    cursorOffset: { x: number; y: number }; // cursor position - entity position at click time
  } | null>(null);

  // Multi-click detection for text entity editing and word/line/block selection
  const clickCountRef = useRef<{
    count: number; time: number; x: number; y: number; entityId: string;
  } | null>(null);
  const DOUBLE_CLICK_TIMEOUT = 300; // ms
  const DOUBLE_CLICK_DISTANCE = 5; // px screen distance

  // Drag-to-select: anchor offset and cached CharPositionTable for the editing entity
  const textSelectAnchorRef = useRef<number | null>(null);
  const textSelectTableRef = useRef<ReturnType<typeof buildCharPositionsForEntity> | null>(null);
  const textSelectEntityRef = useRef<{ x: number; y: number; pad: number } | null>(null);

  // Auto-scroll state for dragging near viewport edges
  const autoScrollRef = useRef<{
    rafId: number;
    lastScreenPos: { x: number; y: number } | null;
    active: boolean;
  }>({ rafId: 0, lastScreenPos: null, active: false });

  // Track resize state for entity resizing
  const [isResizing, setIsResizing] = useState(false);
  const resizeState = useRef<{
    entityId: string;
    handle: ResizeHandle;
    initialBounds: { x: number; y: number; width: number; height: number };
    initialPointer: { x: number; y: number };
    minWidth: number;
    minHeight: number;
  } | null>(null);
  // Tracks which resize handle (if any) is hovered for cursor changes.
  // Ref for comparison in handlePointerMove (avoids recreating the callback on every handle change).
  // State for cursor rendering (triggers re-render only on null↔handle transitions).
  const hoveredHandleRef = useRef<ResizeHandle | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle | null>(null);

  // Pre-allocated array for quadtree queries (avoids GC in hot paths)
  const queryResultsRef = useRef<string[]>([]);

  // Update viewport immediately for responsive input (no RAF batching)
  // Rendering components handle their own batching via dirty flags
  const updateViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      store.getState().setViewport(viewport);
    },
    [store]
  );

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
    if (
      leftProximity === 0 &&
      rightProximity === 0 &&
      topProximity === 0 &&
      bottomProximity === 0
    ) {
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

    // 2. Update entity positions based on new viewport
    // Use cursor offset approach (same as main drag handler)
    const currentWorldPos = screenToWorld({ x: screenX, y: screenY }, store.getState().viewport);

    // Calculate primary entity position using cursor offset
    let primaryX = currentWorldPos.x - dragState.current.cursorOffset.x;
    let primaryY = currentWorldPos.y - dragState.current.cursorOffset.y;

    if (snapToGrid) {
      primaryX = Math.round(primaryX / snapGrid[0]) * snapGrid[0];
      primaryY = Math.round(primaryY / snapGrid[1]) * snapGrid[1];
    }

    // Calculate delta from primary entity's start position
    const primaryEntityId = dragState.current.entityIds[0];
    const primaryStartPos = dragState.current.startPositions.get(primaryEntityId)!;
    const deltaX = primaryX - primaryStartPos.x;
    const deltaY = primaryY - primaryStartPos.y;

    const updates = dragState.current.entityIds.map((id) => {
      const startPos = dragState.current!.startPositions.get(id)!;
      return {
        id,
        position: { x: startPos.x + deltaX, y: startPos.y + deltaY },
      };
    });
    store.getState().updateEntityPositions(updates);

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

  // Get minimum size constraints for an entity type
  const getMinSize = useCallback((entity: Entity) => {
    switch (entity.type) {
      case 'frame':
        return { minWidth: MIN_FRAME_WIDTH, minHeight: MIN_FRAME_HEIGHT };
      case 'comment':
        return { minWidth: MIN_COMMENT_WIDTH, minHeight: MIN_COMMENT_HEIGHT };
      case 'text':
        return { minWidth: MIN_TEXT_WIDTH, minHeight: MIN_TEXT_HEIGHT };
      case 'image':
        return { minWidth: MIN_IMAGE_WIDTH, minHeight: MIN_IMAGE_HEIGHT };
      default: {
        // Default entities: min height from socket layout
        const layout = getEntitySocketLayout(entity, socketLayout);
        return { minWidth: MIN_ENTITY_WIDTH, minHeight: Math.max(MIN_ENTITY_HEIGHT, layout.computedHeight) };
      }
    }
  }, [socketLayout]);

  // Check if a world position hits a resize handle on any selected entity
  const getResizeHandleAt = useCallback((worldX: number, worldY: number): { entityId: string; handle: ResizeHandle } | null => {
    const { selectedEntityIds, entityMap, viewport, hiddenEntityIds } = store.getState();
    if (selectedEntityIds.size === 0) return null;

    const hitRadius = (RESIZE_HANDLE_SIZE + RESIZE_HANDLE_HIT_TOLERANCE) / (2 * viewport.zoom);

    for (const entityId of selectedEntityIds) {
      const entity = entityMap.get(entityId);
      if (!entity || hiddenEntityIds.has(entity.id)) continue;

      // Skip non-resizable entities
      if (entity.resizable === false) continue;

      const w = entity.width ?? DEFAULT_ENTITY_WIDTH;
      const layout = getEntitySocketLayout(entity, socketLayout);
      const h = entity.height ?? layout.computedHeight;
      const x = entity.position.x;
      const y = entity.position.y;

      const resizable = entity.resizable;
      const canW = resizable === undefined || resizable === true ||
        (typeof resizable === 'object' && resizable.width !== false);
      const canH = resizable === undefined || resizable === true ||
        (typeof resizable === 'object' && resizable.height !== false);

      // Inline hit test — no array allocation. Check each handle position directly.
      const r2 = hitRadius * hitRadius;
      const halfW = w / 2;
      const halfH = h / 2;

      let dx: number, dy: number;

      if (canW && canH) {
        dx = worldX - x; dy = worldY - y;
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'nw' as ResizeHandle };
        dx = worldX - (x + w); dy = worldY - y;
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'ne' as ResizeHandle };
        dx = worldX - (x + w); dy = worldY - (y + h);
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'se' as ResizeHandle };
        dx = worldX - x; dy = worldY - (y + h);
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'sw' as ResizeHandle };
      }
      if (canH) {
        dx = worldX - (x + halfW); dy = worldY - y;
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'n' as ResizeHandle };
        dx = worldX - (x + halfW); dy = worldY - (y + h);
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 's' as ResizeHandle };
      }
      if (canW) {
        dx = worldX - (x + w); dy = worldY - (y + halfH);
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'e' as ResizeHandle };
        dx = worldX - x; dy = worldY - (y + halfH);
        if (dx * dx + dy * dy <= r2) return { entityId, handle: 'w' as ResizeHandle };
      }
    }

    return null;
  }, [store, socketLayout]);

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
        const { viewport, entities } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket click first
        const socket = getSocketAtPosition(
          worldPos,
          entities,
          viewport,
          { width: rect.width, height: rect.height },
          socketLayout
        );

        if (socket) {
          // Start connection draft with current mouse position
          store.getState().startConnectionDraft(socket, worldPos);
          setIsConnecting(true);
          setInteractionMode('connecting');
          // Capture pointer to the container, not e.target, to ensure we receive move events
          containerRef.current?.setPointerCapture(e.pointerId);

          // Fire onConnectStart callback
          onConnectStart?.(e.nativeEvent, {
            entityId: socket.entityId,
            socketId: socket.socketId,
            isInput: socket.isInput,
          });
          return;
        }

        // Check for resize handle click (before entity drag)
        const resizeHit = getResizeHandleAt(worldPos.x, worldPos.y);
        if (resizeHit) {
          const entity = store.getState().entityMap.get(resizeHit.entityId);
          if (entity) {
            const w = entity.width ?? DEFAULT_ENTITY_WIDTH;
            const layout = getEntitySocketLayout(entity, socketLayout);
            const h = entity.height ?? layout.computedHeight;
            const { minWidth, minHeight } = getMinSize(entity);

            resizeState.current = {
              entityId: resizeHit.entityId,
              handle: resizeHit.handle,
              initialBounds: { x: entity.position.x, y: entity.position.y, width: w, height: h },
              initialPointer: { x: worldPos.x, y: worldPos.y },
              minWidth,
              minHeight,
            };
            setIsResizing(true);
            setInteractionMode('resizing');
            containerRef.current?.setPointerCapture(e.pointerId);
            return;
          }
        }

        // Store the pointer down position
        pointerDownPos.current = {
          x: worldPos.x,
          y: worldPos.y,
          screenX: e.clientX,
          screenY: e.clientY,
        };
        hasDragged.current = false;

        // Check if clicking on an entity - capture offset for smooth dragging
        const { quadtree, entityMap } = store.getState();
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(worldPos.x, worldPos.y, queryResultsRef.current);
        const clickedEntity =
          queryResultsRef.current.length > 0 ? entityMap.get(queryResultsRef.current[0]) : null;

        if (clickedEntity) {
          const editingId = store.getState().editingEntityId;

          if (editingId === clickedEntity.id && clickedEntity.type === 'text') {
            // Clicking on the entity being edited — set up drag-to-select anchor
            suppressEditBlur();
            const font = regularFontRef.current;
            if (font && glyphMapRef.current.size > 0) {
              const data = clickedEntity.data as TextEntityData;
              const content = store.getState().editingContent ?? (data.content ?? '');
              const w = clickedEntity.width ?? DEFAULT_TEXT_WIDTH;
              const fontSize = data.fontSize ?? 16;
              const lineHeightMul = data.lineHeight ?? 1.5;
              const letterSp = data.letterSpacing ?? 0;
              const textAlignVal = data.textAlign ?? 'left';
              const pad = 4;

              const table = buildCharPositionsForEntity(
                content, fontSize, lineHeightMul, textAlignVal,
                w, pad, clickedEntity.position.x, clickedEntity.position.y,
                font.metrics, glyphMapRef.current, kerningMapRef.current, letterSp
              );
              const anchor = hitTestCharOffset(
                worldPos.x, worldPos.y, table,
                clickedEntity.position.x, clickedEntity.position.y, pad
              );

              textSelectAnchorRef.current = anchor;
              textSelectTableRef.current = table;
              textSelectEntityRef.current = {
                x: clickedEntity.position.x, y: clickedEntity.position.y, pad,
              };
            }
            // Don't set pendingDragRef — prevent entity dragging while editing
            pendingDragRef.current = null;
          } else {
            // Suppress blur for double-click sequence on editing entity
            if (editingId === clickedEntity.id) {
              suppressEditBlur();
            }
            textSelectAnchorRef.current = null;
            textSelectTableRef.current = null;
            textSelectEntityRef.current = null;

            // Store cursor offset from entity position (React Flow style)
            pendingDragRef.current = {
              clickedEntityId: clickedEntity.id,
              cursorOffset: {
                x: worldPos.x - clickedEntity.position.x,
                y: worldPos.y - clickedEntity.position.y,
              },
            };
          }
        } else {
          textSelectAnchorRef.current = null;
          textSelectTableRef.current = null;
          textSelectEntityRef.current = null;
          pendingDragRef.current = null;
        }

        containerRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [isSpaceDown, store, socketLayout, onConnectStart, getResizeHandleAt, getMinSize]
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
        if (
          dragState.current ||
          resizeState.current ||
          selectionBox ||
          connectionDraft ||
          pointerDownPos.current ||
          lastPointerPos.current
        ) {
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
          if (resizeState.current) {
            setIsResizing(false);
            resizeState.current = null;
          }
          if (lastPointerPos.current) {
            setIsPanning(false);
          }

          setInteractionMode('idle');
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
        const { viewport, entities, entityMap } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket hover during connection
        const hoveredSocket = getSocketAtPosition(
          worldPos,
          entities,
          viewport,
          { width: rect.width, height: rect.height },
          socketLayout
        );
        store.getState().setHoveredSocketId(hoveredSocket);

        // Check type compatibility for visual feedback (always show, regardless of mode)
        // Use entityMap for O(1) lookups in hot path
        let isTypeCompatible = true;
        if (hoveredSocket) {
          isTypeCompatible = isSocketCompatible(
            connectionDraft.source,
            hoveredSocket,
            entityMap,
            socketTypes
          );

          // Also check cycle prevention for visual feedback
          if (isTypeCompatible && !allowCycles) {
            const isSourceInput = connectionDraft.source.isInput;
            const sourceNodeId = isSourceInput ? hoveredSocket.entityId : connectionDraft.source.entityId;
            const targetNodeId = isSourceInput ? connectionDraft.source.entityId : hoveredSocket.entityId;
            if (store.getState().wouldCreateCycle(sourceNodeId, targetNodeId)) {
              isTypeCompatible = false;
            }
          }
        }

        // Update connection draft position and validity (for visual feedback)
        store.getState().updateConnectionDraft(worldPos, isTypeCompatible);
        return;
      }

      // Handle active resize drag
      if (resizeState.current && primaryButtonDown) {
        const rect = cachedRectRef.current;
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        const rs = resizeState.current;
        let dx = worldPos.x - rs.initialPointer.x;
        let dy = worldPos.y - rs.initialPointer.y;

        // Apply snap to grid if enabled
        if (snapToGrid) {
          dx = Math.round(dx / snapGrid[0]) * snapGrid[0];
          dy = Math.round(dy / snapGrid[1]) * snapGrid[1];
        }

        let newX = rs.initialBounds.x;
        let newY = rs.initialBounds.y;
        let newW = rs.initialBounds.width;
        let newH = rs.initialBounds.height;

        // Compute new bounds based on handle direction
        const h = rs.handle;
        if (h === 'e' || h === 'ne' || h === 'se') newW = rs.initialBounds.width + dx;
        if (h === 'w' || h === 'nw' || h === 'sw') { newW = rs.initialBounds.width - dx; newX = rs.initialBounds.x + dx; }
        if (h === 's' || h === 'se' || h === 'sw') newH = rs.initialBounds.height + dy;
        if (h === 'n' || h === 'ne' || h === 'nw') { newH = rs.initialBounds.height - dy; newY = rs.initialBounds.y + dy; }

        // Clamp to minimum sizes
        if (newW < rs.minWidth) {
          const diff = rs.minWidth - newW;
          newW = rs.minWidth;
          if (h === 'w' || h === 'nw' || h === 'sw') newX -= diff;
        }
        if (newH < rs.minHeight) {
          const diff = rs.minHeight - newH;
          newH = rs.minHeight;
          if (h === 'n' || h === 'ne' || h === 'nw') newY -= diff;
        }

        // Text entities: auto-height — recompute height from content after width change
        const resizedEntity = store.getState().entityMap.get(rs.entityId);
        if (resizedEntity?.type === 'text') {
          const data = resizedEntity.data as TextEntityData;
          const style = resolveTextStyle(data);
          const resizeFont = regularFontRef.current;
          if (resizeFont && glyphMapRef.current.size > 0) {
            newH = calculateTextAutoHeightMSDF(
              data.content, style, newW,
              resizeFont.metrics.info.size, glyphMapRef.current, kerningMapRef.current
            );
          } else {
            // Fallback: single line height + padding
            newH = Math.max(
              style.fontSize * style.lineHeight + 2 * style.padding,
              style.fontSize * style.lineHeight + 2 * style.padding
            );
          }
        }

        // Update entity dimensions and position
        const posChanged = newX !== rs.initialBounds.x || newY !== rs.initialBounds.y;
        store.getState().updateEntityDimensions(
          rs.entityId,
          newW,
          newH,
          posChanged ? { x: newX, y: newY } : undefined
        );

        return;
      }

      // Check for drag threshold to start box selection or entity dragging
      // Use refs to check state: dragState.current for dragging, selectionBox for box selection
      if (pointerDownPos.current && !selectionBox && !dragState.current) {
        const dx = e.clientX - pointerDownPos.current.screenX;
        const dy = e.clientY - pointerDownPos.current.screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > DRAG_THRESHOLD) {
          hasDragged.current = true;

          // Drag-to-select: if text select anchor is set, update selection range
          if (textSelectAnchorRef.current !== null && textSelectTableRef.current && textSelectEntityRef.current) {
            const rect = cachedRectRef.current;
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const { viewport } = store.getState();
            const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

            const ent = textSelectEntityRef.current;
            const offset = hitTestCharOffset(
              worldPos.x, worldPos.y, textSelectTableRef.current,
              ent.x, ent.y, ent.pad
            );

            const anchor = textSelectAnchorRef.current;
            const start = Math.min(anchor, offset);
            const end = Math.max(anchor, offset);
            store.getState().setEditingCursor(start, end);

            const ta = getEditingTextarea();
            if (ta) {
              ta.selectionStart = start;
              ta.selectionEnd = end;
            }
            return;
          }

          // Check if we're clicking on an entity or empty space
          // Use quadtree for O(log n) hit testing
          const { quadtree, entityMap, selectedEntityIds } = store.getState();
          // Clear and reuse pre-allocated array to avoid GC
          queryResultsRef.current.length = 0;
          quadtree.queryPoint(
            pointerDownPos.current.x,
            pointerDownPos.current.y,
            queryResultsRef.current
          );
          const clickedEntity =
            queryResultsRef.current.length > 0 ? entityMap.get(queryResultsRef.current[0]) : null;

          if (clickedEntity) {
            // Start entity dragging
            let dragEntityIds: string[];

            if (selectedEntityIds.has(clickedEntity.id)) {
              // Drag all selected entities - put clicked entity FIRST so cursor offset calculation works
              // (cursorOffset was captured relative to clicked entity, not arbitrary first selected entity)
              dragEntityIds = [
                clickedEntity.id,
                ...[...selectedEntityIds].filter((id) => id !== clickedEntity.id),
              ];
            } else {
              // Select and drag just this entity
              store.getState().selectEntity(clickedEntity.id);
              dragEntityIds = [clickedEntity.id];
            }

            // Store initial positions
            const startPositions = new Map<string, { x: number; y: number }>();
            for (const id of dragEntityIds) {
              const entity = entityMap.get(id);
              if (entity) startPositions.set(id, { x: entity.position.x, y: entity.position.y });
            }

            // Use cursor offset captured at click time (React Flow style)
            // This ensures smooth dragging - cursor stays at same spot on entity
            const cursorOffset = pendingDragRef.current?.cursorOffset ?? { x: 0, y: 0 };

            // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
            dragState.current = {
              entityIds: dragEntityIds,
              startPositions,
              cursorOffset,
              containerRect: {
                width: cachedRectRef.current.width,
                height: cachedRectRef.current.height,
              },
            };
            setIsDragging(true);
            setInteractionMode('dragging');
          } else {
            // Start box selection
            setIsBoxSelecting(true);
            setInteractionMode('boxSelecting');
            store.getState().setSelectionBox({
              start: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
              end: { x: pointerDownPos.current.x, y: pointerDownPos.current.y },
            });
          }
        }
      }

      // Update entity dragging
      // Use ref check (dragState.current) instead of React state (isDragging)
      // Also verify primary button is still held (e.buttons & 1)
      if (dragState.current && e.buttons & 1) {
        // Use cached rect (updated via ResizeObserver) - avoids layout thrashing
        const rect = cachedRectRef.current;

        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { viewport } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Calculate primary entity position using cursor offset (React Flow style)
        // This keeps cursor at same spot on entity throughout drag
        let primaryX = worldPos.x - dragState.current.cursorOffset.x;
        let primaryY = worldPos.y - dragState.current.cursorOffset.y;

        // Apply snap to grid if enabled
        if (snapToGrid) {
          primaryX = Math.round(primaryX / snapGrid[0]) * snapGrid[0];
          primaryY = Math.round(primaryY / snapGrid[1]) * snapGrid[1];
        }

        // Calculate delta from primary entity's start position
        // This delta applies to all dragged entities to maintain relative positions
        const primaryEntityId = dragState.current.entityIds[0];
        const primaryStartPos = dragState.current.startPositions.get(primaryEntityId)!;
        const deltaX = primaryX - primaryStartPos.x;
        const deltaY = primaryY - primaryStartPos.y;

        // Update all dragged entity positions
        const updates = dragState.current.entityIds.map((id) => {
          const startPos = dragState.current!.startPositions.get(id)!;
          return {
            id,
            position: { x: startPos.x + deltaX, y: startPos.y + deltaY },
          };
        });

        store.getState().updateEntityPositions(updates);

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
      if (selectionBox && e.buttons & 1) {
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
        const { viewport, hoveredEntityId, hoveredSocketId, entities, quadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check resize handle hover first (for cursor feedback)
        const handleHit = getResizeHandleAt(worldPos.x, worldPos.y);
        const newHandle = handleHit?.handle ?? null;
        if (newHandle !== hoveredHandleRef.current) {
          hoveredHandleRef.current = newHandle;
          setHoveredHandle(newHandle);
        }

        // Check socket hover first
        const newHoveredSocket = getSocketAtPosition(
          worldPos,
          entities,
          viewport,
          { width: rect.width, height: rect.height },
          socketLayout
        );

        // Update socket hover if changed
        if (
          newHoveredSocket?.entityId !== hoveredSocketId?.entityId ||
          newHoveredSocket?.socketId !== hoveredSocketId?.socketId
        ) {
          store.getState().setHoveredSocketId(newHoveredSocket);
        }

        // Use quadtree for O(log n) hit testing for entities
        // Clear and reuse pre-allocated array to avoid GC
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(worldPos.x, worldPos.y, queryResultsRef.current);
        const newHoveredId = queryResultsRef.current.length > 0 ? queryResultsRef.current[0] : null;

        // Only update if changed to avoid unnecessary re-renders
        if (newHoveredId !== hoveredEntityId) {
          store.getState().setHoveredEntityId(newHoveredId);
        }
      }
    },
    [snapToGrid, snapGrid, socketTypes, allowCycles, store, updateViewport, runAutoScroll, socketLayout, getResizeHandleAt]
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
        const { hoveredSocketId, entityMap, viewport } = store.getState();
        let connectionSucceeded = false;

        if (hoveredSocketId) {
          // Check if connection is valid (use entityMap for O(1))
          let isValid = validateConnection(
            connectionDraft.source,
            hoveredSocketId,
            entityMap,
            socketTypes,
            connectionMode,
            isValidConnection
          );

          // Check cycle prevention when allowCycles is false
          if (isValid && !allowCycles) {
            const isSourceInput = connectionDraft.source.isInput;
            const sourceNodeId = isSourceInput ? hoveredSocketId.entityId : connectionDraft.source.entityId;
            const targetNodeId = isSourceInput ? connectionDraft.source.entityId : hoveredSocketId.entityId;
            if (store.getState().wouldCreateCycle(sourceNodeId, targetNodeId)) {
              isValid = false;
            }
          }

          if (isValid) {
            connectionSucceeded = true;

            // Check type compatibility separately for invalid flag
            // In loose mode, connection is allowed but marked invalid if types don't match
            const isTypeCompatible = isSocketCompatible(
              connectionDraft.source,
              hoveredSocketId,
              entityMap,
              socketTypes
            );

            // Determine source and target based on input/output
            const isSourceInput = connectionDraft.source.isInput;
            const connection: Connection = {
              source: isSourceInput ? hoveredSocketId.entityId : connectionDraft.source.entityId,
              sourceSocket: isSourceInput
                ? hoveredSocketId.socketId
                : connectionDraft.source.socketId,
              target: isSourceInput ? connectionDraft.source.entityId : hoveredSocketId.entityId,
              targetSocket: isSourceInput
                ? connectionDraft.source.socketId
                : hoveredSocketId.socketId,
              invalid: !isTypeCompatible,
            };

            // Call onConnect callback
            onConnect?.(connection);
          }
        }

        // Fire onConnectEnd before clearing the draft
        if (onConnectEnd) {
          const rect = cachedRectRef.current;
          const dropScreenPos = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          };
          const dropWorldPos = screenToWorld(dropScreenPos, viewport);

          onConnectEnd(e.nativeEvent, {
            isValid: connectionSucceeded,
            source: {
              entityId: connectionDraft.source.entityId,
              socketId: connectionDraft.source.socketId,
              isInput: connectionDraft.source.isInput,
            },
            position: dropWorldPos,
          });
        }

        // Cancel the draft
        store.getState().cancelConnectionDraft();
        setIsConnecting(false);
        setInteractionMode('idle');
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

      // End resize (check ref, not React state)
      if (resizeState.current) {
        // Emit dimension + position changes to external callback
        const rs = resizeState.current;
        const entity = store.getState().entityMap.get(rs.entityId);
        if (entity && onEntitiesChange) {
          const changes: EntityChange[] = [{
            type: 'dimensions',
            id: rs.entityId,
            dimensions: { width: entity.width ?? rs.initialBounds.width, height: entity.height ?? rs.initialBounds.height },
          }];
          // Handles that move the entity origin (N/NW/NE/W/SW) also change position
          if (entity.position.x !== rs.initialBounds.x || entity.position.y !== rs.initialBounds.y) {
            changes.push({ type: 'position', id: rs.entityId, position: entity.position });
          }
          onEntitiesChange(changes);
        }

        setIsResizing(false);
        setInteractionMode('idle');
        resizeState.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        return;
      }

      // End entity dragging (check ref, not React state)
      if (dragState.current) {
        // Cancel auto-scroll
        if (autoScrollRef.current.rafId) {
          cancelAnimationFrame(autoScrollRef.current.rafId);
          autoScrollRef.current.rafId = 0;
        }
        autoScrollRef.current.active = false;
        autoScrollRef.current.lastScreenPos = null;

        // Emit position changes to external callback so controlled state stays in sync
        if (onEntitiesChange) {
          const { entityMap } = store.getState();
          const posChanges: EntityChange[] = [];
          for (const id of dragState.current.entityIds) {
            const entity = entityMap.get(id);
            if (entity) {
              posChanges.push({ type: 'position', id, position: entity.position });
            }
          }
          if (posChanges.length > 0) onEntitiesChange(posChanges);
        }

        setIsDragging(false);
        setInteractionMode('idle');
        dragState.current = null;
        pendingDragRef.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }

      // End box selection (check store state, not React state)
      if (selectionBox) {
        const { quadtree, selectedEntityIds } = store.getState();
        // Use quadtree for O(log n) range query
        const bounds = boundsFromCorners(
          selectionBox.start.x,
          selectionBox.start.y,
          selectionBox.end.x,
          selectionBox.end.y
        );
        const selectedIds = quadtree.queryRange(bounds);

        // Select the entities (additive with Ctrl/Cmd key)
        if (e.ctrlKey || e.metaKey) {
          // Add to existing selection - use Set for O(1) merge
          const newSelection = [...new Set([...selectedEntityIds, ...selectedIds])];
          store.getState().selectEntities(newSelection);
        } else {
          store.getState().selectEntities(selectedIds);
        }

        store.getState().setSelectionBox(null);
        setIsBoxSelecting(false);
        setInteractionMode('idle');
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        pendingDragRef.current = null;
        return;
      }

      // End text drag-to-select (selection already applied during pointerMove)
      if (textSelectAnchorRef.current !== null && hasDragged.current) {
        textSelectAnchorRef.current = null;
        textSelectTableRef.current = null;
        textSelectEntityRef.current = null;
        containerRef.current?.releasePointerCapture(e.pointerId);
        pointerDownPos.current = null;
        return;
      }
      // Clear text select refs even if no drag (single click handled below)
      textSelectAnchorRef.current = null;
      textSelectTableRef.current = null;
      textSelectEntityRef.current = null;

      // Handle click (no drag occurred)
      if (pointerDownPos.current && !hasDragged.current && e.button === 0) {
        // Use quadtree for O(log n) hit testing
        const { quadtree, entityMap, edges, viewport } = store.getState();
        const clickPos = { x: pointerDownPos.current.x, y: pointerDownPos.current.y };
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(clickPos.x, clickPos.y, queryResultsRef.current);
        const clickedEntity =
          queryResultsRef.current.length > 0 ? entityMap.get(queryResultsRef.current[0]) : null;

        if (clickedEntity) {
          // Track multi-click count (for double/triple/quad click detection)
          const now = performance.now();
          const prev = clickCountRef.current;
          let clickCount = 1;
          if (
            prev &&
            prev.entityId === clickedEntity.id &&
            now - prev.time < DOUBLE_CLICK_TIMEOUT &&
            Math.abs(e.clientX - prev.x) < DOUBLE_CLICK_DISTANCE &&
            Math.abs(e.clientY - prev.y) < DOUBLE_CLICK_DISTANCE
          ) {
            clickCount = prev.count + 1;
          }
          clickCountRef.current = {
            count: clickCount, time: now,
            x: e.clientX, y: e.clientY, entityId: clickedEntity.id,
          };

          const currentEditingId = store.getState().editingEntityId;
          const font = regularFontRef.current;

          // Already editing this text entity — handle click/multi-click
          if (
            currentEditingId === clickedEntity.id &&
            clickedEntity.type === 'text' &&
            font && glyphMapRef.current.size > 0
          ) {
            const data = clickedEntity.data as TextEntityData;
            const content = store.getState().editingContent ?? (data.content ?? '');
            const w = clickedEntity.width ?? DEFAULT_TEXT_WIDTH;
            const fontSize = data.fontSize ?? 16;
            const lineHeightMul = data.lineHeight ?? 1.5;
            const letterSp = data.letterSpacing ?? 0;
            const textAlignVal = data.textAlign ?? 'left';
            const pad = 4; // DEFAULT_TEXT_PADDING

            const table = buildCharPositionsForEntity(
              content, fontSize, lineHeightMul, textAlignVal,
              w, pad, clickedEntity.position.x, clickedEntity.position.y,
              font.metrics, glyphMapRef.current, kerningMapRef.current, letterSp
            );

            const offset = hitTestCharOffset(
              clickPos.x, clickPos.y, table,
              clickedEntity.position.x, clickedEntity.position.y, pad
            );

            let selStart: number;
            let selEnd: number;

            if (clickCount >= 4) {
              // Quad+ click: select entire block
              selStart = 0;
              selEnd = content.length;
            } else if (clickCount === 3) {
              // Triple-click: select visual (wrapped) line
              const bounds = getLineBoundary(offset, table);
              selStart = bounds.start;
              selEnd = bounds.end;
            } else if (clickCount === 2) {
              // Double-click: select word
              const bounds = getWordBoundary(offset, content);
              selStart = bounds.start;
              selEnd = bounds.end;
            } else {
              // Single click: reposition cursor
              selStart = offset;
              selEnd = offset;
            }

            store.getState().setEditingCursor(selStart, selEnd);

            const ta = getEditingTextarea();
            if (ta) {
              ta.selectionStart = selStart;
              ta.selectionEnd = selEnd;
              ta.focus();
            }

            containerRef.current?.releasePointerCapture(e.pointerId);
            return;
          }

          // If editing a different entity, stop editing
          if (currentEditingId && currentEditingId !== clickedEntity.id) {
            store.getState().stopEditing();
          }

          // Double-click on non-editing text entity: enter edit mode
          if (clickCount >= 2 && clickedEntity.type === 'text') {
            store.getState().startEditing(clickedEntity.id);
            // Reset click counter so subsequent clicks in edit mode start fresh
            // (prevents double-click-to-enter counting toward in-edit multi-clicks)
            clickCountRef.current = null;
          }

          // Click on entity: select it
          const additive = e.ctrlKey || e.metaKey;
          store.getState().selectEntity(clickedEntity.id, additive);
          onEntityClick?.(clickedEntity);
        } else if (edgesSelectable) {
          // Check for edge click
          const clickedEdge = getEdgeAtPosition(
            clickPos,
            edges,
            entityMap,
            defaultEdgeType,
            viewport,
            undefined,
            socketLayout
          );
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
    [
      socketTypes,
      connectionMode,
      isValidConnection,
      allowCycles,
      defaultEdgeType,
      edgesSelectable,
      store,
      onEntityClick,
      onEdgeClick,
      onPaneClick,
      onConnect,
      onConnectEnd,
      onEntitiesChange,
      socketLayout,
    ]
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Space: enable pan mode
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpaceDown(true);
      }

      // Ctrl+A or Cmd+A: select all entities
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault();
        store.getState().selectAll();
      }

      // Escape: exit text editing, cancel connection, box selection, or deselect all
      if (e.code === 'Escape') {
        if (store.getState().editingEntityId) {
          store.getState().stopEditing();
        } else if (isConnecting) {
          store.getState().cancelConnectionDraft();
          setIsConnecting(false);
        } else if (isBoxSelecting) {
          store.getState().setSelectionBox(null);
          setIsBoxSelecting(false);
        } else {
          store.getState().deselectAll();
        }
      }

      // Delete/Backspace: delete selected entities and edges
      if (e.code === 'Delete' || e.code === 'Backspace') {
        const { selectedEntityIds, selectedEdgeIds, edges } = store.getState();

        // Collect all edges to delete: selected edges + edges connected to deleted entities
        const edgeIdsToDelete = new Set(selectedEdgeIds);
        if (selectedEntityIds.size > 0) {
          for (const edge of edges) {
            if (selectedEntityIds.has(edge.source) || selectedEntityIds.has(edge.target)) {
              edgeIdsToDelete.add(edge.id);
            }
          }
        }

        // Delete edges (selected + dangling)
        if (edgeIdsToDelete.size > 0) {
          const edgeChanges = Array.from(edgeIdsToDelete).map((id) => ({
            type: 'remove' as const,
            id,
          }));
          onEdgesChange?.(edgeChanges);
          store.getState().applyEdgeChanges(edgeChanges);
        }

        // Delete selected entities
        if (selectedEntityIds.size > 0) {
          const entityChanges = Array.from(selectedEntityIds).map((id) => ({
            type: 'remove' as const,
            id,
          }));
          onEntitiesChange?.(entityChanges);
          store.getState().applyEntityChanges(entityChanges);
        }

        // Clear selection
        store.getState().deselectAll();
      }

      // T key: create text entity at viewport center
      if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const { viewport } = store.getState();
        const rect = cachedRectRef.current;
        const centerX = (-viewport.x + rect.width / 2) / viewport.zoom - DEFAULT_TEXT_WIDTH / 2;
        const centerY = (-viewport.y + rect.height / 2) / viewport.zoom - DEFAULT_TEXT_HEIGHT / 2;

        const newEntity = {
          id: `kf-text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'text' as const,
          position: { x: centerX, y: centerY },
          width: DEFAULT_TEXT_WIDTH,
          height: DEFAULT_TEXT_HEIGHT,
          data: { content: '' } as TextEntityData,
          resizable: { width: true, height: false },
        };

        onEntitiesChange?.([{ type: 'add', entity: newEntity }]);
        store.getState().applyEntityChanges([{ type: 'add', entity: newEntity }]);
        store.getState().selectEntity(newEntity.id);
        store.getState().startEditing(newEntity.id);
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
  }, [isPanning, isBoxSelecting, isConnecting, store, onEntitiesChange, onEdgesChange]);

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
        cursor:
          isResizing
            ? (resizeState.current ? RESIZE_CURSORS[resizeState.current.handle] : 'default')
            : isPanning || isDragging
              ? 'grabbing'
              : isSpaceDown
                ? 'grab'
                : isBoxSelecting
                  ? 'crosshair'
                  : isConnecting
                    ? 'crosshair'
                    : hoveredHandle
                      ? RESIZE_CURSORS[hoveredHandle]
                      : isEditingText
                        ? 'text'
                        : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => {
        handlePointerUp(e);
        store.getState().setHoveredEntityId(null);
        store.getState().setHoveredSocketId(null);
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onDragOver={onFileDrop ? (e) => e.preventDefault() : undefined}
      onDrop={onFileDrop ? (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return;
        const rect = cachedRectRef.current;
        const worldPos = screenToWorld(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          store.getState().viewport,
        );
        onFileDrop(files, worldPos);
      } : undefined}
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

function WebGLTextLayer({
  showSocketLabels,
  showEdgeLabels,
  defaultEdgeType,
}: WebGLTextLayerProps) {
  // Fonts are provided via FontContext - MultiWeightTextRenderer will use useFont()
  return (
    <MultiWeightTextRenderer
      showSocketLabels={showSocketLabels}
      showEdgeLabels={showEdgeLabels}
      defaultEdgeType={defaultEdgeType}
    />
  );
}

function FlowCanvas({
  showGrid,
  showStats,
  defaultEdgeType,
  socketTypes,
  textRenderMode,
  showSocketLabels,
  showEdgeLabels,
}: FlowCanvasProps) {
  // WebGL context attributes optimized for Safari
  const glConfig = useMemo(
    () => ({
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
    }),
    []
  );

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
      <TextEntities />
      <ImageEntities />
      <Edges defaultEdgeType={defaultEdgeType} socketTypes={socketTypes} />
      <Sockets socketTypes={socketTypes} />
      <Entities />
      <TextEditCursor />
      <RerouteNodes />
      <EntitySelection />
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
  entities: KookieFlowProps['entities'];
  edges: KookieFlowProps['edges'];
  socketTypes: Record<string, SocketType>;
  onEntitiesChange?: KookieFlowProps['onEntitiesChange'];
  onEdgesChange?: KookieFlowProps['onEdgesChange'];
}

function FlowSync({ entities, edges, socketTypes, onEntitiesChange, onEdgesChange }: FlowSyncProps) {
  const store = useFlowStoreApi();

  useEffect(() => {
    store.getState().setEntities(entities);
  }, [entities, store]);

  // Compute invalid flag for edges that don't have it (e.g., loaded from external source)
  // This runs once when edges change, not every frame
  // Only creates new edge objects when actually needed to avoid triggering subscriptions
  useEffect(() => {
    const { entityMap } = store.getState();

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
            { entityId: edge.source, socketId: edge.sourceSocket, isInput: false },
            { entityId: edge.target, socketId: edge.targetSocket, isInput: true },
            entityMap,
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
    if (!onEntitiesChange) return;

    const unsubscribe = store.subscribe(
      (state) => state.entities,
      (newEntities, prevEntities) => {
        // Generate change events (simplified)
      }
    );

    return unsubscribe;
  }, [store, onEntitiesChange]);

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
