// Components
export { KookieFlow } from './components/kookie-flow';
export { FlowProvider, useFlowStore, useFlowStoreApi } from './components/context';

// Hooks
export { useGraph } from './hooks/use-graph';

// Utilities
export {
  screenToWorld,
  worldToScreen,
  isPointInNode,
  getNodeAtPosition,
  getNodesInBox,
  getSocketPosition,
  getSocketAtPosition,
} from './utils/geometry';

export { isSocketCompatible } from './utils/connections';

// Types
export type {
  XYPosition,
  Dimensions,
  Viewport,
  EdgeType,
  SocketType,
  Socket,
  SocketHandle,
  NodeData,
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
  NodeTypeDefinition,
  NodeComponentProps,
  KookieFlowProps,
} from './types';

// Constants
export {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_VIEWPORT,
  DEFAULT_SOCKET_TYPES,
  SOCKET_RADIUS,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
  NODE_COLORS,
  GRID_COLORS,
  EDGE_COLORS,
} from './core/constants';
