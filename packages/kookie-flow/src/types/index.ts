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

/** Entity status for visual feedback */
export type EntityStatus = 'error' | 'warning' | 'running' | 'success';

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
}

/** Data for image entities */
export interface ImageEntityData extends EntityData {
  /** Image source URL or data URL */
  src?: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Object fit mode */
  objectFit?: 'contain' | 'cover' | 'fill';
}

/** Data for video entities */
export interface VideoEntityData extends EntityData {
  /** Video source URL */
  src?: string;
  /** Poster frame URL */
  poster?: string;
  /** Whether to autoplay */
  autoplay?: boolean;
  /** Whether to loop */
  loop?: boolean;
}

/** Data for 3D mesh entities */
export interface MeshEntityData extends EntityData {
  /** URL to glTF/GLB file */
  src?: string;
  /** Camera position for the 3D viewport */
  cameraPosition?: { x: number; y: number; z: number };
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

/** Entity type definition for custom rendering */
export interface EntityTypeDefinition<T extends EntityData = EntityData> {
  /** Entity type identifier */
  type: string;
  /** Display label */
  label?: string;
  /** Default dimensions */
  defaultWidth?: number;
  defaultHeight?: number;
  /** Input sockets */
  inputs?: Omit<Socket, 'id'>[];
  /** Output sockets */
  outputs?: Omit<Socket, 'id'>[];
  /** Preview configuration */
  preview?: {
    type: 'image' | 'mesh' | 'custom';
    source?: string;
  };
  /** Custom React component for hybrid mode */
  component?: React.ComponentType<EntityComponentProps<T>>;
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

/** Text rendering mode */
export type TextRenderMode = 'dom' | 'webgl';

// ============================================================================
// Font Types
// ============================================================================

// Re-export FontMetrics from text-layout for public API
export type { FontMetrics } from '../utils/text-layout';
import type { FontMetrics } from '../utils/text-layout';

/** Built-in font presets with pre-generated MSDF atlases */
export type FontPreset = 'google-sans' | 'inter' | 'roboto' | 'source-serif' | 'system';

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
   * Text rendering mode.
   * - 'dom': Uses DOM elements (default, backwards compatible)
   * - 'webgl': Uses instanced MSDF rendering (better performance at scale)
   * Default: 'dom'
   */
  textRenderMode?: TextRenderMode;
  /**
   * Font for WebGL text rendering. DOM mode uses --font-sans CSS variable from Kookie UI.
   * - Preset name: 'google-sans' | 'inter' | 'roboto' | 'source-serif' | 'system'
   * - Custom config: { name, weights: { regular, semibold? } } with MSDF metrics/atlas
   * Default: 'google-sans'
   */
  font?: FontPreset | FontConfig;
  /** Scale text with zoom (true = text scales, false = text stays crisp). Default: false. Only applies to DOM mode. */
  scaleTextWithZoom?: boolean;
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
  /** Additional class name */
  className?: string;
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
  /** Tint header with accent color. Default: false */
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
  /** Show widgets on unconnected input sockets. Default: true */
  showWidgets?: boolean;
  /** Default entity width when entity.width is not specified. Default: 240 */
  defaultEntityWidth?: number;
  /** Width reserved for socket labels before widget starts. Default: 96 */
  socketLabelWidth?: number;
  /**
   * Kookie UI Theme component for per-entity accent color support.
   * Pass `Theme` from @kushagradhawan/kookie-ui to enable widget theming.
   * When provided, widgets on entities with `color` prop will use that accent color.
   *
   * @example
   * ```tsx
   * import { Theme } from '@kushagradhawan/kookie-ui';
   * <KookieFlow ThemeComponent={Theme} ... />
   * ```
   */
  ThemeComponent?: React.ComponentType<{
    accentColor?: AccentColor;
    hasBackground?: boolean;
    children: React.ReactNode;
  }>;
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
