/** Position in 2D space */
export interface XYPosition {
  x: number;
  y: number;
}

/** Dimensions */
export interface Dimensions {
  width: number;
  height: number;
}

/** Viewport state */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Edge rendering type */
export type EdgeType = 'straight' | 'bezier' | 'step' | 'smoothstep';

/** Edge marker type */
export type EdgeMarkerType = 'arrow' | 'arrowClosed';

/** Edge marker configuration */
export interface EdgeMarker {
  type: EdgeMarkerType;
  /** Width of the marker in pixels. Default: 12 */
  width?: number;
  /** Height of the marker in pixels. Default: 12 */
  height?: number;
  /** Color override (defaults to edge color) */
  color?: string;
}

/** Edge label configuration */
export interface EdgeLabelConfig {
  /** Label text */
  text: string;
  /** Position along edge (0 = start, 0.5 = middle, 1 = end). Default: 0.5 */
  position?: number;
  /** Background color. Default: transparent */
  bgColor?: string;
  /** Text color. Default: #ffffff */
  textColor?: string;
  /** Font size in pixels. Default: 12 */
  fontSize?: number;
}

// ============================================================================
// Widget Types (Phase 7D)
// ============================================================================

/** Built-in widget types for socket inputs */
export type WidgetType = 'slider' | 'number' | 'select' | 'checkbox' | 'text' | 'color' | 'textarea';

/** Socket layout mode for widget positioning */
export type SocketLayoutMode = 'inline' | 'stacked';

/** Props passed to widget components */
export interface WidgetProps {
  /**
   * Accessible name for the control — normally the socket's own name.
   *
   * Optional so a consumer's existing `widgetTypes` component keeps compiling, but it is the ONLY
   * route by which a third-party widget can be named: the wrapper renders the component and cannot
   * reach inside it to label whatever control it happens to draw.
   */
  label?: string;
  /** Current value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
  /** Whether the widget is disabled (e.g., socket is connected) */
  disabled?: boolean;
  /** Minimum value (for slider/number) */
  min?: number;
  /** Maximum value (for slider/number) */
  max?: number;
  /** Step value (for slider/number) */
  step?: number;
  /** Options (for select) */
  options?: string[];
  /** Placeholder text (for text input) */
  placeholder?: string;
  /** Number of visible text lines (for textarea) */
  rows?: number;
}

/** Inline widget component definition */
export interface InlineWidgetComponent {
  component: React.ComponentType<WidgetProps>;
}

/** Resolved widget configuration (after merging socket + type defaults) */
export interface ResolvedWidgetConfig {
  /** Widget type */
  type: WidgetType;
  /** Min value for slider/number */
  min?: number;
  /** Max value for slider/number */
  max?: number;
  /** Step value for slider/number */
  step?: number;
  /** Options for select */
  options?: string[];
  /** Placeholder for text input */
  placeholder?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Custom component (if provided inline on socket) */
  customComponent?: React.ComponentType<WidgetProps>;
  /** Number of visible text lines (for textarea) */
  rows?: number;
}

/** Socket type definition */
export interface SocketType {
  color: string;
  name: string;
  /** Compatibility rules */
  compatibleWith?: string[] | '*';
  /** Default widget type for sockets of this type */
  widget?: WidgetType;
  /** Default min value for slider/number widgets */
  min?: number;
  /** Default max value for slider/number widgets */
  max?: number;
  /** Default step value for slider/number widgets */
  step?: number;
}

