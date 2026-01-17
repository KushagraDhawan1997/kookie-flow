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

/** Node colors */
export const NODE_COLORS = {
  background: '#1e1e1e',
  backgroundHovered: '#262626',
  backgroundSelected: '#2d2d2d',
  header: '#3d3d3d',
  border: '#4d4d4d',
  borderHovered: '#5d5d5d',
  borderSelected: '#6366f1',
} as const;

/** Default socket types with colors (similar to Blender/ComfyUI) */
export const DEFAULT_SOCKET_TYPES = {
  any: { name: 'Any', color: '#808080' },
  image: { name: 'Image', color: '#c7a0dc' },
  mask: { name: 'Mask', color: '#ffffff' },
  latent: { name: 'Latent', color: '#ff6b9d' },
  conditioning: { name: 'Conditioning', color: '#e5a84b' },
  model: { name: 'Model', color: '#7eca9c' },
  clip: { name: 'CLIP', color: '#ffd93d' },
  vae: { name: 'VAE', color: '#ff6b6b' },
  int: { name: 'Integer', color: '#6bcfff' },
  float: { name: 'Float', color: '#6bcfff' },
  string: { name: 'String', color: '#6bcfff' },
  boolean: { name: 'Boolean', color: '#ff9580' },
} as const;

/** Grid colors */
export const GRID_COLORS = {
  background: '#141414',
  lines: '#222222',
  linesAccent: '#2a2a2a',
} as const;

/** Edge colors */
export const EDGE_COLORS = {
  default: '#666666',
  selected: '#6366f1',
  connecting: '#888888',
  invalid: '#ff4444',
} as const;

/** Auto-scroll settings */
export const AUTO_SCROLL_EDGE_THRESHOLD = 50; // pixels from edge to trigger
export const AUTO_SCROLL_MAX_SPEED = 15; // screen pixels per frame at max proximity
