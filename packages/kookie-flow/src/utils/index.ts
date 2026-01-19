export {
  screenToWorld,
  worldToScreen,
  isPointInNode,
  getNodeAtPosition,
  boxesIntersect,
  getNodesInBox,
  getSocketPosition,
  getSocketAtPosition,
  getEdgeAtPosition,
  getEdgePointAtT,
  getEdgeEndpoints,
  type EdgePointResult,
  type SocketIndexMap,
} from './geometry';

export { isSocketCompatible } from './connections';

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
  layoutText,
  countGlyphs,
  populateGlyphBuffers,
} from './text-layout';
