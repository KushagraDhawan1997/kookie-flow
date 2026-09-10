/**
 * The controls a piece of media carries: a video's play bar, a mesh's drag strip.
 *
 * On by default, because a video you cannot pause is not a video and a model you cannot move is
 * a picture. Off by stating it — `data.controls: false`, `data.orbit: false` — which is the
 * shape the rest of this library uses for anything a product might reasonably not want.
 *
 * Everything here is geometry and arithmetic, in the entity's own coordinates, so where a press
 * lands can be tested without a browser. The DRAWING of the same shapes lives in the media
 * shader, and the two agree because both take their numbers from the constants below.
 */

/** How tall a video's control bar is, in world pixels. */
export const CONTROL_BAR_HEIGHT = 28;
/** The inset from the media's edges to the bar. */
export const CONTROL_BAR_INSET = 8;
/** The square the play/pause button occupies at the bar's left. */
export const CONTROL_BUTTON_SIZE = 20;
/** The gap between the button and the track. */
export const CONTROL_GAP = 8;

/**
 * The strip along the top of a model preview that MOVES the entity.
 *
 * A model needs the whole of its body for turning it, so the drag that moves the node has to
 * live somewhere else. A strip at the top is the same answer a window title bar gives, and the
 * one ComfyUI and every 3D inspector arrived at.
 */
export const MESH_DRAG_STRIP_HEIGHT = 24;

/** Radians of turn per world pixel dragged. A full drag across a 240px preview is about a turn. */
export const ORBIT_SPEED = 0.013;
/** How far up or down the camera may be pushed, so a model is never viewed from inside itself. */
export const ORBIT_MAX_PITCH = 1.2;

export interface VideoControlHit {
  /** `play` toggles; `seek` jumps to `t` and keeps seeking while the pointer is down. */
  kind: 'play' | 'seek';
  /** For a seek, where along the clip the press landed, 0..1. */
  t: number;
}

/** Whether a video this size can show controls at all. A bar in a thumbnail is a smudge. */
export function fitsControls(width: number, height: number): boolean {
  return width >= 120 && height >= 80;
}

/**
 * Where a press inside a video lands, in the entity's own coordinates (0,0 at its top-left).
 *
 * `null` means the press was not on the chrome, and belongs to whatever would have had it —
 * selecting the entity, or dragging it.
 */
export function hitVideoControls(
  localX: number,
  localY: number,
  width: number,
  height: number
): VideoControlHit | null {
  if (!fitsControls(width, height)) return null;

  const barTop = height - CONTROL_BAR_INSET - CONTROL_BAR_HEIGHT;
  const barBottom = height - CONTROL_BAR_INSET;
  if (localY < barTop || localY > barBottom) return null;

  const barLeft = CONTROL_BAR_INSET;
  const barRight = width - CONTROL_BAR_INSET;
  if (localX < barLeft || localX > barRight) return null;

  const buttonRight = barLeft + CONTROL_BUTTON_SIZE + CONTROL_GAP;
  if (localX <= buttonRight) return { kind: 'play', t: 0 };

  const trackLeft = buttonRight;
  const trackWidth = barRight - trackLeft;
  if (trackWidth <= 0) return { kind: 'play', t: 0 };
  return { kind: 'seek', t: clamp01((localX - trackLeft) / trackWidth) };
}

/** Where along the clip a pointer at this x sits, for a drag that started on the track. */
export function seekPositionAt(localX: number, width: number): number {
  const trackLeft = CONTROL_BAR_INSET + CONTROL_BUTTON_SIZE + CONTROL_GAP;
  const trackWidth = width - CONTROL_BAR_INSET - trackLeft;
  if (trackWidth <= 0) return 0;
  return clamp01((localX - trackLeft) / trackWidth);
}

/** Whether a press on a model preview is on the strip that moves it rather than turns it. */
export function isMeshDragStrip(localY: number, height: number): boolean {
  // A preview too short to spare a strip keeps its whole body for turning: the entity can still
  // be moved by its resize handles and by selecting it with the keyboard.
  if (height < MESH_DRAG_STRIP_HEIGHT * 3) return false;
  return localY >= 0 && localY <= MESH_DRAG_STRIP_HEIGHT;
}

/** The camera direction after a drag, as yaw around the model and pitch above it. */
export interface OrbitAngles {
  yaw: number;
  pitch: number;
}

export function orbitFromDrag(start: OrbitAngles, dx: number, dy: number): OrbitAngles {
  return {
    yaw: start.yaw + dx * ORBIT_SPEED,
    // Dragging DOWN looks from below: the pointer pushes the model, not the camera.
    pitch: clamp(start.pitch - dy * ORBIT_SPEED, -ORBIT_MAX_PITCH, ORBIT_MAX_PITCH),
  };
}

/**
 * The unit direction the camera sits along, for a given turn.
 *
 * Yaw turns around the model's up axis and pitch lifts the camera over it, so the camera stays on
 * a sphere around the model and `frameCamera` can put it at whatever distance the model's radius
 * asks for.
 */
export function orbitDirection(angles: OrbitAngles): { x: number; y: number; z: number } {
  const cosPitch = Math.cos(angles.pitch);
  return {
    x: Math.sin(angles.yaw) * cosPitch,
    y: Math.sin(angles.pitch),
    z: Math.cos(angles.yaw) * cosPitch,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
