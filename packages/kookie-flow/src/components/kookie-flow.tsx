import {
  useEffect,
  useRef,
  useLayoutEffect,
  useCallback,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useId,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import { VideoEntities } from './video-entities';
import { MeshEntities } from './mesh-entities';
import { PreviewEntities } from './preview-entities';
import { TextEditCursor } from './text-edit-cursor';
import { ConnectionLine } from './connection-line';
import { DOMLayer } from './dom-layer';
import { SelectionBox } from './selection-box';
import { EntitySelection } from './entity-selection';
import { MultiWeightTextRenderer } from './text-renderer';
import { Minimap } from './minimap';
import { WidgetsLayer } from './widgets-layer';
import { WidgetsGL } from './widgets-gl';
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
  MIN_VIDEO_WIDTH,
  MIN_VIDEO_HEIGHT,
  MIN_MESH_WIDTH,
  MIN_MESH_HEIGHT,
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../core/constants';
import { resolveTextStyle, calculateTextAutoHeightMSDF } from '../utils/text-texture';
import { useFont, resolveFontForWeight } from '../contexts/FontContext';
import type { GlyphMap, KerningMap } from '../utils/text-layout';
import { buildCharPositionsForEntity, hitTestCharOffset, getWordBoundary, getLineBoundary } from '../utils/text-cursor-layout';
import { getEditingTextarea, suppressEditBlur } from './text-edit-overlay';
import type { TextEntityData } from '../types';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { screenToWorld, getSocketAtPositionFast, getEdgeAtPosition } from '../utils/geometry';
import { isPointInWidget } from '../utils/widget-geometry';
import {
  getWidgetAt,
  getWidgetSocketIdAt,
  sliderValueAt,
  MIN_WIDGET_ZOOM,
  type WidgetHit,
} from '../utils/widget-hit';
import { widgetKey } from '../utils/widget-values';
import { stepEntityCursor } from '../utils/entity-cursor';
import { WidgetEditOverlay } from './widget-edit-overlay';
import { WidgetA11yMirror } from './widget-a11y-mirror';
import { validateConnection, isSocketCompatible } from '../utils/connections';
import { boundsFromCorners } from '../core/spatial';
import { CanvasErrorBoundary } from './error-boundary';
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
} from '../types';
import * as THREE from 'three';
import { topmostEntityId } from '../utils/entity-depth';
import { locksAspectByDefault } from '../utils/entity-kind';

/**
 * The defaults for the three props whose IDENTITY is a dependency downstream.
 *
 * A default parameter is evaluated on every call, so `socketTypes = {}` in the signature handed
 * every consumer who omitted the prop a brand-new object on every render. That fed
 * `resolveSocketTypes`'s useMemo, which therefore missed every time and produced a new resolved
 * map, which was `FlowSync`'s prop, whose edge effect lists it as a dependency — so every render
 * of the consumer's tree re-ran that effect and called `setEdges` with edges that had not
 * changed. `setEdges` rebuilds `connectedSockets` and the adjacency index over every edge and
 * bumps `topologyVersion`, which marks every GL layer dirty; the next frame retessellated every
 * edge and rebuilt every socket and widget instance buffer. Several milliseconds and a multi-
 * megabyte buffer upload, to arrive at the graph that was already on screen.
 *
 * Module scope fixes it because there is exactly one of each object for the life of the module,
 * so a consumer who omits the prop pins the memo instead of defeating it. A consumer who passes
 * a fresh literal every render still churns — that is theirs to hold stable, and it is the same
 * contract every other config prop in this package keeps.
 */
const NO_SOCKET_TYPES: Record<string, SocketType> = {};
const NO_ENTITY_TYPES: NonNullable<KookieFlowProps['entityTypes']> = {};
const DEFAULT_SNAP_GRID: [number, number] = [20, 20];

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
    entityTypes = NO_ENTITY_TYPES,
    socketTypes = NO_SOCKET_TYPES,
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
    font = 'inter',
    showSocketLabels = true,
    showEdgeLabels = true,
    snapToGrid = false,
    snapGrid = DEFAULT_SNAP_GRID,
    defaultEdgeType = 'bezier',
    maxImageTextureSize,
    connectionMode = 'loose',
    isValidConnection,
    allowCycles = true,
    className,
    ariaLabel,
    children,
    // Styling props (Milestone 2)
    size = '2',
    variant = 'surface',
    radius,
    header = 'inside',
    accentHeader = false,
    entityStyle,
    // Widget props (Phase 7D)
    widgetTypes,
    onWidgetChange,
    showWidgets = true,
    ThemeComponent,
    defaultEntityWidth,
    socketLabelWidth,
    // Evaluation (Phase 8.5)
    onEvaluate,
    onStatusChange,
  },
  ref
) {
  // Memoised for its IDENTITY, not for the cost of the spread — see NO_SOCKET_TYPES above for
  // what a fresh object here bought downstream.
  const resolvedSocketTypes = useMemo(
    () => ({ ...DEFAULT_SOCKET_TYPES, ...socketTypes }),
    [socketTypes]
  );

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
            ariaLabel={ariaLabel}
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
            showSocketLabels={showSocketLabels}
            showEdgeLabels={showEdgeLabels}
            entityTypes={entityTypes}
            onEvaluate={onEvaluate}
            onStatusChange={onStatusChange}
            showMinimap={showMinimap}
            minimapProps={minimapProps}
            widgetTypes={widgetTypes}
            onWidgetChange={onWidgetChange}
            showWidgets={showWidgets}
            ThemeComponent={ThemeComponent}
            defaultEntityWidth={defaultEntityWidth}
            socketLabelWidth={socketLabelWidth}
            maxImageTextureSize={maxImageTextureSize}
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
  ariaLabel?: string;
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
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  entityTypes: KookieFlowProps['entityTypes'];
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
  maxImageTextureSize?: number;
  // Evaluation (Phase 8.5)
  onEvaluate?: KookieFlowProps['onEvaluate'];
  onStatusChange?: KookieFlowProps['onStatusChange'];
}

