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
}

/** Edge connecting two nodes */
export interface Edge {
  id: string;
  source: string;
  target: string;
  sourceSocket?: string;
  targetSocket?: string;
  selected?: boolean;
  animated?: boolean;
}

/** Connection in progress */
export interface Connection {
  source: string | null;
  sourceSocket: string | null;
  target: string | null;
  targetSocket: string | null;
}

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
  /** Callback when empty space is clicked */
  onPaneClick?: () => void;
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
  /** Show performance stats (FPS counter) */
  showStats?: boolean;
  /** Scale text with zoom (true = text scales, false = text stays crisp). Default: false */
  scaleTextWithZoom?: boolean;
  /** Enable snap to grid */
  snapToGrid?: boolean;
  /** Grid snap size */
  snapGrid?: [number, number];
  /** Additional class name */
  className?: string;
  /** Children (for overlays) */
  children?: React.ReactNode;
}