/** Socket definition on an entity */
export interface Socket {
  id: string;
  name: string;
  type: string;
  /** Position relative to entity (0 = top, 1 = bottom) */
  position?: number;
  /** Widget type override (false = disable widget) */
  widget?: WidgetType | false | InlineWidgetComponent;
  /** Min value override for slider/number */
  min?: number;
  /** Max value override for slider/number */
  max?: number;
  /** Step value override for slider/number */
  step?: number;
  /** Options for select widget */
  options?: string[];
  /** Placeholder for text widget */
  placeholder?: string;
  /** Default value when unconnected */
  defaultValue?: unknown;
  /**
   * Layout mode for this socket's widget.
   * - 'inline' (default): Label on left, widget on right
   * - 'stacked': Label above widget, widget spans full entity width
   */
  layout?: SocketLayoutMode;
  /**
   * Number of rows this socket occupies.
   * For textarea: rows: 3 gives 3x widget height.
   * Works with both inline and stacked layouts.
   * Default: 1
   */
  rows?: number;
  /**
   * Explicit height override in pixels.
   * Takes precedence over `rows` calculation.
   */
  height?: number;
}

/** Socket handle for identifying a specific socket on an entity */
export interface SocketHandle {
  entityId: string;
  socketId: string;
  isInput: boolean;
}

/**
 * Which widget the pointer is over, as the two ids that name it.
 *
 * A widget only ever exists on an INPUT socket, so unlike `SocketHandle` this carries no
 * direction — there is nothing for it to distinguish. Two fields rather than one `entityId:socketId`
 * string because the renderer compares this against every visible widget inside the frame loop,
 * and a joined key would mean a string concatenation per widget per frame in the one layer whose
 * whole reason for existing is that a pan costs nothing.
 */
export interface WidgetHandle {
  entityId: string;
  socketId: string;
}

/** Entity status for visual feedback */
/**
 * `dirty` is set by the evaluation engine when an entity's inputs have changed and nothing has
 * answered yet. The others may be set by the consumer on `entity.data.status`, which always wins
 * over what the engine reports.
 */
export type EntityStatus = 'dirty' | 'error' | 'warning' | 'running' | 'success';

/** Base entity data */
export interface EntityData {
  label?: string;
  /** Entity status for visual feedback rendering */
  status?: EntityStatus;
  /** Human-readable status message */
  statusMessage?: string;
  [key: string]: unknown;
}

// ============================================================================
// Special Entity Types
// ============================================================================

/** Built-in special entity types */
export type BuiltInEntityType = 'frame' | 'comment' | 'reroute' | 'draw' | 'text' | 'image' | 'video' | 'mesh';

/** Data for frame entities (spatial containers) */
export interface FrameEntityData extends EntityData {
  /** Frame title shown in header */
  label?: string;
  /** Optional description shown below title when expanded */
  description?: string;
  /** Background color for the frame */
  backgroundColor?: string;
  /** Border color for the frame */
  borderColor?: string;
}

/** Data for comment/sticky note entities */
export interface CommentEntityData extends EntityData {
  /** Comment text content */
  content: string;
  /** Background color (CSS color). Default: yellow-ish sticky note */
  backgroundColor?: string;
  /** Text color. Default: dark gray */
  textColor?: string;
  /** Font size in pixels. Default: 14 */
  fontSize?: number;
}

/** Data for reroute/waypoint entities */
export interface RerouteEntityData extends EntityData {
  /** Optional label (rarely used, mostly for debugging) */
  label?: string;
}

/** Data for draw entities (shapes, SVG paths, freeform drawing) */
export interface DrawEntityData extends EntityData {
  /** Shapes contained in this draw entity */
  shapes?: Array<{
    type: 'rect' | 'ellipse' | 'path' | 'text';
    /** Shape-specific properties */
    [key: string]: unknown;
  }>;
}

/** Sizing mode for text entities (Figma parity) */
export type TextSizingMode = 'auto-width' | 'auto-height' | 'fixed';

/** Data for text entities (standalone text blocks on canvas) */
export interface TextEntityData extends EntityData {
  /** Text content (required for text entities) */
  content: string;
  /** Font size in pixels (default: 16) */
  fontSize?: number;
  /** Font family (default: system-ui) */
  fontFamily?: string;
  /** Font weight (default: 400) */
  fontWeight?: number;
  /** Text color as CSS color string (default: from theme) */
  textColor?: string;
  /** Text alignment (default: 'left') */
  textAlign?: 'left' | 'center' | 'right';
  /** Line height multiplier (default: 1.5) */
  lineHeight?: number;
  /** Letter spacing in pixels (default: 0) */
  letterSpacing?: number;
  /** Sizing mode: 'auto-width' | 'auto-height' | 'fixed'. Default: 'auto-height' */
  sizingMode?: TextSizingMode;
}