const ThemedFlowContainer = forwardRef<KookieFlowInstance, ThemedFlowContainerProps>(
  function ThemedFlowContainer(
    {
      entities,
      edges,
      defaultViewport,
      className,
      ariaLabel,
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
      showSocketLabels,
      showEdgeLabels,
      entityTypes,
      showMinimap,
      minimapProps,
      children,
      widgetTypes,
      onWidgetChange,
      showWidgets,
      ThemeComponent,
      defaultEntityWidth,
      socketLabelWidth,
      maxImageTextureSize,
      onEvaluate,
      onStatusChange,
    },
    ref
  ) {
    const tokens = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    // Handed to the store at construction so its FIRST quadtree build uses the real socket row
    // heights. Without it that build ran on defaults — wrong entity heights, wrong bounds — and
    // then the mount effect below threw both quadtrees away and rebuilt them from the resolved
    // layout, so every mount paid for two full builds and the first one was wrong anyway.
    const containerSocketLayout = useSocketLayout();

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
      // v2 name first, v1 name as the fallback arm, and the literal last.
      //
      // A CSS `var()` chain is right HERE and wrong in the token reader, and the difference is
      // worth stating because the two look identical: this is a real declaration the browser
      // resolves, where the reader hands a string to `getPropertyValue`, which takes a property
      // NAME and returns '' for an expression.
      //
      // The literal was `#191919` — near-black — so under a design system that defines neither
      // name this painted a dark canvas into a light app, silently. It is the light value now,
      // because an un-themed page is a light page; a consumer wanting dark states a theme.
      //
      //
      // This is the LIGHT half of THEME_COLORS.canvas.background and it is deliberately the only
      // half rendered here: the token reader detects the appearance from the DOM in a state
      // initialiser, so the server (which has no DOM) says one thing and the client another, and
      // an appearance-dependent style attribute is a hydration mismatch on every dark page. The
      // dark half is written by the layout effect below, after hydration and before paint.
      backgroundColor: 'var(--neutral-2, var(--gray-2, #f9f9f9))',
    };

    // The dark half of the canvas pair. In dark the canvas is the floor (`--neutral-1`) and a card
    // floats a step above it; in light it sits a step below the white card. Every GL reader
    // resolves the same pair (resolveColor), so the DOM ground and the GL ground agree — and the
    // socket punch ring, which paints the canvas colour, is invisible against it.
    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      el.style.backgroundColor =
        tokens.appearance === 'dark'
          ? 'var(--neutral-1, var(--gray-1, #111111))'
          : 'var(--neutral-2, var(--gray-2, #f9f9f9))';
    }, [tokens.appearance]);

    return (
      <div ref={containerRef} className={className} style={containerStyle}>
        <FlowProvider
          initialState={{
            entities,
            edges,
            entityTypes,
            viewport: defaultViewport,
            socketLayout: containerSocketLayout,
          }}
        >
          <FlowInstanceHandle
            ref={ref}
            containerRef={containerRef}
            minZoom={minZoom}
            maxZoom={maxZoom}
            onEvaluate={onEvaluate}
            onStatusChange={onStatusChange}
            entityTypes={entityTypes}
          />
          <InputHandler
            showWidgets={showWidgets}
            onWidgetChange={onWidgetChange}
            widgetTypes={widgetTypes}
            ariaLabel={ariaLabel}
            defaultEntityWidth={defaultEntityWidth}
            socketLabelWidth={socketLabelWidth}
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
              showWidgets={showWidgets}
              defaultEntityWidth={defaultEntityWidth}
              socketLabelWidth={socketLabelWidth}
              defaultEdgeType={defaultEdgeType}
              socketTypes={resolvedSocketTypes}
              showSocketLabels={showSocketLabels}
              showEdgeLabels={showEdgeLabels}
              maxImageTextureSize={maxImageTextureSize}
              onEntitiesChange={onEntitiesChange}
            />
            <DOMLayer
              entityTypes={entityTypes}
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
            <FlowSync entities={entities} edges={edges} socketTypes={resolvedSocketTypes} />
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
  // Evaluation (Phase 8.5): handed to the store here because this is the component that
  // already lives inside FlowProvider and owns the instance API the triggers hang off.
  onEvaluate?: KookieFlowProps['onEvaluate'];
  onStatusChange?: KookieFlowProps['onStatusChange'];
  entityTypes?: KookieFlowProps['entityTypes'];
}

