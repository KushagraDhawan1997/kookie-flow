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
export {
  StyleProvider,
  useEntityStyle,
  useResolvedStyle,
  useSocketLayout,
  type StyleConfig,
  type StyleContextValue,
} from './contexts';
export {
  FontProvider,
  useFont,
  type FontContextValue,
  type LoadedFontWeight,
} from './contexts';

// Utilities
export {
  screenToWorld,
  worldToScreen,
  isPointInEntity,
  getEntityAtPosition,
  getEntitiesInBox,
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
  rgbToHex,
  hexToRGB,
  parseColorToRGB,
  parseColorToRGBA,
  resolveColorToRGB,
  resolveColorToRGBA,
  parsePx,
} from './utils/color';

// Socket type utilities
export { resolveSocketTypes } from './utils/socket-types';

// Style resolution utilities
export {
  SIZE_MAP,
  VARIANT_MAP,
  RADIUS_MAP,
  SOCKET_ROW_HEIGHT_TOKEN,
  WIDGET_HEIGHT_TOKEN,
  resolveEntityStyle,
  resolveSocketLayout,
  calculateMinEntityHeight,
  type ResolvedEntityStyle,
  type ResolvedSocketLayout,
} from './utils/style-resolver';

// Store types
export type { FlowState, FlowStore } from './core/store';

// Graph engine
export type { AdjacencyIndex, CachedAnalysis, GraphValidationIssue } from './core/graph';
export {
  buildAdjacencyIndex,
  getIncomers,
  getOutgoers,
  getEntityEdges,
  getInputEdges,
  getOutputEdges,
  getEdgesBetween,
  walkUpstream,
  walkDownstream,
  computeAnalysis,
  wouldCreateCycle as wouldCreateGraphCycle,
  getAffectedEntities,
  getConnectedComponents,
  areConnected,
  getExecutionOrder,
  getReadyEntities,
  computeInsertOnEdge,
  computeBypass,
  validate as validateGraph,
  isGraphComplete,
  getCompatiblePorts,
  computeCollapseToSubgraph,
  computeExpandSubgraph,
} from './core/graph';

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
  EntityData,
  Entity,
  EntityStatus,
  Edge,
  Connection,
  ConnectionMode,
  ConnectionValidationParams,
  IsValidConnectionFn,
  OnConnectStartParams,
  ConnectionEndState,
  EntityChange,
  EdgeChange,
  EntityTypeDefinition,
  EntityComponentProps,
  KookieFlowProps,
  // Styling types
  EntitySize,
  EntityVariant,
  EntityRadius,
  HeaderPosition,
  AccentColor,
  EntityStyleOverrides,
  // Widget types
  WidgetType,
  WidgetProps,
  InlineWidgetComponent,
  ResolvedWidgetConfig,
  SocketLayoutMode,
  // Clone/paste types
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
  // Font types
  FontPreset,
  FontConfig,
  FontWeightConfig,
  FontMetrics,
  // Imperative API types
  FitViewOptions,
  KookieFlowInstance,
  // Entity type definitions
  BuiltInEntityType,
  FrameEntityData,
  CommentEntityData,
  RerouteEntityData,
  DrawEntityData,
  TextEntityData,
  ImageEntityData,
  VideoEntityData,
  MeshEntityData,
  FrameEntity,
  CommentEntity,
  RerouteEntity,
  DrawEntity,
  TextEntity,
  ImageEntity,
  VideoEntity,
  MeshEntity,
} from './types';

// Entity type guards
export {
  isFrameEntity,
  isCommentEntity,
  isRerouteEntity,
  isTextEntity,
  isImageEntity,
} from './types';

// Text entity utilities
export { resolveTextStyle } from './utils/text-texture';
export type { TextStyleConfig } from './utils/text-texture';

// Grouping utilities
export {
  GROUP_PADDING,
  MIN_GROUP_WIDTH,
  MIN_GROUP_HEIGHT,
  getGroupChildren,
  getGroupDescendants,
  isEntityHidden,
  getVisibleEntities,
  calculateGroupBounds,
  getParentChain,
  isDescendantOf,
  calculateDescendantPositions,
  getAncestorGroups,
  wouldCreateCycle,
  getTopLevelEntities,
  sortByDepth,
  type Bounds,
} from './utils/grouping';

// Constants
export {
  DEFAULT_ENTITY_WIDTH,
  DEFAULT_ENTITY_HEIGHT,
  DEFAULT_VIEWPORT,
  DEFAULT_SOCKET_TYPES,
  SOCKET_RADIUS,
  SOCKET_OFFSET,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
  SOCKET_LABEL_WIDTH,
  MINIMAP_DEFAULTS,
  STACKED_LABEL_HEIGHT,
  STACKED_GAP,
  MIN_ENTITY_WIDTH,
  MIN_ENTITY_HEIGHT,
  MIN_FRAME_WIDTH,
  MIN_FRAME_HEIGHT,
  MIN_COMMENT_WIDTH,
  MIN_COMMENT_HEIGHT,
  RESIZE_HANDLE_SIZE,
  SELECTION_OUTLINE_WIDTH,
  SELECTION_OUTLINE_PADDING,
  HOVER_OUTLINE_WIDTH,
} from './core/constants';

// Socket layout cache (for custom renderers)
export {
  getEntitySocketLayout,
  clearEntityLayoutCache,
  type ComputedSocketPosition,
  type EntitySocketLayoutCache,
} from './utils/socket-layout-cache';

// Semantic theme colors
export { THEME_COLORS, resolveColor, type ColorTokenKey } from './core/theme-colors';
