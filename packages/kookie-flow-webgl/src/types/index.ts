import type {
  AlignEdge,
  Connection,
  ConnectionEndState,
  ConnectionMode,
  DistributeAxis,
  DrawEntityData,
  Edge,
  EdgeChange,
  EdgeType,
  Entity,
  EntityChange,
  EntityData,
  EntityRadius,
  EntitySize,
  EntityStyleOverrides,
  EntityVariant,
  EvaluationStatus,
  FitViewOptions,
  FlowObject,
  FontConfig,
  FontPreset,
  HeaderPosition,
  IsValidConnectionFn,
  MinimapPosition,
  OnConnectStartParams,
  OnEvaluate,
  OnStatusChange,
  SocketType,
  Viewport,
  XYPosition,
  EntityTypeDefinition as CoreEntityTypeDefinition,
} from '@kushagradhawan/kookie-flow-core';
import type { LayoutOptions } from '@kushagradhawan/kookie-flow-core/layout';
import type { CaptureOptions } from '../utils/canvas-runtime';
export * from '@kushagradhawan/kookie-flow-core/types';
/** Props passed to toolbar render functions */
export interface ToolbarRenderProps {
  /** All selected entities */
  entities: Entity[];
  /** Update one entity's data — wraps onEntitiesChange internally */
  update: (entityId: string, data: Partial<EntityData>) => void;
  /** The selection's screen-space bounding box */
  bounds: { x: number; y: number; width: number; height: number };
  /** Line the selection up on an edge or centre line of its bounds, reported as a drag is. */
  align: (edge: AlignEdge) => void;
  /** Space the selection evenly along an axis, reported as a drag is. */
  distribute: (axis: DistributeAxis) => void;
}

/** Toolbar render function */
export type ToolbarRenderFn = (props: ToolbarRenderProps) => React.ReactNode;

/** Built-in toolbar widget names for text entities */
export type TextToolbarWidget =
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'textColor'
  | 'textAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'sizingMode';

/** Built-in toolbar widget names for image entities */
export type ImageToolbarWidget = 'objectFit' | 'aspectLock';

/** Built-in toolbar widget names for comment entities */
/**
 * `noteColor` picks the note's hue (`data.color`), which tints its fill, edge and text together and
 * follows light and dark. `backgroundColor` and `textColor` set one colour outright, for a note that
 * needs a colour no hue gives.
 */
export type CommentToolbarWidget = 'noteColor' | 'backgroundColor' | 'textColor' | 'fontSize';

/** Built-in toolbar widget names for ink */
export type DrawToolbarWidget = 'strokeColor' | 'strokeWidth';

/**
 * Built-in toolbar widget names available to any entity type. `arrange` is the align and
 * distribute buttons, shown only once two or more are selected.
 */
export type CommonToolbarWidget = 'color' | 'arrange';

/** All built-in toolbar widget names */
export type ToolbarWidget =
  | TextToolbarWidget
  | ImageToolbarWidget
  | CommentToolbarWidget
  | DrawToolbarWidget
  | CommonToolbarWidget;

/**
 * Toolbar configuration for an entity type.
 *
 * - `true`: show all built-in defaults for this entity type
 * - `false`: no toolbar
 * - `string[]`: pick specific built-in defaults
 * - `{ defaults, extra }`: built-in defaults + custom controls
 * - `ToolbarRenderFn`: full override — consumer owns everything
 */
export type ToolbarConfig =
  | true
  | false
  | ToolbarWidget[]
  | {
      defaults?: true | ToolbarWidget[];
      extra?: ToolbarRenderFn;
    }
  | ToolbarRenderFn;