/** Data for image entities */
export interface ImageEntityData extends EntityData {
  /** Image source URL or data URL */
  src?: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Object fit mode */
  objectFit?: 'contain' | 'cover' | 'fill';
  /** Lock aspect ratio during resize (default true for images; Shift inverts) */
  aspectLocked?: boolean;
}

/** Data for video entities */
export interface VideoEntityData extends EntityData {
  /** Video source URL */
  src?: string;
  /** Poster frame URL */
  poster?: string;
  /**
   * Play whenever the entity is on screen. Default: false.
   *
   * "Whenever it can be seen" rather than "from mount": a video off the viewport is paused, so
   * this is a standing wish rather than a one-shot. Playback is always muted — every browser's
   * autoplay policy refuses an unmuted `play()` without a user gesture.
   */
  autoplay?: boolean;
  /**
   * Explicit play/pause, overriding `autoplay` when set.
   *
   * Still subject to the concurrent-decoder cap: asking more videos to play than the platform can
   * decode leaves the surplus on their poster frame rather than failing.
   */
  playing?: boolean;
  /** Whether to loop. Default: true */
  loop?: boolean;
  /** Object fit mode. Default: 'contain' — a clip letterboxes rather than crops. */
  objectFit?: 'contain' | 'cover' | 'fill';
  /** Lock aspect ratio during resize (default true for video; Shift inverts) */
  aspectLocked?: boolean;
}

/** Data for 3D mesh entities */
export interface MeshEntityData extends EntityData {
  /** URL to glTF/GLB file */
  src?: string;
  /**
   * Which way the camera looks at the model, as a DIRECTION from its centre — not a world point.
   *
   * The distance is derived from the model's own bounding sphere, so the preview frames correctly
   * whatever the model's scale, and a consumer choosing an angle does not have to know how big the
   * file it just loaded is. Default: { x: 0, y: 0.4, z: 1 }, slightly above and in front.
   */
  cameraPosition?: { x: number; y: number; z: number };
  /**
   * Turn the model continuously. Default: false.
   *
   * Off by default because it is the one thing that makes a preview cost something every frame: a
   * still model's render target is drawn once and then sampled for free. An entity that opts in
   * pays for itself and for nothing else on the board.
   */
  autoRotate?: boolean;
  /** Radians per second when `autoRotate` is on. Default: 0.6 */
  rotateSpeed?: number;
  /** Lock aspect ratio during resize (default true for mesh; Shift inverts) */
  aspectLocked?: boolean;
}

/** Draw entity type */
export type DrawEntity = Entity<DrawEntityData> & {
  type: 'draw';
};

/** Text entity type */
export type TextEntity = Entity<TextEntityData> & {
  type: 'text';
};

/** Image entity type */
export type ImageEntity = Entity<ImageEntityData> & {
  type: 'image';
};

/** Video entity type */
export type VideoEntity = Entity<VideoEntityData> & {
  type: 'video';
};

/** Mesh entity type */
export type MeshEntity = Entity<MeshEntityData> & {
  type: 'mesh';
};

/** Frame entity type (spatial container) */
export type FrameEntity = Entity<FrameEntityData> & {
  type: 'frame';
  collapsed?: boolean;
  extent?: 'auto' | 'fixed';
};

/** Comment entity type */
export type CommentEntity = Entity<CommentEntityData> & {
  type: 'comment';
};

/** Reroute entity type */
export type RerouteEntity = Entity<RerouteEntityData> & {
  type: 'reroute';
};

/** Helper type guard for frame entities */
export function isFrameEntity(entity: Entity): entity is FrameEntity {
  return entity.type === 'frame';
}

