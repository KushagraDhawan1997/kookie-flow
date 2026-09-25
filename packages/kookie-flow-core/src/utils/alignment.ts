/**
 * Alignment guides: the lines that appear while you drag a node past another one.
 *
 * The rule is the one every design tool uses. Six lines matter on each axis — the two edges and
 * the centre of the thing being moved, against the two edges and the centre of everything else —
 * and when one comes within a few pixels of another, the drag SNAPS to it and a line is drawn
 * saying why.
 *
 * Two decisions worth stating, because both are how this stops being annoying:
 *
 *   THE TOLERANCE IS IN SCREEN PIXELS, not world units. Zoomed out, a world pixel is a fraction of
 *   a screen pixel, and a fixed world tolerance means every node in a district snaps at once.
 *
 *   ONE SNAP PER AXIS. The closest candidate wins and the rest are ignored, so a node cannot be
 *   pulled two ways at once and left between them.
 *
 * It writes its results into arrays the caller owns and returns one reused offset, so a drag
 * allocates nothing.
 */

export interface AlignRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How close, in SCREEN pixels, two lines have to be before one snaps to the other. */
export const ALIGN_TOLERANCE_PX = 6;

export interface AlignResult {
  /** How far to move the dragged rect to sit on the lines it snapped to. */
  dx: number;
  dy: number;
}

/** The three lines of a rect on each axis: near edge, centre, far edge. */
function linesX(r: AlignRect, out: [number, number, number]): [number, number, number] {
  out[0] = r.x;
  out[1] = r.x + r.width / 2;
  out[2] = r.x + r.width;
  return out;
}

function linesY(r: AlignRect, out: [number, number, number]): [number, number, number] {
  out[0] = r.y;
  out[1] = r.y + r.height / 2;
  out[2] = r.y + r.height;
  return out;
}

const movingX: [number, number, number] = [0, 0, 0];
const movingY: [number, number, number] = [0, 0, 0];
const otherX: [number, number, number] = [0, 0, 0];
const otherY: [number, number, number] = [0, 0, 0];
/** Returned by every call, rewritten each time: read it before the next call. */
const result: AlignResult = { dx: 0, dy: 0 };

/**
 * Find what the dragged rect should line up with.
 *
 * `verticals` and `horizontals` are cleared and filled with the WORLD coordinates of the lines to
 * draw. The returned offset is what to add to the rect's position so it sits on them.
 */
export function findAlignment(
  moving: AlignRect,
  others: readonly AlignRect[],
  zoom: number,
  verticals: number[],
  horizontals: number[],
  /** How many of `others` are live. A caller that pools its rects passes the pool and a count. */
  count: number = others.length
): AlignResult {
  verticals.length = 0;
  horizontals.length = 0;
  const tolerance = ALIGN_TOLERANCE_PX / Math.max(zoom, 0.0001);

  linesX(moving, movingX);
  linesY(moving, movingY);

  let bestDx = 0;
  let bestX = Infinity;
  let bestDy = 0;
  let bestY = Infinity;
  let snapX = 0;
  let snapY = 0;

  for (let k = 0; k < count; k++) {
    const other = others[k];
    if (other.id === moving.id) continue;
    linesX(other, otherX);
    linesY(other, otherY);

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const distX = Math.abs(movingX[i] - otherX[j]);
        if (distX <= tolerance && distX < bestX) {
          bestX = distX;
          bestDx = otherX[j] - movingX[i];
          snapX = otherX[j];
        }
        const distY = Math.abs(movingY[i] - otherY[j]);
        if (distY <= tolerance && distY < bestY) {
          bestY = distY;
          bestDy = otherY[j] - movingY[i];
          snapY = otherY[j];
        }
      }
    }
  }

  // The lines to DRAW are found in a second pass, against the snapped position: a guide is a
  // claim that these two things are aligned, so it may only be drawn where they now are.
  if (bestX < Infinity) {
    verticals.push(snapX);
    for (let k = 0; k < count; k++) {
      const other = others[k];
      if (other.id === moving.id) continue;
      linesX(other, otherX);
      for (let j = 0; j < 3; j++) {
        if (Math.abs(otherX[j] - snapX) < 0.5 && !verticals.includes(otherX[j])) {
          verticals.push(otherX[j]);
        }
      }
    }
  }
  if (bestY < Infinity) {
    horizontals.push(snapY);
    for (let k = 0; k < count; k++) {
      const other = others[k];
      if (other.id === moving.id) continue;
      linesY(other, otherY);
      for (let j = 0; j < 3; j++) {
        if (Math.abs(otherY[j] - snapY) < 0.5 && !horizontals.includes(otherY[j])) {
          horizontals.push(otherY[j]);
        }
      }
    }
  }

  result.dx = bestX < Infinity ? bestDx : 0;
  result.dy = bestY < Infinity ? bestDy : 0;
  return result;
}

/** Whether two guide sets are the same, so the store is not woken for a frame that changed none. */
export function sameGuides(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