/** Minimap component props */
export interface MinimapProps {
  /** Position of the minimap. Default: 'bottom-right' */
  position?: MinimapPosition;
  /** Width in pixels. Default: 200 */
  width?: number;
  /** Height in pixels. Default: 150 */
  height?: number;
  /** Background color. Default: from THEME_COLORS.minimap.background with 0.9 alpha */
  backgroundColor?: string;
  /** Entity color (or function for per-entity color). Default: from THEME_COLORS.minimap.entity */
  entityColor?: string | ((entity: Entity) => string);
  /** Selected entity color. Default: from THEME_COLORS.minimap.nodeSelected */
  selectedEntityColor?: string;
  /** Viewport indicator fill color. Default: from THEME_COLORS.minimap.viewport with 0.3 alpha */
  viewportColor?: string;
  /** Viewport indicator border color. Default: from THEME_COLORS.minimap.viewportBorder */
  viewportBorderColor?: string;
  /** Padding around content in minimap pixels. Default: 20 */
  padding?: number;
  /** Whether the minimap is interactive (click to pan, drag viewport). Default: true */
  interactive?: boolean;
  /**
   * Whether the minimap zooms with the main canvas.
   * - false (default): Shows all entities at fixed scale, viewport indicator resizes
   * - true: Minimap zooms with main canvas, viewport indicator stays fixed size
   */
  zoomable?: boolean;
  /** Custom className for styling */
  className?: string;
  /**
   * Inline styles for the outer element, applied after the minimap's own so they win. A class
   * cannot move the minimap, since its corner is an inline style.
   */
  style?: React.CSSProperties;
}

/** KookieFlow component props */
export interface KookieFlowProps {
  /** Entities in the graph */
  entities: Entity[];
  /** Edges connecting entities */
  edges: Edge[];
  /** Entity type definitions */
  entityTypes?: Record<string, EntityTypeDefinition>;
  /** Socket type definitions */
  socketTypes?: Record<string, SocketType>;
  /** Callback when entities change */
  onEntitiesChange?: (changes: EntityChange[]) => void;
  /** Callback when edges change */
  onEdgesChange?: (changes: EdgeChange[]) => void;
  /** Callback when a connection is made */
  onConnect?: (connection: Connection) => void;
  /** Callback when a connection drag starts */
  onConnectStart?: (event: PointerEvent, params: OnConnectStartParams) => void;
  /** Callback when a connection drag ends (regardless of success) */
  onConnectEnd?: (event: PointerEvent, state: ConnectionEndState) => void;
  /** Callback when an entity is clicked */
  onEntityClick?: (entity: Entity) => void;
  /** Callback when an edge is clicked */
  onEdgeClick?: (edge: Edge) => void;
  /** Callback when empty space is clicked */
  onPaneClick?: () => void;
  /** Callback when image files are dropped from the filesystem onto the canvas */
  onFileDrop?: (files: File[], position: XYPosition) => void;
  /** Whether edges can be selected by clicking. Default: true */
  edgesSelectable?: boolean;
  /** Connection validation mode. 'strict' enforces socket type compatibility. Default: 'loose' */
  connectionMode?: ConnectionMode;
  /** Custom connection validation function. Overrides connectionMode when provided. */
  isValidConnection?: IsValidConnectionFn;
  /**
   * Whether to allow cycles in the graph.
   * When false (default), connections that would create a cycle are rejected automatically.
   * Uses `wouldCreateCycle()` from the graph engine for O(k) cycle detection.
   * Default: true (cycles allowed — no automatic prevention)
   */
  allowCycles?: boolean;
  /** Initial viewport */
  defaultViewport?: Viewport;
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Show grid background */
  showGrid?: boolean;
  /** Show minimap */
  showMinimap?: boolean;
  /** Minimap configuration */
  minimapProps?: MinimapProps;
  /** Show performance stats (FPS counter) */
  showStats?: boolean;
  /**
   * Font for text rendering. Labels are drawn with instanced MSDF, so this picks the
   * MSDF atlas rather than a CSS font family.
   * - Preset name: 'inter' | 'roboto' | 'source-serif' | 'system'
   * - Custom config: { name, weights: { regular, semibold? } } with MSDF metrics/atlas
   * Default: 'inter'
   */
  font?: FontPreset | FontConfig;
  /** Show socket labels next to sockets. Default: true */
  showSocketLabels?: boolean;
  /** Show edge labels on edges. Default: true */
  showEdgeLabels?: boolean;
  /** Enable snap to grid */
  snapToGrid?: boolean;
  /** Grid snap size */
  snapGrid?: [number, number];
  /** Default edge rendering type. Default: 'bezier' */
  defaultEdgeType?: EdgeType;
  /** Maximum texture dimension (px) for full-res image LOD tier. Default: 2048 */
  maxImageTextureSize?: number;
  /** Additional class name */
  className?: string;
  /**
   * The accessible name of the graph itself.
   *
   * The canvas container is the graph's ONE tab stop, and until this existed it carried no name
   * at all — a screen reader announced it as an unlabelled application and a page with two graphs
   * on it announced the same nothing twice. Default: 'Flow graph'.
   */
  ariaLabel?: string;
  /** Children (for overlays) */
  children?: React.ReactNode;