/** Helper type guard for comment entities */
export function isCommentEntity(entity: Entity): entity is CommentEntity {
  return entity.type === 'comment';
}

/** Helper type guard for reroute entities */
export function isRerouteEntity(entity: Entity): entity is RerouteEntity {
  return entity.type === 'reroute';
}

/** Helper type guard for text entities */
export function isTextEntity(entity: Entity): entity is TextEntity {
  return entity.type === 'text';
}

/** Helper type guard for image entities */
export function isImageEntity(entity: Entity): entity is ImageEntity {
  return entity.type === 'image';
}

/** Type guard for video entities */
export function isVideoEntity(entity: Entity): entity is VideoEntity {
  return entity.type === 'video';
}

/** Type guard for 3D mesh entities */
export function isMeshEntity(entity: Entity): entity is MeshEntity {
  return entity.type === 'mesh';
}

/** Entity in the graph */
export interface Entity<T extends EntityData = EntityData> {
  id: string;
  type: string;
  position: XYPosition;
  data: T;
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
  inputs?: Socket[];
  outputs?: Socket[];
  /** Per-entity accent color override (matches Kookie UI accent colors) */
  color?: AccentColor;
  /**
   * Whether this entity is resizable via drag handles.
   * - true (default): resizable in both width and height
   * - false: not resizable
   * - { width?: boolean; height?: boolean }: per-axis control
   */
  resizable?: boolean | { width?: boolean; height?: boolean };

  // ============================================================================
  // Grouping / Hierarchy
  // ============================================================================

  /**
   * Parent frame entity ID. When set, this entity is a child of the frame.
   * Child entities move with their parent and are hidden when the frame is collapsed.
   */
  parentId?: string;
  /**
   * Whether this frame entity is collapsed (only applies to frame entities).
   * When collapsed, child entities are hidden and edges are rerouted through the frame.
   */
  collapsed?: boolean;
  /**
   * Extent mode for frame entities. Determines if the frame auto-sizes to fit children.
   * - 'auto': Frame resizes to fit children with padding (default)
   * - 'fixed': Frame uses explicit width/height
   */
  extent?: 'auto' | 'fixed';
}

/** Edge connecting two entities */
export interface Edge {
  id: string;
  source: string;
  target: string;
  sourceSocket?: string;
  targetSocket?: string;
  /** Edge rendering type (overrides defaultEdgeType) */
  type?: EdgeType;
  selected?: boolean;
  animated?: boolean;
  /** Whether the edge connects incompatible socket types (in loose mode) */
  invalid?: boolean;
  /** Edge label (string or full config) */
  label?: string | EdgeLabelConfig;
  /** Marker at the start of the edge (source side) */
  markerStart?: EdgeMarkerType | EdgeMarker;
  /** Marker at the end of the edge (target side) */
  markerEnd?: EdgeMarkerType | EdgeMarker;

  // ============================================================================
  // Reroute Support (Phase 7C)
  // ============================================================================

  /**
   * IDs of reroute entities that this edge passes through.
   * Edge is rendered as segments: source → reroute1 → reroute2 → ... → target
   * Order matters - first reroute is closest to source.
   */
  reroutes?: string[];
}

/** Connection in progress */
export interface Connection {
  source: string | null;
  sourceSocket: string | null;
  target: string | null;
  targetSocket: string | null;
  /** Whether the connection has incompatible socket types (in loose mode) */
  invalid?: boolean;
}

/** Connection mode for validation */
export type ConnectionMode = 'strict' | 'loose';

/** Connection validation params passed to isValidConnection callback */
export interface ConnectionValidationParams {
  source: SocketHandle;
  target: SocketHandle;
  sourceSocketType: string;
  targetSocketType: string;
}

/** Connection validation function */
export type IsValidConnectionFn = (
  params: ConnectionValidationParams,
  socketTypes: Record<string, SocketType>
) => boolean;

