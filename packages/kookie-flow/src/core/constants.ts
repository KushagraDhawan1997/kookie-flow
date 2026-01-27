/** Default node dimensions */
export const DEFAULT_NODE_WIDTH = 240;

/** Widget layout: space reserved for socket label before widget starts */
export const SOCKET_LABEL_WIDTH = 96;
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
  // Primitive types with widgets
  float: { name: 'Float', color: '--teal-9', widget: 'slider' as const, min: 0, max: 1, step: 0.01 },
  int: { name: 'Integer', color: '--blue-9', widget: 'number' as const, min: 0, max: 100, step: 1 },
  boolean: { name: 'Boolean', color: '--orange-9', widget: 'checkbox' as const },
  string: { name: 'String', color: '--green-9', widget: 'text' as const },
  color: { name: 'Color', color: '--pink-9', widget: 'color' as const },
  enum: { name: 'Enum', color: '--amber-9', widget: 'select' as const },
  // Connection-only types (no widget)
  image: { name: 'Image', color: '--purple-9' },
  mesh: { name: 'Mesh', color: '--violet-9' },
  signal: { name: 'Signal', color: '--cyan-9' },
  any: { name: 'Any', color: '--gray-9' },
  mask: { name: 'Mask', color: '--gray-12' },
  // ML-specific types (no widget)
  latent: { name: 'Latent', color: '--cyan-9' },
  model: { name: 'Model', color: '--cyan-9' },
  conditioning: { name: 'Conditioning', color: '--amber-9' },
  clip: { name: 'CLIP', color: '--amber-9' },
  vae: { name: 'VAE', color: '--red-9' },
};

/** Auto-scroll settings */
export const AUTO_SCROLL_EDGE_THRESHOLD = 50; // pixels from edge to trigger
export const AUTO_SCROLL_MAX_SPEED = 15; // screen pixels per frame at max proximity

/** Minimap defaults (colors come from THEME_COLORS.minimap) */
export const MINIMAP_DEFAULTS = {
  width: 200,
  height: 150,
  padding: 20,
  viewportBorderWidth: 1,
  minNodeSize: 2,
  /** Base scale for zoomable mode (minimap zoom = viewport.zoom * baseScale) */
  zoomableBaseScale: 0.15,
} as const;