  // ============================================================================
  // Styling Props (Milestone 2 - matches Kookie UI Card)
  // ============================================================================

  /** Entity size scale. Default: '2' */
  size?: EntitySize;
  /** Entity visual variant. Default: 'surface' */
  variant?: EntityVariant;
  /**
   * Entity border radius style. Default: follows `size` — that tier's surface radius, which is
   * 'small' at size '2'.
   */
  radius?: EntityRadius;
  /** Where the entity title is drawn ('none' draws none). Default: 'inside' */
  header?: HeaderPosition;
  /**
   * Show `--accent-9` through every entity's glass: a soft, grained mesh of the hue along the top,
   * fading into the body, whatever `header` is. An entity's own `color` draws the same aura in its
   * hue. Default: false
   */
  accentHeader?: boolean;
  /** Fine-grained style overrides */
  entityStyle?: Partial<EntityStyleOverrides>;
  /** Callback when a widget value changes */
  onWidgetChange?: (entityId: string, socketId: string, value: unknown) => void;

  // ============================================================================
  // Evaluation (Phase 8.5)
  // ============================================================================

  /**
   * The one function that computes. Given an entity and its resolved inputs — connected sockets
   * read upstream, unconnected ones read their widget — return its outputs keyed by output socket
   * id. The library decides WHEN to call this and what to do with the answer; it never decides
   * what the answer means. Async is fine; `ctx.signal` aborts when inputs change mid-run.
   */
  onEvaluate?: OnEvaluate;
  /** Every status transition the engine makes: dirty, running, success, error, idle. */
  onStatusChange?: OnStatusChange;
  /** Show widgets on unconnected input sockets. Default: true */
  showWidgets?: boolean;
  /**
   * Alignment guides while dragging: the lines that appear when a node's edge or centre lines up
   * with another's, and the small snap that goes with them. Default: true.
   *
   * Ignored while `snapToGrid` is on — two things deciding where a node lands fight, and the grid
   * was asked for explicitly.
   */
  helperLines?: boolean;
  /**
   * What the pen draws with: `strokeWidth` in world pixels and `strokeColor` as any CSS colour.
   * Unset, ink is 3px in the theme's text colour. A stroke keeps the style it was drawn with; the
   * `strokeColor` and `strokeWidth` toolbar widgets restyle a selection afterwards.
   */
  penStyle?: Pick<DrawEntityData, 'strokeWidth' | 'strokeColor'>;
  /** Default entity width when entity.width is not specified. Default: 240 */
  defaultEntityWidth?: number;
  /** Width reserved for socket labels before widget starts. Default: 96 */
  socketLabelWidth?: number;
}

// ============================================================================
// Imperative API Types
// ============================================================================