/** Parameters passed to onConnectStart callback */
export interface OnConnectStartParams {
  entityId: string;
  socketId: string;
  isInput: boolean;
}

/** State passed to onConnectEnd callback */
export interface ConnectionEndState {
  /** Whether the connection landed on a valid socket */
  isValid: boolean;
  /** The socket where the drag originated */
  source: {
    entityId: string;
    socketId: string;
    isInput: boolean;
  };
  /** World coordinates of the drop point */
  position: XYPosition;
}

/** Entity change event */
export type EntityChange =
  | { type: 'position'; id: string; position: XYPosition }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'add'; entity: Entity }
  | { type: 'dimensions'; id: string; dimensions: Dimensions }
  | { type: 'collapse'; id: string; collapsed: boolean }
  | { type: 'parent'; id: string; parentId: string | null }
  | { type: 'data'; id: string; data: EntityData };

/** Edge change event */
export type EdgeChange =
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'add'; edge: Edge };

/** Props passed to toolbar render functions */
export interface ToolbarRenderProps {
  /** All selected entities */
  entities: Entity[];
  /** Update one entity's data — wraps onEntitiesChange internally */
  update: (entityId: string, data: Partial<EntityData>) => void;
  /** The selection's screen-space bounding box */
  bounds: { x: number; y: number; width: number; height: number };
}

/** Toolbar render function */
export type ToolbarRenderFn = (props: ToolbarRenderProps) => React.ReactNode;

/** Built-in toolbar widget names for text entities */
export type TextToolbarWidget = 'fontSize' | 'fontFamily' | 'fontWeight' | 'textColor' | 'textAlign' | 'lineHeight' | 'letterSpacing' | 'sizingMode';

/** Built-in toolbar widget names for image entities */
export type ImageToolbarWidget = 'objectFit' | 'aspectLock';

/** Built-in toolbar widget names for comment entities */
export type CommentToolbarWidget = 'backgroundColor' | 'textColor' | 'fontSize';

/** Built-in toolbar widget names available to any entity type */
export type CommonToolbarWidget = 'color';

/** All built-in toolbar widget names */
export type ToolbarWidget = TextToolbarWidget | ImageToolbarWidget | CommentToolbarWidget | CommonToolbarWidget;

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

/** Entity type definition for custom rendering */
export interface EntityTypeDefinition<T extends EntityData = EntityData> {
  /** Entity type identifier */
  type: string;
  /** The header text for nodes of this type that carry no `data.label` of their own. */
  label?: string;
  /** The size nodes of this type open at, unless the node states its own. */
  defaultWidth?: number;
  defaultHeight?: number;
  /**
   * The sockets every node of this type has, unless the node states its own.
   *
   * Ids are required and are the app's: an edge names the socket it lands on, so a socket the
   * table invented an id for could never be wired to anything the app saved.
   */
  inputs?: Socket[];
  outputs?: Socket[];
  /** Preview configuration */
  preview?: {
    type: 'image' | 'mesh' | 'custom';
    source?: string;
  };
  /** Custom React component for hybrid mode */
  component?: React.ComponentType<EntityComponentProps<T>>;
  /** Toolbar configuration — controls shown when this entity type is selected */
  toolbar?: ToolbarConfig;
  /**
   * How entities of this type answer a change in their inputs. Default: 'reactive'.
   *
   * `reactive` re-runs as soon as its inputs settle. `manual` is a gate: the change marks it
   * dirty and stops there until `evaluate(id)` opens it, after which reactive entities downstream
   * cascade as normal. Anything expensive — a generation, a render — should be manual.
   */
  evaluation?: EvaluationMode;
}

/** Props passed to custom entity components */
export interface EntityComponentProps<T extends EntityData = EntityData> {
  id: string;
  data: T;
  selected: boolean;
  onChange: (data: Partial<T>) => void;
}

