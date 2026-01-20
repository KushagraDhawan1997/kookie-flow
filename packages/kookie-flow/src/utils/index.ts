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
  layoutText,
  countGlyphs,
  populateGlyphBuffers,
} from './text-layout';