/** Imperative handle exposed via ref */
export interface KookieFlowInstance {
  /** Fit the viewport to show all entities (or specific entities) */
  fitView: (options?: FitViewOptions) => void;
  /** Get the current viewport */
  getViewport: () => Viewport;
  /** Set the viewport directly */
  setViewport: (viewport: Viewport) => void;
  /** Zoom in by a step */
  zoomIn: (step?: number) => void;
  /** Zoom out by a step */
  zoomOut: (step?: number) => void;
  /** Get all entities */
  getEntities: () => Entity[];
  /** Get all edges */
  getEdges: () => Edge[];
  /** Get currently selected entities */
  getSelectedEntities: () => Entity[];
  /** Get currently selected edges */
  getSelectedEdges: () => Edge[];
  /** Center the viewport on a specific position */
  setCenter: (x: number, y: number, options?: { zoom?: number }) => void;
  /**
   * Tidy the graph: every entity into a column behind whatever feeds it, left to right by
   * default. Returns the positions it chose, so a controlled consumer can report them onwards.
   */
  autoLayout: (options?: LayoutOptions) => Array<{ id: string; position: XYPosition }>;
  /**
   * Line the selected entities up on one edge or centre line of the selection's own bounds.
   * Reported through `onEntitiesChange` as a drag is, and returned. Needs two or more; a frame
   * moves with its contents. Alt+A, D, W, S, H and V on the canvas.
   */
  alignSelection: (edge: AlignEdge) => Array<{ id: string; position: XYPosition }>;
  /**
   * Space the selected entities evenly along an axis: equal gaps, the outermost two staying put.
   * Reported and returned like `alignSelection`. Needs three or more. Alt+Shift+H and V.
   */
  distributeSelection: (axis: DistributeAxis) => Array<{ id: string; position: XYPosition }>;
  /**
   * What is on screen, as an image data URL. `null` if the canvas is not mounted.
   *
   * The current viewport, at twice its pixel size by default and transparent behind. Call
   * `fitView()` first to capture the whole graph.
   */
  toImage: (options?: CaptureOptions) => string | null;
  /**
   * Fold a set of entities into one group entity, with ports for every wire that crossed the
   * boundary. `expandSubgraph` puts them back.
   *
   * Both report what they changed through `onEntitiesChange` and `onEdgesChange`, as a drag does,
   * so a controlled consumer's next render does not undo them.
   */
  collapseToSubgraph: (entityIds: string[], groupId: string) => void;
  expandSubgraph: (
    groupId: string,
    childEntities: Entity[],
    internalEdges: Edge[],
    portMapping: {
      inputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
      outputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
    }
  ) => void;
  /**
   * The whole graph as data you can save: entities, edges and the viewport.
   *
   * What comes out is what `<KookieFlow entities edges>` takes back in. Selection and drag state
   * are left out — they describe this moment, not the graph.
   */
  toObject: () => FlowObject;

  // ============================================================================
  // Evaluation API (Phase 8.5)
  // ============================================================================

  /** Run one entity now, whatever its mode, then cascade downstream. The manual trigger. */
  evaluate: (entityId: string) => Promise<void>;
  /** Run every dirty entity, manual gates included, and resolve when the graph is quiet. */
  evaluateDirty: () => Promise<void>;
  /** Mark everything stale and run all of it. */
  evaluateAll: () => Promise<void>;
  /**
   * Mark everything stale and bring it back: reactive entities run, manual ones are asked with
   * `ctx.restore` for a result they already have. For opening a saved graph.
   */
  restoreAll: () => Promise<void>;
  /** Inject an output value. Downstream is marked stale; the entity itself is not re-run. */
  setSocketValue: (entityId: string, socketId: string, value: unknown) => void;
  /** Read a computed output value. */
  getSocketValue: (entityId: string, socketId: string) => unknown;
  /** The engine's status for an entity; `idle` if it has never been asked. */
  getEvaluationStatus: (entityId: string) => EvaluationStatus;

  // ============================================================================
  // Grouping API
  // ============================================================================

  /** Get all child entities of a group (non-recursive) */
  getGroupChildren: (groupId: string) => Entity[];
  /** Get all descendant entities of a group (recursive) */
  getGroupDescendants: (groupId: string) => Entity[];
  /** Toggle a group's collapsed state */
  toggleGroupCollapse: (groupId: string) => void;
  /** Expand a collapsed group */
  expandGroup: (groupId: string) => void;
  /** Collapse an expanded group */
  collapseGroup: (groupId: string) => void;
  /** Check if a group is collapsed */
  isGroupCollapsed: (groupId: string) => boolean;
  /** Get the bounds of a group (calculated from children) */
  getGroupBounds: (
    groupId: string
  ) => { x: number; y: number; width: number; height: number } | null;
  /**
   * The box an entity occupies on the board, in world units: its stated size, or the one its
   * sockets, widgets and preview add up to. Null for an id the board does not hold.
   */
  getEntityBounds: (
    entityId: string
  ) => { x: number; y: number; width: number; height: number } | null;
}

/** Rendering configuration extends the engine's data-only definition. */
export interface EntityTypeDefinition extends CoreEntityTypeDefinition {
  toolbar?: ToolbarConfig;
}
