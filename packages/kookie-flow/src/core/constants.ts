/** Default node dimensions */
export const DEFAULT_NODE_WIDTH = 200;
export const DEFAULT_NODE_HEIGHT = 100;

/** Default viewport */
export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 1,
};

/** Zoom limits */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** Grid settings */
export const DEFAULT_GRID_SIZE = 20;
export const DEFAULT_SNAP_GRID: [number, number] = [20, 20];

/** Socket visual settings */
export const SOCKET_RADIUS = 6;
export const SOCKET_SPACING = 24;
export const SOCKET_MARGIN_TOP = 30;
export const SOCKET_HIT_TOLERANCE = 4;

/**
 * Default socket types with colors using theme token keys.
 * Colors starting with '--' are resolved from Kookie UI theme tokens.
 * Hex colors are used as-is (for backwards compatibility).
 *
 * Common types (diverse colors): image, string, int, float, boolean, mesh
 * ML-specific (cyan): latent, model
 * ML text-related (amber): conditioning, clip
 */
export const DEFAULT_SOCKET_TYPES = {
  // Common types - maximally diverse colors
  image: { name: 'Image', color: '--purple-9' },
  string: { name: 'String', color: '--green-9' },
  int: { name: 'Integer', color: '--blue-9' },
  float: { name: 'Float', color: '--teal-9' },
  boolean: { name: 'Boolean', color: '--orange-9' },
  mesh: { name: 'Mesh', color: '--pink-9' },
  // Neutral/utility types
  any: { name: 'Any', color: '--gray-9' },
  mask: { name: 'Mask', color: '--gray-12' },
  // ML-specific types (cyan for less common)
  latent: { name: 'Latent', color: '--cyan-9' },
  model: { name: 'Model', color: '--cyan-9' },
  // ML text-related types (amber)
  conditioning: { name: 'Conditioning', color: '--amber-9' },
  clip: { name: 'CLIP', color: '--amber-9' },
  vae: { name: 'VAE', color: '--red-9' },
} as const;

/** Auto-scroll settings */
export const AUTO_SCROLL_EDGE_THRESHOLD = 50; // pixels from edge to trigger
export const AUTO_SCROLL_MAX_SPEED = 15; // screen pixels per frame at max proximity

/** Minimap defaults */
export const MINIMAP_DEFAULTS = {
  width: 200,
  height: 150,
  padding: 20,
  backgroundColor: 'rgba(20, 20, 20, 0.9)',
  nodeColor: '#666666',
  selectedNodeColor: '#6366f1',
  viewportColor: 'rgba(99, 102, 241, 0.3)',
  viewportBorderColor: '#6366f1',
  viewportBorderWidth: 2,
  minNodeSize: 2,
  /** Base scale for zoomable mode (minimap zoom = viewport.zoom * baseScale) */
  zoomableBaseScale: 0.15,
} as const;
