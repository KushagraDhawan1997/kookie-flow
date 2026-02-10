export {
  screenToWorld,
  worldToScreen,
  isPointInEntity,
  getEntityAtPosition,
  boxesIntersect,
  getEntitiesInBox,
  getSocketPosition,
  getSocketAtPosition,
  getSocketAtPositionFast,
  getEdgeAtPosition,
  getEdgePointAtT,
  getEdgeEndpoints,
  type EdgePointResult,
  type SocketIndexMap,
} from './geometry';

export { isSocketCompatible } from './connections';

// Color parsing utilities
export {
  type RGBColor,
  type RGBAColor,
  hexToRGB,
  parseColorToRGB,
  parseColorToRGBA,
  parsePx,
} from './color';

// MSDF text rendering utilities
export {
  msdfVertexShader,
  msdfFragmentShader,
  msdfFragmentShaderWithOutline,
  MSDF_SHADER_DEFAULTS,
} from './msdf-shader';

export {
  type FontMetrics,
  type FontCommon,
  type FontInfo,
  type GlyphMetrics,
  type KerningPair,
  type TextEntry,
  type TextAnchor,
  type GlyphInstance,
  type GlyphMap,
  type KerningMap,
  buildGlyphMap,
  buildKerningMap,
  measureText,
  truncateText,
  clearTruncationCache,
  layoutText,
  countGlyphs,
  populateGlyphBuffers,
} from './text-layout';

// Style resolution utilities (Milestone 2)
export {
  SIZE_MAP,
  VARIANT_MAP,
  RADIUS_MAP,
  SOCKET_ROW_HEIGHT_TOKEN,
  WIDGET_HEIGHT_TOKEN,
  type ResolvedEntityStyle,
  type ResolvedSocketLayout,
  resolveEntityStyle,
  resolveSocketLayout,
  calculateMinEntityHeight,
} from './style-resolver';

// Widget utilities (Phase 7D)
export {
  resolveWidgetConfig,
  isSocketConnected,
  buildConnectedSocketsSet,
} from './widgets';

// Per-entity accent color utilities
export {
  NO_OVERRIDE_SENTINEL,
  resolveAccentColorRGB,
} from './accent-colors';

// Grouping utilities (Phase 7C)
export {
  GROUP_PADDING,
  MIN_GROUP_WIDTH,
  MIN_GROUP_HEIGHT,
  type Bounds,
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
} from './grouping';
