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

/** Socket type definition */
export interface SocketType {
  color: string;
  name: string;
}

/** Socket definition on a node */
export interface Socket {
  id: string;
  name: string;
  type: string;
  /** Position relative to node (0 = top, 1 = bottom) */
  position?: number;
}

/** Socket handle for identifying a specific socket on a node */
export interface SocketHandle {
  nodeId: string;
  socketId: string;
  isInput: boolean;
}

/** Base node data */
export interface NodeData {
  label?: string;
  [key: string]: unknown;
}

/** Node in the graph */
export interface Node<T extends NodeData = NodeData> {
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
  /** Per-node accent color override (matches Kookie UI accent colors) */
  color?: AccentColor;
}

/** Edge connecting two nodes */
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

/** Node change event */
export type NodeChange =
  | { type: 'position'; id: string; position: XYPosition }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'add'; node: Node }
  | { type: 'dimensions'; id: string; dimensions: Dimensions };

/** Edge change event */
export type EdgeChange =
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'add'; edge: Edge };

/** Node type definition for custom rendering */
export interface NodeTypeDefinition<T extends NodeData = NodeData> {
  /** Node type identifier */
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
  component?: React.ComponentType<NodeComponentProps<T>>;
}

/** Props passed to custom node components */
export interface NodeComponentProps<T extends NodeData = NodeData> {
  id: string;
  data: T;
  selected: boolean;
  onChange: (data: Partial<T>) => void;
}

/** Options for cloning elements */
export interface CloneElementsOptions<T extends NodeData = NodeData> {
  /** Offset to apply to cloned node positions */
  offset?: XYPosition;
  /** Transform function for node data (for app-specific transformations) */
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
  /** Cloned nodes with new IDs */
  nodes: Node[];
  /** Cloned edges with new IDs and remapped node references */
  edges: Edge[];
  /** Map from old ID to new ID */
  idMap: Map<string, string>;
}

/** Elements batch (for add/delete operations) */
export interface ElementsBatch {
  nodes?: Node[];
  edges?: Edge[];
}

/** Delete elements batch (by ID) */
export interface DeleteElementsBatch {
  nodeIds?: string[];
  edgeIds?: string[];
}

/** Serialized flow state */
export interface FlowObject {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
}

/** Internal clipboard state */
export interface InternalClipboard {
  nodes: Node[];
  edges: Edge[];
}

/** Options for pasting from internal clipboard */
export interface PasteFromInternalOptions<T extends NodeData = NodeData> {
  /** Offset to apply to pasted node positions. Default: { x: 50, y: 50 } */
  offset?: XYPosition;
  /** Transform function for node data (for app-specific transformations) */
  transformData?: (data: T) => T;
  /**
   * Preserve external connections when pasting.
   * When true, edges connecting to non-copied nodes will be recreated,
   * connecting the pasted nodes to the original external nodes.
   * Default: false (only internal edges are pasted)
   */
  preserveExternalConnections?: boolean;
}

/** Text rendering mode */
export type TextRenderMode = 'dom' | 'webgl';

// ============================================================================
// Styling Types (Milestone 2)
// ============================================================================

/** Node size scale (matches Kookie UI Card) */
export type NodeSize = '1' | '2' | '3' | '4' | '5';

/** Node visual variant (matches Kookie UI Card) */
export type NodeVariant = 'surface' | 'outline' | 'soft' | 'classic' | 'ghost';

/** Node border radius style */
export type NodeRadius = 'none' | 'small' | 'medium' | 'large' | 'full';

/** Header position relative to node body */
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

/** Style overrides for nodes (fine-grained control) */
export interface NodeStyleOverrides {
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
  /** Node color (or function for per-node color). Default: from THEME_COLORS.minimap.node */
  nodeColor?: string | ((node: Node) => string);
  /** Selected node color. Default: from THEME_COLORS.minimap.nodeSelected */
  selectedNodeColor?: string;
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
   * - false (default): Shows all nodes at fixed scale, viewport indicator resizes
   * - true: Minimap zooms with main canvas, viewport indicator stays fixed size
   */
  zoomable?: boolean;
  /** Custom className for styling */
  className?: string;
}

/** KookieFlow component props */
export interface KookieFlowProps {
  /** Nodes in the graph */
  nodes: Node[];
  /** Edges connecting nodes */
  edges: Edge[];
  /** Node type definitions */
  nodeTypes?: Record<string, NodeTypeDefinition>;
  /** Socket type definitions */
  socketTypes?: Record<string, SocketType>;
  /** Callback when nodes change */
  onNodesChange?: (changes: NodeChange[]) => void;
  /** Callback when edges change */
  onEdgesChange?: (changes: EdgeChange[]) => void;
  /** Callback when a connection is made */
  onConnect?: (connection: Connection) => void;
  /** Callback when a node is clicked */
  onNodeClick?: (node: Node) => void;
  /** Callback when an edge is clicked */
  onEdgeClick?: (edge: Edge) => void;
  /** Callback when empty space is clicked */
  onPaneClick?: () => void;
  /** Whether edges can be selected by clicking. Default: true */
  edgesSelectable?: boolean;
  /** Connection validation mode. 'strict' enforces socket type compatibility. Default: 'loose' */
  connectionMode?: ConnectionMode;
  /** Custom connection validation function. Overrides connectionMode when provided. */
  isValidConnection?: IsValidConnectionFn;
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

  /** Node size scale. Default: '2' */
  size?: NodeSize;
  /** Node visual variant. Default: 'surface' */
  variant?: NodeVariant;
  /** Node border radius style. Default: 'medium' */
  radius?: NodeRadius;
  /** Header position. Default: 'none' */
  header?: HeaderPosition;
  /** Tint header with accent color. Default: false */
  accentHeader?: boolean;
  /** Fine-grained style overrides */
  nodeStyle?: Partial<NodeStyleOverrides>;
}