/** Options for cloning elements */
export interface CloneElementsOptions<T extends EntityData = EntityData> {
  /** Offset to apply to cloned entity positions */
  offset?: XYPosition;
  /** Transform function for entity data (for app-specific transformations) */
  transformData?: (data: T) => T;
  /** Custom ID generation function */
  generateId?: () => string;
  /**
   * When true, edges with one endpoint outside the cloned set will preserve
   * that external reference instead of being filtered out.
   * Default: false
   */
  preserveExternalConnections?: boolean;
}

/** Result of cloning elements */
export interface CloneElementsResult {
  /** Cloned entities with new IDs */
  entities: Entity[];
  /** Cloned edges with new IDs and remapped entity references */
  edges: Edge[];
  /** Map from old ID to new ID */
  idMap: Map<string, string>;
}

/** Elements batch (for add/delete operations) */
export interface ElementsBatch {
  entities?: Entity[];
  edges?: Edge[];
}

/** Delete elements batch (by ID) */
export interface DeleteElementsBatch {
  entityIds?: string[];
  edgeIds?: string[];
}

/** Serialized flow state */
export interface FlowObject {
  entities: Entity[];
  edges: Edge[];
  viewport: Viewport;
}

/** Internal clipboard state */
export interface InternalClipboard {
  entities: Entity[];
  edges: Edge[];
}

/** Options for pasting from internal clipboard */
export interface PasteFromInternalOptions<T extends EntityData = EntityData> {
  /** Offset to apply to pasted entity positions. Default: { x: 50, y: 50 } */
  offset?: XYPosition;
  /** Transform function for entity data (for app-specific transformations) */
  transformData?: (data: T) => T;
  /**
   * Preserve external connections when pasting.
   * When true, edges connecting to non-copied entities will be recreated,
   * connecting the pasted entities to the original external entities.
   * Default: false (only internal edges are pasted)
   */
  preserveExternalConnections?: boolean;
}

// ============================================================================
// Font Types
// ============================================================================

// Re-export FontMetrics from text-layout for public API
export type { FontMetrics } from '../utils/text-layout';
import type { FontMetrics } from '../utils/text-layout';
export type {
  EvaluationMode,
  EvaluationStatus,
  EvaluationRecord,
  EvaluationContext,
  OnEvaluate,
  OnStatusChange,
} from '../core/evaluation';
import type { EvaluationMode, EvaluationStatus, OnEvaluate, OnStatusChange } from '../core/evaluation';

/** Built-in font presets with pre-generated MSDF atlases */
export type FontPreset = 'inter' | 'roboto' | 'source-serif' | 'system';

/** Font weight configuration for MSDF rendering */
export interface FontWeightConfig {
  /** MSDF font metrics */
  metrics: FontMetrics;
  /** MSDF atlas URL or base64 data URL */
  atlasUrl: string;
}

/** Custom font configuration */
export interface FontConfig {
  /** Font name for identification */
  name: string;
  /** Font weights configuration */
  weights: {
    regular: FontWeightConfig;
    semibold?: FontWeightConfig;
  };
}

// ============================================================================
// Styling Types (Milestone 2)
// ============================================================================

/** Entity size scale (matches Kookie UI Card) */
export type EntitySize = '1' | '2' | '3' | '4' | '5';

/** Entity visual variant (matches Kookie UI Card) */
export type EntityVariant = 'surface' | 'outline' | 'soft' | 'classic' | 'ghost';

/** Entity border radius style */
export type EntityRadius = 'none' | 'small' | 'medium' | 'large' | 'full';

/** Header position relative to entity body */
export type HeaderPosition = 'none' | 'inside' | 'outside';

/** 26 Kookie UI accent colors */
export type AccentColor =
  | 'gray'
  | 'gold'
  | 'bronze'
  | 'brown'
  | 'yellow'
  | 'amber'
  | 'orange'
  | 'tomato'
  | 'red'
  | 'ruby'
  | 'crimson'
  | 'pink'
  | 'plum'
  | 'purple'
  | 'violet'
  | 'iris'
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'jade'
  | 'green'
  | 'grass'
  | 'lime'
  | 'mint'
  | 'sky';