const FlowInstanceHandle = forwardRef<KookieFlowInstance, FlowInstanceHandleProps>(
  function FlowInstanceHandle(
    { containerRef, minZoom, maxZoom, onEvaluate, onStatusChange, entityTypes }, ref) {
    const store = useFlowStoreApi();

    // The engine keeps its records across handler changes; only the callbacks are replaced.
    // Disposal is separate and unconditional: every run in flight is aborted and every
    // success-hold timer dropped when the flow unmounts.
    useEffect(() => {
      store.getState().setEvaluationHandlers(onEvaluate, onStatusChange);
    }, [store, onEvaluate, onStatusChange]);
    /**
     * The type table reaches the store separately, because it decides more than evaluation: it
     * fills in the sockets, size and label of every node that states none. This effect runs
     * before the entity sync below it, and the store is built with the table in hand anyway, so
     * the first frame is already resolved.
     */
    useEffect(() => {
      store.getState().setEntityTypes(entityTypes ?? NO_ENTITY_TYPES);
    }, [store, entityTypes]);
    useEffect(() => () => { store.getState().disposeEvaluation(); }, [store]);

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

        /** The graph as data, ready to save. See `FlowObject`. */
        toObject: () => store.getState().toObject(),

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

        // ---- Evaluation (Phase 8.5) ----
        evaluate: (entityId) => store.getState().evaluate(entityId),
        evaluateDirty: () => store.getState().evaluateDirty(),
        evaluateAll: () => store.getState().evaluateAll(),
        setSocketValue: (entityId, socketId, value) =>
          store.getState().setSocketValue(entityId, socketId, value),
        getSocketValue: (entityId, socketId) => store.getState().getSocketValue(entityId, socketId),
        getEvaluationStatus: (entityId) => store.getState().getEvaluationStatus(entityId),

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
  /**
   * Widget interaction lives in this component, because a press on a widget has to beat the
   * entity drag that would otherwise start under it — and that ordering only exists here.
   */
  showWidgets: boolean;
  onWidgetChange?: KookieFlowProps['onWidgetChange'];
  /**
   * Read only to know which widget TYPES a consumer has replaced with their own component.
   * Those already mount a real named control in widgets-layer.tsx, so the accessibility mirror
   * must not mount a second one beside them — see utils/widget-mirror.ts.
   */
  widgetTypes?: KookieFlowProps['widgetTypes'];
  defaultEntityWidth?: number;
  socketLabelWidth?: number;
  /** The accessible name of the graph. See KookieFlowProps.ariaLabel. */
  ariaLabel?: string;
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

/**
 * The clip-rect pattern, for the one static sentence that describes the graph's keyboard model.
 *
 * Clipped rather than `display: none` on purpose. An `aria-describedby` target is read even when
 * it is display-none in most engines, but "most" is not a contract, and the same file's mirror
 * depends on the distinction absolutely — keeping one spelling of "hidden but present" is worth
 * more than saving four declarations here.
 */
const SR_ONLY_TEXT: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

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
  showWidgets,
  onWidgetChange,
  widgetTypes,
  ariaLabel = 'Flow graph',
  defaultEntityWidth,
  socketLabelWidth,
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

  /**
   * The widget being dragged, and the widget being edited.
   *
   * The DRAG is a ref: a slider moves on every pointermove, and a React re-render per frame is the
   * one thing this codebase's rules forbid outright. The EDIT is state, because a borrowed DOM
   * input is a mounted element — that happens once per edit, not once per frame, which is exactly
   * what React state is for.
   *
   * The drag carries the POINTER that started it. Without it every branch below answered any
   * pointer at all: a second finger put down anywhere on the canvas drove the slider the first
   * finger was holding — its pointermoves reach the drag branch before anything else — while a
   * pinch-zoom ran at the same time, and lifting either finger ended the drag while the other was
   * still down. A gesture belongs to the pointer that began it.
   */
  const widgetDragRef = useRef<{ hit: WidgetHit; pointerId: number } | null>(null);
  const [widgetEdit, setWidgetEdit] = useState<WidgetHit | null>(null);

  /**
   * THE KEYBOARD CURSOR, mirrored out of the store so the accessibility mirror can mount for it.
   *
   * React state, and that is the whole budget: this changes when someone presses a node or moves
   * the cursor with an arrow key — once per event, never per frame — and what it changes is which
   * DOM elements exist, which is exactly what React state is for. It is deliberately NOT
   * `selectedEntityIds`: Ctrl+A selects a thousand nodes and would commit a thousand nodes' worth
   * of hidden controls, which is the bound the mirror's whole argument rests on. See
   * components/widget-a11y-mirror.tsx and store.ts `focusedEntityId`.
   */
  const [focusedEntityId, setFocusedEntityIdState] = useState<string | null>(
    () => store.getState().focusedEntityId
  );
  useEffect(
    () => store.subscribe((state) => state.focusedEntityId, setFocusedEntityIdState),
    [store]
  );

  /**
   * The id the container's `aria-describedby` points at.
   *
   * Through `useId` rather than a constant, because two graphs on one page would otherwise both
   * describe themselves with the first one's instructions node.
   */
  const instructionsId = useId();

  /**
   * A select press is answered on pointer UP, and that is not fussiness.
   *
   * The borrowed `<select>` opens its list programmatically as soon as it is mounted and focused.
   * Open it while the button is still down and the release goes straight into the popup: the
   * platform opens the list with the CURRENT option under the cursor, so the mouseup picks that
   * same option and shuts the list again. The press reads as a flash and nothing changes.
   *
   * Held here between the two halves of one press. A ref because nothing renders from it, and it
   * carries its POINTER for the reason `widgetDragRef` above carries one: a second finger's
   * release must not answer the first finger's press.
   */
  const pendingSelectRef = useRef<{
    hit: WidgetHit;
    pointerId: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  /**
   * Open or close a widget edit, in ONE place, because two things have to move together.
   *
   * The borrowed input is React state here; the GL text layer needs the same fact in the store, so
   * it can stop printing glyphs for the widget the input is sitting on. Keeping them in step at
   * each call site is how they drift — a path that closed the editor without clearing the key
   * would suppress that widget's value for the rest of the session.
   */
  const openWidgetEdit = useCallback(
    (hit: WidgetHit | null) => {
      setWidgetEdit(hit);
      store.getState().setEditingWidgetKey(hit ? widgetKey(hit.entityId, hit.socketId) : null);
    },
    [store]
  );
  const onWidgetChangeRef = useRef(onWidgetChange);
  onWidgetChangeRef.current = onWidgetChange;

  /**
   * What the entity cursor needs that is not in the store, read through a ref.
   *
   * The window key listeners register ONCE for the life of the component, on purpose — the effect
   * below says so. Naming `socketLayout` or a prop in their dependency list would re-register them
   * every time the resolved style changed, which is the churn that comment exists to prevent.
   * Written during render, exactly as `onWidgetChangeRef` above is.
   */
  const cursorDepsRef = useRef({ socketLayout, defaultEntityWidth });
  cursorDepsRef.current.socketLayout = socketLayout;
  cursorDepsRef.current.defaultEntityWidth = defaultEntityWidth;
  /**
   * Every widget change leaves through here, and the order of the two lines is the point: the
   * store records what the person set FIRST, so the GL layer paints it on the next frame whether
   * or not the consumer echoes it back — the DOM widgets kept the same promise with a `useState`
   * per widget. Stable, so the drag branch below can hold it in a ref.
   */
  const emitWidgetChange = useCallback(
    (entityId: string, socketId: string, value: unknown) => {
      store.getState().setWidgetValue(entityId, socketId, value);
      onWidgetChangeRef.current?.(entityId, socketId, value);
    },
    [store]
  );

  /**
   * An open field closes when its entity goes away.
   *
   * The overlay snapshots the widget's world box at press time and follows the viewport from
   * there; it never re-derives from the entity, so it has no way of noticing the entity is gone.
   * Nothing else was watching either — the edit was opened on press and closed on blur, and a
   * removal that does not blur the input (a consumer-driven change from a live source, an undo, a
   * programmatic delete) left a focused input floating over empty canvas, still writing values
   * for an id nothing holds.
   *
   * Subscribed rather than derived because `entityMap` changes on a store transition, not on a
   * React render, and this component does not re-render when entities change. It costs one Map
   * lookup per entity write, and only while a field is actually open.
   */
  useEffect(() => {
    if (!widgetEdit) return;
    const entityId = widgetEdit.entityId;
    // Through `openWidgetEdit`, not `setWidgetEdit`: closing the editor without clearing the
    // store's key would leave the GL text layer suppressing a widget that no longer has an input
    // over it — and for a removed entity, forever.
    if (!store.getState().entityMap.has(entityId)) {
      openWidgetEdit(null);
      return;
    }
    return store.subscribe(
      (s) => s.entityMap,
      (entityMap) => {
        if (!entityMap.has(entityId)) openWidgetEdit(null);
      }
    );
  }, [store, widgetEdit, openWidgetEdit]);

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
    aspectRatio: number;
    initialCenter: { x: number; y: number };
  } | null>(null);
  // Tracks which resize handle (if any) is hovered for cursor changes.
  // Ref for comparison in handlePointerMove (avoids recreating the callback on every handle change).
  // State for cursor rendering (triggers re-render only on null↔handle transitions).
  const hoveredHandleRef = useRef<ResizeHandle | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle | null>(null);

  /**
   * The pointer cursor over a widget, written to the element rather than rendered.
   *
   * Every other cursor on this container comes out of the ternary in the style object below, which
   * means a React render — and the resize-handle branch immediately above pays for that with a
   * `setState` on every null-to-handle transition, re-rendering a component this size. A resize
   * handle is a rare target; a widget is not. On a node with six controls, sweeping the pointer
   * across the row would have been six renders of the entire canvas in one gesture, which is the
   * first rule of this package.
   *
   * So the widget cursor is one `style.cursor` write on a ref, guarded on the transition. The base
   * cursor is mirrored into a ref so this can put it back on leave, and the effect beside the
   * render re-applies the winner after any render that CHANGED the base — the only moment React
   * would overwrite an imperative write, since its style diff leaves keys it did not touch alone.
   */
  const baseCursorRef = useRef('default');
  const widgetCursorRef = useRef(false);
  /**
   * The widget's pointer wins only over `default`.
   *
   * Every other base cursor names a mode that is either running or armed — grabbing a node,
   * holding space to pan, a marquee, a connection, a resize handle, an open text caret — and a
   * widget sitting under the pointer does not outrank any of them. Without the check, holding
   * space with the pointer resting on a slider showed a pointer where the grab hand belongs.
   */
  const applyCursor = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const base = baseCursorRef.current;
    el.style.cursor = widgetCursorRef.current && base === 'default' ? 'pointer' : base;
  }, []);
  const setWidgetCursor = useCallback(
    (wantPointer: boolean) => {
      if (wantPointer === widgetCursorRef.current) return;
      widgetCursorRef.current = wantPointer;
      applyCursor();
    },
    [applyCursor]
  );

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

    // `dragState.current` is the live signal and is already the condition; the React boolean that
    // used to sit beside it was captured when this callback was created, which is BEFORE the
    // drag-start render commits. So the first frame of every drag read `isDragging === false`,
    // set `active = false` and returned. Frames after that worked, because the committed render
    // hands the pointermove handler a fresh closure — which is why this reads as an intermittent
    // failure rather than a dead feature: it bites when the threshold crossing, the entry into the
    // edge band and the pointer stopping all land on one event.
    if (!dragState.current || !autoScrollRef.current.lastScreenPos) {
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
  }, [snapToGrid, snapGrid, store]);

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

    // Update on resize — size changes can also shift position (e.g. Theme wrapper)
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        cachedRectRef.current.width = entry.contentRect.width;
        cachedRectRef.current.height = entry.contentRect.height;
        // Position may shift when size changes, so update left/top too
        const r = container.getBoundingClientRect();
        cachedRectRef.current.left = r.left;
        cachedRectRef.current.top = r.top;
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
      case 'video':
        return { minWidth: MIN_VIDEO_WIDTH, minHeight: MIN_VIDEO_HEIGHT };
      case 'mesh':
        return { minWidth: MIN_MESH_WIDTH, minHeight: MIN_MESH_HEIGHT };
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
      // Any new press abandons a select press that never reached its release — a pointer whose up
      // event was eaten by a resize gesture, or by the OS. Cleared here rather than beside
      // `hasDragged` below because several branches return before reaching that line.
      pendingSelectRef.current = null;
      // Focus the canvas on any press. The keydown gate above asks whether this element has focus,
      // and clicking a tabindex=0 div only focuses it by browser convention — which `preventDefault`
      // on a middle-click press already breaks. Stating it here makes the gate's precondition
      // something this component guarantees rather than something it hopes for.
      if (document.activeElement !== containerRef.current) {
        containerRef.current.focus({ preventScroll: true });
      }
      // Refresh cached position on interaction start (not a hot path)
      // This catches cases where layout shifted after mount (e.g. sidebar animation, Theme wrapper)
      const freshRect = containerRef.current.getBoundingClientRect();
      cachedRectRef.current.left = freshRect.left;
      cachedRectRef.current.top = freshRect.top;
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
        const { viewport, socketQuadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket click first — O(log n) via spatial index
        const socket = getSocketAtPositionFast(
          worldPos,
          socketQuadtree,
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
              aspectRatio: h > 0 ? w / h : 1,
              initialCenter: { x: entity.position.x + w / 2, y: entity.position.y + h / 2 },
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
          entityMap.get(topmostEntityId(queryResultsRef.current, store.getState().stackOrder) ?? '') ?? null;

        /**
         * A widget takes the press before the entity does.
         *
         * Checked here rather than earlier because a widget only exists ON an entity, so the
         * quadtree has already narrowed the search to one — and checked before the drag branch
         * below because otherwise every slider drag would move the node instead of the value.
         *
         * A checkbox and a slider are answered entirely in GL, with no DOM at any moment. The
         * other four borrow a real input for the duration of one edit, which is the rule this
         * whole layer exists to satisfy.
         *
         * Gated on the same zoom the renderer paints at: below MIN_WIDGET_ZOOM there is no widget
         * chrome on screen, and a press that lands in an invisible control is worse than a press
         * that does nothing — see the constant.
         */
        if (clickedEntity && showWidgets && viewport.zoom >= MIN_WIDGET_ZOOM) {
          const hit = getWidgetAt(
            clickedEntity,
            worldPos.x,
            worldPos.y,
            socketTypes,
            socketLayout,
            store.getState().connectedSockets,
            store.getState().widgetValues,
            defaultEntityWidth,
            socketLabelWidth
          );
          if (hit) {
            e.preventDefault();
            // A press on a widget is not a click on the entity. Pointerup's click-to-select reads
            // `pointerDownPos`, which was set above — left set, pressing a field selected the
            // node, and the selected node's foreground body then painted over its own widgets.
            pointerDownPos.current = null;
            // Last interacted on top — a press on a widget is a press on its node.
            store.getState().bringToFront(clickedEntity.id);
            // The keyboard cursor follows the pointer, so a pointer user and a keyboard user
            // share one notion of where they are — and so the mirror a screen reader lands on
            // after a click is the node that was clicked, not wherever the cursor was left.
            store.getState().setFocusedEntityId(clickedEntity.id);
            if (hit.config.type === 'checkbox') {
              emitWidgetChange(hit.entityId, hit.socketId, !hit.value);
              return;
            }
            if (hit.config.type === 'slider') {
              // Lit for the length of the gesture. The hover block in the move handler is skipped
              // entirely while a pointer is down, so without this the grip goes cold the instant
              // the drag it is responding to begins — the one gesture here with any duration, and
              // the one that most needs to say it is being answered.
              store.getState().setHoveredWidget({ entityId: hit.entityId, socketId: hit.socketId });
              // Pressed, not merely hovered: the thumb wears its halo for the whole drag.
              store.getState().setPressedWidgetKey(`${hit.entityId}:${hit.socketId}`);
              setWidgetCursor(true);
              widgetDragRef.current = { hit, pointerId: e.pointerId };
              containerRef.current?.setPointerCapture(e.pointerId);
              emitWidgetChange(hit.entityId, hit.socketId, sliderValueAt(hit, worldPos.x));
              return;
            }
            if (hit.config.type === 'select') {
              // Answered on the release — see `pendingSelectRef`. Nothing to choose from means
              // nothing to open: an empty list would be a popup with no rows in it, so the value
              // is left exactly as it is.
              if (hit.config.options && hit.config.options.length > 0) {
                pendingSelectRef.current = {
                  hit,
                  pointerId: e.pointerId,
                  screenX: e.clientX,
                  screenY: e.clientY,
                };
              }
              return;
            }
            // text, number, textarea, color — a borrowed DOM input, for this edit only.
            openWidgetEdit(hit);
            return;
          }
        }

        if (clickedEntity) {
          const editingId = store.getState().editingEntityId;

          if (editingId === clickedEntity.id && clickedEntity.type === 'text') {
            // Clicking on the entity being edited — set up drag-to-select anchor
            suppressEditBlur();
            const data = clickedEntity.data as TextEntityData;
            const font = resolveFontForWeight(fontContext, data.fontWeight ?? 400);
            if (font && font.glyphMap.size > 0) {
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
                font.metrics, font.glyphMap, font.kerningMap, letterSp
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

            // Last interacted on top. Done on press rather than on selection, because the
            // stacking order is what survives a deselect — see utils/entity-depth.ts.
            store.getState().bringToFront(clickedEntity.id);
            // And the keyboard cursor moves with it — see the widget branch above.
            store.getState().setFocusedEntityId(clickedEntity.id);

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
    [isSpaceDown, store, socketLayout, onConnectStart, getResizeHandleAt, getMinSize, setWidgetCursor]
  );

  // Handle pointer move
  // IMPORTANT: Use refs and store state (synchronous) for checks instead of React state
  // (which is batched). This prevents issues when events fire before React processes state updates.
  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      /**
       * A slider drag, before anything else in this handler.
       *
       * First because it is the only branch that owns the pointer outright — a drag that started
       * on a slider is a drag on that slider until the button comes up, and every branch below
       * would otherwise get a chance to pan, marquee or move a node underneath it.
       *
       * No React state, by design: this runs on every pointermove for the length of the gesture,
       * and the value goes straight out through the consumer's callback.
       */
      const widgetDrag = widgetDragRef.current;
      if (widgetDrag && widgetDrag.pointerId === e.pointerId) {
        /**
         * The button has to still be down. This branch returns unconditionally and sits above the
         * safety-cleanup block below, so the one net that catches a missed pointerup could never
         * reach it: a `pointercancel` — the OS taking a touch gesture, palm rejection, a
         * notification — cleared nothing, and from then on every bare pointermove over the canvas,
         * with no button at all, wrote a new slider value and returned. Panning, marquee select,
         * node dragging and connections were all dead until the component unmounted.
         */
        if ((e.buttons & 1) === 0) {
          widgetDragRef.current = null;
          // Fall through: the safety cleanup below handles whatever else this stale gesture left.
        } else {
          const { hit } = widgetDrag;
          const rect = cachedRectRef.current;
          const { viewport } = store.getState();
          const world = screenToWorld(
            { x: e.clientX - rect.left, y: e.clientY - rect.top },
            viewport
          );
          emitWidgetChange(hit.entityId, hit.socketId, sliderValueAt(hit, world.x));
          return;
        }
      }

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
          lastPointerPos.current ||
          // A slider drag whose pointer never sent another move of its own — the branch above only
          // clears the one it belongs to, and this net is meant to catch every stuck gesture.
          widgetDragRef.current
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
          widgetDragRef.current = null;
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
        const { viewport, entityMap, socketQuadtree: connSocketQuadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check for socket hover during connection — O(log n) via spatial index
        const hoveredSocket = getSocketAtPositionFast(
          worldPos,
          connSocketQuadtree,
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

        // Alt = resize from center: double deltas so the handle stays under the cursor
        const altResize = e.altKey;
        if (altResize) {
          dx *= 2;
          dy *= 2;
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

        // Aspect ratio lock:
        // - Media (image, video, mesh): locked by default (Shift to unlock)
        // - Others: unlocked by default (Shift to lock)
        const resizedEnt = store.getState().entityMap.get(rs.entityId);
        const lockAspect = locksAspectByDefault(resizedEnt) ? !e.shiftKey : e.shiftKey;

        if (lockAspect) {
          const ar = rs.aspectRatio;
          if (h === 'e' || h === 'w') {
            newH = newW / ar;
          } else if (h === 'n' || h === 's') {
            newW = newH * ar;
          } else {
            // Corner: project delta onto aspect-ratio diagonal for smooth resize.
            // Avoids jank from axis-dominance flipping when mouse direction changes.
            const iw = rs.initialBounds.width;
            const ih = rs.initialBounds.height;
            const sx = (h === 'se' || h === 'ne') ? 1 : -1;
            const sy = (h === 'se' || h === 'sw') ? 1 : -1;
            const diagSq = iw * iw + ih * ih;
            const t = (dx * sx * iw + dy * sy * ih) / diagSq;
            newW = iw + t * iw;
            newH = ih + t * ih;
          }
          // Recompute origin for handles that move it
          if (h === 'w' || h === 'nw' || h === 'sw') {
            newX = rs.initialBounds.x + rs.initialBounds.width - newW;
          }
          if (h === 'n' || h === 'ne' || h === 'nw') {
            newY = rs.initialBounds.y + rs.initialBounds.height - newH;
          }
        }

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

        // Re-enforce ratio after min-size clamping
        if (lockAspect) {
          if (newW <= rs.minWidth) {
            newW = rs.minWidth;
            newH = newW / rs.aspectRatio;
          }
          if (newH <= rs.minHeight) {
            newH = rs.minHeight;
            newW = newH * rs.aspectRatio;
          }
        }

        // Text entities: mode-aware resize
        if (resizedEnt?.type === 'text' && !lockAspect) {
          const data = resizedEnt.data as TextEntityData;
          const sizingMode = data.sizingMode ?? 'auto-height';
          // auto-width: resizable=false, so this branch won't execute for auto-width
          if (sizingMode === 'auto-height') {
            const style = resolveTextStyle(data);
            const resizeFont = resolveFontForWeight(fontContext, data.fontWeight ?? 400);
            if (resizeFont && resizeFont.glyphMap.size > 0) {
              newH = calculateTextAutoHeightMSDF(
                data.content, style, newW,
                resizeFont.metrics.info.size, resizeFont.glyphMap, resizeFont.kerningMap
              );
            } else {
              newH = style.fontSize * style.lineHeight + 2 * style.padding;
            }
          }
          // fixed: both newW and newH are user-controlled (no override)
        }

        // Alt = resize from center: reposition so entity stays centered
        if (altResize) {
          newX = rs.initialCenter.x - newW / 2;
          newY = rs.initialCenter.y - newH / 2;
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
            entityMap.get(topmostEntityId(queryResultsRef.current, store.getState().stackOrder) ?? '') ?? null;

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
        const { viewport, hoveredEntityId, quadtree, socketQuadtree: hoverSocketQuadtree } = store.getState();
        const worldPos = screenToWorld({ x: screenX, y: screenY }, viewport);

        // Check resize handle hover first (for cursor feedback)
        const handleHit = getResizeHandleAt(worldPos.x, worldPos.y);
        const newHandle = handleHit?.handle ?? null;
        if (newHandle !== hoveredHandleRef.current) {
          hoveredHandleRef.current = newHandle;
          setHoveredHandle(newHandle);
        }

        // Check socket hover first — O(log n) via spatial index
        const newHoveredSocket = getSocketAtPositionFast(
          worldPos,
          hoverSocketQuadtree,
          socketLayout
        );

        // Unconditional: `setHoveredSocketId` dedupes by value, on all three fields. The guard
        // that stood here compared entityId and socketId only, so it short-circuited before the
        // store could see a move between an input and an output sharing a socket id — and being
        // the earlier of the two guards, it would have kept doing so after the store gained one.
        store.getState().setHoveredSocketId(newHoveredSocket);

        // Use quadtree for O(log n) hit testing for entities
        // Clear and reuse pre-allocated array to avoid GC
        queryResultsRef.current.length = 0;
        quadtree.queryPoint(worldPos.x, worldPos.y, queryResultsRef.current);
        // A resize handle straddles the corner, so half its hit disc lies outside the entity's
        // bounds — where the quadtree says nothing is hovered and the corner dots would vanish
        // under a resize cursor. A handle hit counts as hovering its entity.
        const newHoveredId =
          handleHit?.entityId ?? topmostEntityId(queryResultsRef.current, store.getState().stackOrder);

        // Only update if changed to avoid unnecessary re-renders
        if (newHoveredId !== hoveredEntityId) {
          store.getState().setHoveredEntityId(newHoveredId);
        }

        /**
         * Which widget the pointer is on — the thing that makes a control look like a control
         * before it is pressed.
         *
         * GATED ON THE QUADTREE RESULT, which is the whole reason this is affordable. A widget
         * only exists ON an entity, so there is nothing to test until the index has already named
         * one; over empty canvas — most of a pan across a large graph — this is a null check and
         * stops. When an entity IS under the pointer it is a loop over that one entity's input
         * sockets against a WeakMap-cached layout, writing into a scratch rectangle, so it
         * allocates nothing on a miss and one small handle on an enter.
         *
         * Socket hover wins where the two could overlap: a socket dot is the smaller target and
         * it starts a connection, which is the more consequential gesture.
         *
         * Gated on the zoom the renderer paints at, for the reason MIN_WIDGET_ZOOM states — a
         * cursor that promises a control nothing on screen shows is the same lie as a press that
         * lands on one.
         *
         * This whole block is already skipped during a press: it sits inside `!pointerDownPos`,
         * and a slider drag returns long before reaching it. That is deliberate — a slider stays
         * lit under the finger because pointerdown set the handle and nothing here clears it.
         */
        let hoveredWidgetSocketId: string | null = null;
        if (
          showWidgets &&
          newHoveredId !== null &&
          newHoveredSocket === null &&
          viewport.zoom >= MIN_WIDGET_ZOOM
        ) {
          const hoveredEntity = store.getState().entityMap.get(newHoveredId);
          if (hoveredEntity) {
            hoveredWidgetSocketId = getWidgetSocketIdAt(
              hoveredEntity,
              worldPos.x,
              worldPos.y,
              socketTypes,
              socketLayout,
              store.getState().connectedSockets,
              defaultEntityWidth,
              socketLabelWidth
            );
          }
        }
        // Unconditional, like the socket line above it: the store dedupes by value, so a pointer
        // resting on one widget notifies nobody after the first move.
        store.getState().setHoveredWidget(
          hoveredWidgetSocketId === null || newHoveredId === null
            ? null
            : { entityId: newHoveredId, socketId: hoveredWidgetSocketId }
        );
        setWidgetCursor(hoveredWidgetSocketId !== null);
      }
    },
    [snapToGrid, snapGrid, socketTypes, allowCycles, store, updateViewport, runAutoScroll, socketLayout, getResizeHandleAt, showWidgets, defaultEntityWidth, socketLabelWidth, setWidgetCursor]
  );

  // Handle pointer up
  // IMPORTANT: Use refs and store state (synchronous) for cleanup checks instead of React state
  // (which is batched). This prevents state from getting stuck when onPointerLeave fires
  // before React has processed the state updates from handlePointerMove.
  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      // A slider drag ends here and nowhere else. Released first so a gesture that started on a
      // widget cannot fall through into the selection logic below and clear the selection.
      //
      // Only its OWN pointer ends it. This used to end on whichever pointer happened to come up,
      // and released capture for that one too — so on a touch device, lifting a second finger
      // ended a slider drag the first finger was still holding, and handed the release to a
      // pointer the container had never captured.
      if (widgetDragRef.current && widgetDragRef.current.pointerId === e.pointerId) {
        const releasedDrag = widgetDragRef.current;
        widgetDragRef.current = null;
        store.getState().setPressedWidgetKey(null);
        containerRef.current?.releasePointerCapture(e.pointerId);
        // A slider drag travels well past its own box — the value clamps, the pointer does not —
        // so the release decides whether the grip stays lit. Asked here rather than left to the
        // next pointermove, because a person who releases and does not move the mouse again would
        // otherwise be looking at a lit control they are no longer touching.
        const rect = cachedRectRef.current;
        const { viewport } = store.getState();
        const releaseWorld = screenToWorld(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          viewport
        );
        const stillOn = isPointInWidget(releasedDrag.hit.box, releaseWorld.x, releaseWorld.y);
        store.getState().setHoveredWidget(
          stillOn ? { entityId: releasedDrag.hit.entityId, socketId: releasedDrag.hit.socketId } : null
        );
        setWidgetCursor(stillOn);
        return;
      }

      /**
       * The second half of a select press — see `pendingSelectRef`. Mounting here means the list
       * opens against a pointer that is already up.
       *
       * This handler is also bound to `pointercancel` and `pointerleave`, and neither of those is
       * a choice: a gesture the OS took away, or one that wandered off the canvas, has to clear
       * the pending press WITHOUT opening anything. So the open is gated on the event actually
       * being a release, and on the release landing near where the press did — a press that
       * travelled was someone starting a drag on a node, not someone picking an option.
       */
      const pendingSelect = pendingSelectRef.current;
      if (pendingSelect && pendingSelect.pointerId === e.pointerId) {
        pendingSelectRef.current = null;
        const travelled =
          Math.abs(e.clientX - pendingSelect.screenX) + Math.abs(e.clientY - pendingSelect.screenY);
        if (e.type === 'pointerup' && travelled <= DRAG_THRESHOLD) openWidgetEdit(pendingSelect.hit);
        // Returned whether or not it opened, for the reason the drag branch above returns: a
        // gesture that began on a widget must not fall through into the selection logic below.
        return;
      }

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
          entityMap.get(topmostEntityId(queryResultsRef.current, store.getState().stackOrder) ?? '') ?? null;

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

          // Already editing this text entity — handle click/multi-click
          if (
            currentEditingId === clickedEntity.id &&
            clickedEntity.type === 'text'
          ) {
            const data = clickedEntity.data as TextEntityData;
            const font = resolveFontForWeight(fontContext, data.fontWeight ?? 400);
            if (font && font.glyphMap.size > 0) {
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
                font.metrics, font.glyphMap, font.kerningMap, letterSp
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
      openWidgetEdit,
      setWidgetCursor,
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

  // Filesystem file-drop: listen on window to avoid DOM/R3F event interception.
  // Check container bounds via cachedRectRef (no layout thrash).
  const onFileDropRef = useRef(onFileDrop);
  onFileDropRef.current = onFileDrop;

  /**
   * Live mirrors of the two change callbacks, for the window keyboard listener.
   *
   * That listener used to name them in its dependency array, which meant the pair of window
   * listeners was torn down and re-registered on every render that produced a new callback
   * identity — and a consumer writing `onEntitiesChange={(c) => ...}` inline produces a new one
   * every render. Refs let the deps hold only stable values, so the listeners register once.
   *
   * Written in an effect rather than in the render body: a ref written during render is the thing
   * the audit files separately as #86, and copying that pattern here would re-commit it.
   */
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  const onEdgesChangeRef = useRef(onEdgesChange);
  useEffect(() => {
    onEntitiesChangeRef.current = onEntitiesChange;
    onEdgesChangeRef.current = onEdgesChange;
  }, [onEntitiesChange, onEdgesChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const inBounds = (e: DragEvent) => {
      const r = cachedRectRef.current;
      return (
        e.clientX >= r.left && e.clientX <= r.left + r.width &&
        e.clientY >= r.top && e.clientY <= r.top + r.height
      );
    };

    const handleDragOver = (e: DragEvent) => {
      if (!onFileDropRef.current || !inBounds(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const handleDrop = (e: DragEvent) => {
      if (!onFileDropRef.current || !e.dataTransfer || !inBounds(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      const rect = cachedRectRef.current;
      const worldPos = screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        store.getState().viewport,
      );
      onFileDropRef.current(files, worldPos);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [store]);

  // Handle keyboard events for space key, Ctrl+A, and Escape
  useEffect(() => {
    /**
     * Pan the cursor's node into view, and only if it is not already there.
     *
     * A keyboard cursor that lands off-camera has moved nothing anyone can see. Centering on
     * EVERY move would be worse — it would yank the viewport for a step to the node already
     * beside the one you were on — so this is a reveal, not a follow: the node is centred only
     * when its box is not comfortably inside the visible rect. One `setViewport` per move that
     * needs one, and nothing per frame.
     */
    const revealEntity = (id: string) => {
      const s = store.getState();
      const entity = s.entityMap.get(id);
      if (!entity) return;
      const { socketLayout: layout, defaultEntityWidth: widthDefault } = cursorDepsRef.current;
      const rect = cachedRectRef.current;
      if (rect.width === 0 || rect.height === 0) return;
      const { viewport } = s;
      const width = entity.width ?? widthDefault ?? DEFAULT_ENTITY_WIDTH;
      const height =
        entity.height ?? (layout ? getEntitySocketLayout(entity, layout).computedHeight : 0);
      const left = entity.position.x * viewport.zoom + viewport.x;
      const top = entity.position.y * viewport.zoom + viewport.y;
      const right = left + width * viewport.zoom;
      const bottom = top + height * viewport.zoom;
      const margin = 24;
      const visible =
        left >= margin &&
        top >= margin &&
        right <= rect.width - margin &&
        bottom <= rect.height - margin;
      if (visible) return;
      const centerX = entity.position.x + width / 2;
      const centerY = entity.position.y + height / 2;
      s.setViewport({
        x: rect.width / 2 - centerX * viewport.zoom,
        y: rect.height / 2 - centerY * viewport.zoom,
        zoom: viewport.zoom,
      });
    };

    const placeCursor = (id: string | null) => {
      if (id === null) return;
      const s = store.getState();
      s.setFocusedEntityId(id);
      // The GL selection ring is the only thing on a canvas that can say where the cursor is.
      s.selectEntity(id);
      revealEntity(id);
    };

    const moveEntityCursor = (direction: 1 | -1) => {
      const s = store.getState();
      placeCursor(
        stepEntityCursor(s.entities, s.focusedEntityId, direction, (id) =>
          s.hiddenEntityIds.has(id)
        )
      );
    };

    /** Home and End: the step taken from nowhere, which is what an end of the order is. */
    const jumpEntityCursor = (direction: 1 | -1) => {
      const s = store.getState();
      placeCursor(
        stepEntityCursor(s.entities, null, direction, (id) => s.hiddenEntityIds.has(id))
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      /**
       * The canvas only answers keys when the canvas is what has focus.
       *
       * This listener is on `window`, and its only guard was a tagName test for INPUT/TEXTAREA.
       * So a host page embedding <KookieFlow> lost five keys EVERYWHERE on the page: a bare `t`
       * with focus on <body> — the state on every page load — created a text entity and opened its
       * editor; Backspace deleted the selection while the user was pressing it on a host button;
       * Ctrl+A selected the graph instead of the page's text; Space scrolled nothing and panned the
       * canvas. The library's own toolbar was affected too, being a descendant.
       *
       * `e.target` on a keydown IS `document.activeElement`, so target equality asks exactly the
       * right question — is the canvas focused — in one place. Containment was the other candidate
       * and is worse: consumer `children` render inside this container, so `contains()` would keep
       * stealing keys from a host's own control panel nested in the canvas, and it would need
       * re-verifying every time the toolbar's markup changed.
       *
       * The tagName test stays as well, because it is not redundant: a focused INPUT that IS the
       * container cannot happen, but the container can hold focus while a composite widget routes
       * typing elsewhere.
       */
      if (e.target !== containerRef.current) return;

      // Skip if typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      /**
       * THE ENTITY CURSOR — the half that makes one tab stop enough.
       *
       * Arrow keys were unused on the canvas, so this claims nothing that already worked. Each
       * move puts the cursor on a node, SELECTS it so the GL selection ring says where the cursor
       * is (there is nothing else on a canvas that can say so), and pans the node into view if it
       * is not already there — a cursor that leaves its target off-camera is useless to a
       * low-vision user, and it is the reason the mirror itself is never positioned over its
       * widget.
       *
       * Enter steps into the focused node's controls. From there the mirror's own handler owns
       * the arrows and Escape hands focus back here; the guard above is what keeps these two
       * keyboards from fighting, since `e.target` is the mirror's input rather than the container
       * for as long as one is focused. Do not widen that guard to `contains()` — the comment on
       * it records exactly why that was rejected.
       */
      if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        moveEntityCursor(1);
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        moveEntityCursor(-1);
        return;
      }
      if (e.code === 'Home' || e.code === 'End') {
        e.preventDefault();
        // First and last in the same reading order the arrows walk: asking for the step out of
        // nowhere is what "the end of the order" means, so there is one implementation of it.
        jumpEntityCursor(e.code === 'Home' ? 1 : -1);
        return;
      }
      if (e.code === 'Enter') {
        // Into the mirror. The first control is queried rather than held in a ref because the
        // mirror is rendered several components away and this is a keypress, not a frame.
        const control = containerRef.current?.querySelector('[data-a11y-mirror]');
        if (control instanceof HTMLElement) {
          e.preventDefault();
          control.focus({ preventScroll: true });
        }
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
        // One read of the store, and the branches test the store's own state rather than React
        // booleans this listener captured when it was registered. `handlePointerUp` already does
        // exactly this a few hundred lines up.
        const s = store.getState();
        if (s.editingEntityId) {
          s.stopEditing();
        } else if (s.connectionDraft) {
          s.cancelConnectionDraft();
          setIsConnecting(false);
        } else if (s.selectionBox) {
          s.setSelectionBox(null);
          setIsBoxSelecting(false);
        } else {
          s.deselectAll();
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
          onEdgesChangeRef.current?.(edgeChanges);
          store.getState().applyEdgeChanges(edgeChanges);
        }

        // Delete selected entities
        if (selectedEntityIds.size > 0) {
          const entityChanges = Array.from(selectedEntityIds).map((id) => ({
            type: 'remove' as const,
            id,
          }));
          onEntitiesChangeRef.current?.(entityChanges);
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

        onEntitiesChangeRef.current?.([{ type: 'add', entity: newEntity }]);
        store.getState().applyEntityChanges([{ type: 'add', entity: newEntity }]);
        store.getState().selectEntity(newEntity.id);
        store.getState().startEditing(newEntity.id);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        // `lastPointerPos.current` is the live mirror of "a pan is in flight"; the React boolean
        // that stood here was captured at registration, so releasing Space could leave the canvas
        // stuck in pan mode.
        if (lastPointerPos.current) {
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
    // `store` is the only value here that can change identity and matter. The three React
    // booleans are gone because the handlers read the store instead, and the two callbacks are
    // read through refs — so these listeners register once for the life of the component rather
    // than on every render that produces a new inline callback.
  }, [store]);

  /*
   * There is deliberately NO onContextMenu here.
   *
   * What stood here suppressed the native menu when `e.button === 1`, and a contextmenu event's
   * `button` is always 2 — so the guard never held and the handler did nothing but describe
   * behaviour the library does not have.
   *
   * Deleting it rather than making it unconditional is the decision: suppressing the browser's own
   * menu over the whole canvas is the CONSUMER's call, and the package already exports the
   * mechanism for it. `useContextMenu`'s documented pattern has the consumer wrap <KookieFlow> in
   * a div carrying `onContextMenu`, and contextmenu bubbles out to it — so a consumer using the
   * sanctioned plugin already gets suppression today, with an opt-out an unconditional
   * preventDefault here would take away.
   */

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

      // A second finger does not start a pinch while a slider is being held. The pointer and touch
      // handlers run in parallel, so putting a finger down anywhere during a slider drag used to
      // zoom the canvas out from under the control the first finger was still on.
      if (touchState.current.touches.size === 2 && !widgetDragRef.current) {
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

      // The array is built INSIDE the guard, not before it. `touches.length` was only ever a
      // longer spelling of `touchState.current.touches.size`, so a one-finger touchmove — the
      // ordinary drag or pan on a touch device, once per frame for the whole gesture — allocated
      // a Map iterator and an array and then threw both away.
      if (touchState.current.touches.size === 2 && touchState.current.initialDistance !== null) {
        e.preventDefault();

        const touches = Array.from(touchState.current.touches.values());

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

  // What the cursor is when no widget is under the pointer. Named rather than inlined so the
  // widget's imperative override has something to put back — see `setWidgetCursor`.
  const baseCursor = isResizing
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
                : 'default';

  // React just wrote `cursor: baseCursor` onto the element, so a widget cursor set imperatively
  // before this render has been clobbered. Re-assert it, and keep the ref the handler reads in
  // step with what the render decided.
  useEffect(() => {
    baseCursorRef.current = baseCursor;
    applyCursor();
  }, [baseCursor, applyCursor]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: baseCursor,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      /**
       * A cancelled gesture ends the same way a released one does.
       *
       * `pointercancel` fires with no `pointerup` to follow when the OS takes the gesture — a
       * system edge swipe, a notification, palm rejection on a touch device. Nothing here listened
       * for it, so a slider drag cancelled that way left `widgetDragRef` set for the life of the
       * component, and the move handler's widget branch, which sits above the safety cleanup and
       * returns unconditionally, swallowed every pointermove after it. The minimap has had this
       * handler all along; the canvas is the one that lacked it.
       */
      onPointerCancel={handlePointerUp}
      onPointerLeave={(e) => {
        handlePointerUp(e);
        store.getState().setHoveredEntityId(null);
        store.getState().setHoveredSocketId(null);
        // The pointer has gone; nothing under it can still be lit. Without this a widget stayed
        // hovered for as long as the page did, because the move handler that would have cleared it
        // only runs over the canvas — the leaving case the socket hover already guards.
        store.getState().setHoveredWidget(null);
        setWidgetCursor(false);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      // Marks the focus target for the text editor, which has to hand focus back here on exit —
      // it unmounts its own textarea, and the canvas keyboard is gated on this element having
      // focus. A data attribute rather than a shared ref because the overlay is rendered by the
      // DOM layer, several components away.
      data-kookie-flow-container=""
      tabIndex={0}
      /**
       * `application`, not `group`, and the trade is worth stating.
       *
       * This surface's arrow keys are its own: they move a keyboard cursor from node to node, and
       * Enter steps into the focused node's controls. In a screen reader's browse mode those keys
       * never reach the page at all — the reader eats them to move its own virtual cursor — so a
       * graph that answers arrows and is not announced as an application is a graph a screen
       * reader user cannot drive. The cost, and it is real: NVDA and JAWS switch out of browse
       * mode for this element's whole subtree, which includes any `children` a consumer renders
       * inside the canvas. A consumer's own control panel nested here inherits that mode.
       *
       * The alternative considered was `role="group"` with the arrows intercepted only while the
       * container itself has focus. It changes no other element's mode and it also does not work,
       * for the reason above: in browse mode the keydown never arrives.
       */
      role="application"
      aria-label={ariaLabel}
      aria-describedby={instructionsId}
    >
      {children}
      {/* The DOM's entire remaining role on a node: one input, for one field, while it is being
          edited. It unmounts the moment the edit ends — see widget-edit-overlay.tsx. */}
      <WidgetEditOverlay
        hit={widgetEdit}
        onChange={emitWidgetChange}
        onClose={() => openWidgetEdit(null)}
      />
      {/* Static, and therefore free: one hidden sentence, read once when the graph takes focus. */}
      <p id={instructionsId} style={SR_ONLY_TEXT}>
        Arrow keys move between nodes. Press Enter to reach the focused node&apos;s controls, and
        Escape to come back here.
      </p>
      {/*
        The accessibility tree's half of the widget layer. Bounded to the ONE node the keyboard
        cursor is on, so its element count does not move with the size of the graph — see
        widget-a11y-mirror.tsx for why that bound is the whole argument. Gated on `showWidgets`
        for the same reason the pointer path is: with widgets off nothing is drawn and nothing is
        pressable, so there is nothing to mirror.
      */}
      {showWidgets ? (
        <WidgetA11yMirror
          entityId={focusedEntityId}
          socketTypes={socketTypes}
          widgetTypes={widgetTypes}
          editingSocketId={widgetEdit?.socketId ?? null}
          onChange={emitWidgetChange}
        />
      ) : null}
    </div>
  );
}

interface FlowCanvasProps {
  /** Widget chrome draws in GL, so the canvas needs the same three facts the DOM layer had. */
  showWidgets: boolean;
  defaultEntityWidth?: number;
  socketLabelWidth?: number;
  showGrid: boolean;
  showStats: boolean;
  defaultEdgeType: import('../types').EdgeType;
  socketTypes: Record<string, SocketType>;
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  maxImageTextureSize?: number;
  onEntitiesChange?: KookieFlowProps['onEntitiesChange'];
}

/**
 * WebGL text rendering layer using MSDF.
 * Uses FontContext to get the appropriate font atlas based on the font prop.
 */
interface WebGLTextLayerProps {
  showSocketLabels: boolean;
  showEdgeLabels: boolean;
  defaultEdgeType: EdgeType;
  /**
   * The same four facts `<WidgetsGL>` is given, threaded here because a widget is drawn by two
   * layers: its chrome in GL by widgets-gl.tsx, its value in glyphs by the text renderer. Both
   * resolve the box from one `getWidgetBox`, so passing the same numbers to both is what keeps a
   * value inside the well it belongs to.
   */
  showWidgets: boolean;
  socketTypes: Record<string, SocketType>;
  defaultEntityWidth?: number;
  socketLabelWidth?: number;
}

function WebGLTextLayer({
  showSocketLabels,
  showEdgeLabels,
  defaultEdgeType,
  showWidgets,
  socketTypes,
  defaultEntityWidth,
  socketLabelWidth,
}: WebGLTextLayerProps) {
  // Fonts are provided via FontContext - MultiWeightTextRenderer will use useFont()
  return (
    <MultiWeightTextRenderer
      showSocketLabels={showSocketLabels}
      showEdgeLabels={showEdgeLabels}
      defaultEdgeType={defaultEdgeType}
      showWidgetValues={showWidgets}
      socketTypes={socketTypes}
      defaultEntityWidth={defaultEntityWidth}
      socketLabelWidth={socketLabelWidth}
    />
  );
}

function FlowCanvas({
  showGrid,
  showStats,
  showWidgets,
  defaultEntityWidth,
  socketLabelWidth,
  defaultEdgeType,
  socketTypes,
  showSocketLabels,
  showEdgeLabels,
  maxImageTextureSize,
  onEntitiesChange,
}: FlowCanvasProps) {
  const glConfig = useMemo(
    () => ({
      /**
       * MSAA on, for everyone.
       *
       * This used to be `!isSafari`, decided by `/^((?!chrome|android).)*safari/i` against the
       * user-agent string — which reads Firefox-on-iOS and every iOS in-app WebView without a
       * `Safari/` token as not-Safari, so the browsers most in need of the saving were the ones
       * that got a multisampled backbuffer allocated and resolved every frame.
       *
       * Turning it OFF for everyone was the tempting reading, on the argument that every
       * silhouette here is antialiased in-shader. That is true of the SDF quads and FALSE of edge
       * ARROWHEADS: the arrow vertices are written with a zero perpendicular and uv.y = 0, so the
       * ribbon shader's smoothstep resolves to alpha 1 across the whole triangle and its two
       * diagonal edges have no shader antialiasing at all. Image entities are the same — textured
       * quads whose geometric boundary is exactly what MSAA samples. The default framebuffer's
       * MSAA is the only thing smoothing either.
       *
       * So the defect closes by the decision stopping being made from a UA string, not by flipping
       * the flag. Only real Safari changes behaviour, which is the population the dead branch was
       * written for and — by its own regex — mostly the only one it reached.
       */
      antialias: true,
      alpha: true,
      // Request high-performance GPU
      powerPreference: 'high-performance' as const,
      // These help Safari performance
      stencil: false,
      /**
       * A DEPTH BUFFER, since the stacking order moved into it (utils/entity-depth.ts).
       *
       * This was `depth: false`, and it was the whole reason the GL widgets inherited the DOM's
       * z-index problem: with no depth buffer, every `depthTest` in the package is a no-op and
       * the only ordering left is `renderOrder` — which is per LAYER, not per NODE, so a back
       * node's sliders painted over a front node's body. Measured: `getContextAttributes().depth`
       * false, `DEPTH_BITS` 0, and per-entity depth on every layer changing nothing at all.
       *
       * Bodies write depth inside their shape; everything on a body tests it and writes none.
       * The cost is one 24-bit attachment, cleared once a frame — cheaper than the DOM ever was.
       */
      depth: true,
      // Preserve drawing buffer can help with some Safari rendering issues
      preserveDrawingBuffer: false,
      // Fail if performance is poor
      failIfMajorPerformanceCaveat: false,
    }),
    []
  );

  return (
    <CanvasErrorBoundary>
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
        <CameraController />
        {showGrid && <Grid />}
        <TextEntities onEntitiesChange={onEntitiesChange} />
        <ImageEntities maxImageTextureSize={maxImageTextureSize} onEntitiesChange={onEntitiesChange} />
        <VideoEntities onEntitiesChange={onEntitiesChange} />
        <MeshEntities onEntitiesChange={onEntitiesChange} />
        <PreviewEntities />
        <Edges defaultEdgeType={defaultEdgeType} socketTypes={socketTypes} />
        <Sockets socketTypes={socketTypes} />
        {showWidgets && (
          <WidgetsGL
            socketTypes={socketTypes}
            defaultEntityWidth={defaultEntityWidth}
            socketLabelWidth={socketLabelWidth}
          />
        )}
        <Entities />
        <TextEditCursor />
        <RerouteNodes />
        <EntitySelection />
        <SelectionBox />
        <ConnectionLine socketTypes={socketTypes} />
        <WebGLTextLayer
          showSocketLabels={showSocketLabels}
          showEdgeLabels={showEdgeLabels}
          defaultEdgeType={defaultEdgeType}
          showWidgets={showWidgets}
          socketTypes={socketTypes}
          defaultEntityWidth={defaultEntityWidth}
          socketLabelWidth={socketLabelWidth}
        />
      </Canvas>
    </CanvasErrorBoundary>
  );
}

/**
 * Syncs external props with internal store.
 */
/**
 * Pushes the controlled `entities` and `edges` props into the store.
 *
 * It took `onEntitiesChange`/`onEdgesChange` and did nothing with them: the subscription that
 * would have used them had an empty body under a comment reading "Generate change events
 * (simplified)". Change events are raised by the input handler, not here, so the callbacks were
 * a prop signature describing work this component does not do — and the subscription itself ran a
 * selector over `state.entities` on every store change, forever, to call nothing.
 */
interface FlowSyncProps {
  entities: KookieFlowProps['entities'];
  edges: KookieFlowProps['edges'];
  socketTypes: Record<string, SocketType>;
}

function FlowSync({ entities, edges, socketTypes }: FlowSyncProps) {
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
