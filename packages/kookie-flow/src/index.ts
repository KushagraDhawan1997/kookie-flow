// Components
export { KookieFlow } from './components/kookie-flow';
export { FlowProvider, useFlowStore, useFlowStoreApi } from './components/context';
export { Minimap } from './components/minimap';

// Hooks
export { useGraph } from './hooks/use-graph';
export {
  useThemeTokens,
  FALLBACK_TOKENS,
  type ThemeTokens,
  type SimpleShadow,
} from './hooks/useThemeTokens';

// Contexts
export { ThemeProvider, useTheme } from './contexts';

// Utilities
export {
  screenToWorld,
  worldToScreen,
  isPointInNode,
  getNodeAtPosition,
  getNodesInBox,
  getSocketPosition,
  getSocketAtPosition,
  getEdgeAtPosition,
  getEdgePointAtT,
  getEdgeEndpoints,
  type SocketIndexMap,
  type EdgePointResult,
} from './utils/geometry';

export { isSocketCompatible, validateConnection, areTypesCompatible } from './utils/connections';

// Color utilities (for custom theme implementations)
export {
  type RGBColor,
  type RGBAColor,
  hexToRGB,
  parseColorToRGB,
  parseColorToRGBA,
  parsePx,
} from './utils/color';

// Store types
export type { FlowState, FlowStore } from './core/store';

// Types
export type {
  XYPosition,
  Dimensions,
  Viewport,
  EdgeType,
  EdgeMarkerType,
  EdgeMarker,
  EdgeLabelConfig,
  SocketType,
  Socket,
  SocketHandle,
  NodeData,
  Node,
  Edge,
  Connection,
  ConnectionMode,
  ConnectionValidationParams,
  IsValidConnectionFn,
  NodeChange,
  EdgeChange,
  NodeTypeDefinition,
  NodeComponentProps,
  KookieFlowProps,
  // Phase 6 types
  CloneElementsOptions,
  CloneElementsResult,
  ElementsBatch,
  DeleteElementsBatch,
  FlowObject,
  InternalClipboard,
  PasteFromInternalOptions,
  // Minimap types
  MinimapPosition,
  MinimapProps,
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
  MINIMAP_DEFAULTS,
} from './core/constants';