/** Style overrides for entities (fine-grained control) */
export interface EntityStyleOverrides {
  /** Background color (CSS color, converted to RGB for WebGL) */
  background?: string;
  /** Border color (CSS color) */
  borderColor?: string;
  /** Border width in pixels */
  borderWidth?: number;
  /** Border radius in pixels (overrides radius prop) */
  borderRadius?: number;
  /** Shadow level or 'none' */
  shadow?: '1' | '2' | '3' | '4' | '5' | '6' | 'none';
}

/** Minimap position */
export type MinimapPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

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
  /** Entity border radius style. Default: 'medium' */
  radius?: EntityRadius;
  /** Header position. Default: 'none' */
  header?: HeaderPosition;
  /**
   * Draw a thin `--accent-9` light along every entity's top edge, whatever `header` is. An
   * entity's own `color` draws the same band in its hue. Default: false
   */
  accentHeader?: boolean;
  /** Fine-grained style overrides */
  entityStyle?: Partial<EntityStyleOverrides>;

  // ============================================================================
  // Widget Props (Phase 7D)
  // ============================================================================

  /** Custom widget components (keyed by widget type name) */
  widgetTypes?: Record<string, React.ComponentType<WidgetProps>>;
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
  /** Default entity width when entity.width is not specified. Default: 240 */
  defaultEntityWidth?: number;
  /** Width reserved for socket labels before widget starts. Default: 96 */
  socketLabelWidth?: number;
  /**
   * A component to wrap each widget in — an opaque escape hatch for consumer-owned theming.
   *
   * PER-ENTITY ACCENT IS NO LONGER EXPRESSIBLE, and this prop's shape changed to say so. It used
   * to pass `accentColor`, `hasBackground` and `asChild` to a KookieUI v1 `Theme`. KookieUI v2
   * refuses all three as compile errors: it has ONE app-wide accent generated from config, and
   * its neutrals derive their hue FROM that accent — so a per-subtree accent would mean a
   * per-subtree palette, which is the thing v2 deliberately does not have. `hasBackground` simply
   * disappears: v2 paints no page background in any direction, ever.
   *
   * What survives is the wrapper itself, typed to the one thing every wrapper needs. A consumer
   * who wants per-widget theming states it in their own component.
   *
   * An entity's colour still reaches the graph — it drives the node header and selection in GL
   * through `entity.color` — it just no longer re-themes the DOM widgets sitting on it.
   *
   * @example
   * ```tsx
   * import { Theme } from '@kookie-ui/react';
   * <KookieFlow ThemeComponent={Theme} ... />
   * ```
   */
  ThemeComponent?: React.ComponentType<{ children: React.ReactNode }>;
}

// ============================================================================
// Imperative API Types
// ============================================================================

/** Options for fitView() */
export interface FitViewOptions {
  /** Padding around the content in pixels. Default: 50 */
  padding?: number;
  /** Whether to include hidden entities in the bounds calculation. Default: true */
  includeHiddenEntities?: boolean;
  /** Minimum zoom level for the fit. Default: uses component's minZoom */
  minZoom?: number;
  /** Maximum zoom level for the fit. Default: 1 (won't zoom in past 100%) */
  maxZoom?: number;
  /** Specific entities to fit (by ID). If not provided, fits all entities. */
  entities?: string[];
  /** Animation duration in ms. 0 = instant. Default: 0 */
  duration?: number;
}

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

  // ============================================================================
  // Evaluation API (Phase 8.5)
  // ============================================================================

  /** Run one entity now, whatever its mode, then cascade downstream. The manual trigger. */
  evaluate: (entityId: string) => Promise<void>;
  /** Run every dirty entity, manual gates included, and resolve when the graph is quiet. */
  evaluateDirty: () => Promise<void>;
  /** Mark everything stale and run all of it. */
  evaluateAll: () => Promise<void>;
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
  getGroupBounds: (groupId: string) => { x: number; y: number; width: number; height: number } | null;
}
