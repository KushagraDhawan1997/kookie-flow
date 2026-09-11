/**
 * A freehand stroke, turned into triangles.
 *
 * A pen on a canvas produces a hundred points a second, most of which say nothing — a hand moving
 * in a straight line still reports every frame. So a stroke is SIMPLIFIED as it is stored (the
 * points a person would have drawn, not the ones the mouse happened to emit) and then EXPANDED
 * into a ribbon of triangles for the GPU, which has no idea what a line is.
 *
 * Points are stored flat — x, y, x, y — and relative to the entity's own top-left, so moving the
 * entity is moving one position rather than rewriting the stroke.
 *
 * Everything here is arithmetic on numbers, so the shape of a stroke is decided in tests.
 */

/** How far a point may sit from the line between its neighbours before it is worth keeping. */
export const SIMPLIFY_TOLERANCE = 1.2;

/**
 * Drop the points that say nothing, by Ramer–Douglas–Peucker.
 *
 * The classic algorithm, and the right one here: it keeps corners — the parts of a stroke that
 * carry its shape — and throws away the middle of straight runs, which is where the volume is.
 */
export function simplifyStroke(points: readonly number[], tolerance = SIMPLIFY_TOLERANCE): number[] {
  const count = points.length / 2;
  if (count <= 2) return points.slice();

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;

  // Iterative rather than recursive: a long stroke is thousands of points, and a hand-drawn one
  // can be pathological enough to bottom out a call stack.
  const stack: Array<[number, number]> = [[0, count - 1]];
  const toleranceSq = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last <= first + 1) continue;

    const ax = points[first * 2];
    const ay = points[first * 2 + 1];
    const bx = points[last * 2];
    const by = points[last * 2 + 1];

    let farthest = -1;
    let farthestDistSq = 0;
    for (let i = first + 1; i < last; i++) {
      const distSq = pointSegmentDistanceSq(points[i * 2], points[i * 2 + 1], ax, ay, bx, by);
      if (distSq > farthestDistSq) {
        farthestDistSq = distSq;
        farthest = i;
      }
    }

    if (farthest >= 0 && farthestDistSq > toleranceSq) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

function pointSegmentDistanceSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const ox = px - ax;
    const oy = py - ay;
    return ox * ox + oy * oy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ox = px - cx;
  const oy = py - cy;
  return ox * ox + oy * oy;
}

/** The box a stroke occupies, with room for its own thickness. */
export function strokeBounds(
  points: readonly number[],
  width: number
): { x: number; y: number; width: number; height: number } {
  if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = width / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + width,
    height: maxY - minY + width,
  };
}

/**
 * The ribbon: two vertices per point, offset either side of the line by half its width.
 *
 * A joint takes the average of the directions either side of it, which is a MITRE without the
 * spike: at a sharp corner the average shortens rather than shooting off, so a scribble stays a
 * scribble instead of growing a whisker at every reversal. The cost is a slightly pinched corner
 * at very sharp angles, which nobody has ever noticed in ink.
 *
 * Written into `out` if one is given and large enough, so redrawing a stroke while it is being
 * drawn allocates nothing.
 */
export function buildStrokeRibbon(
  points: readonly number[],
  width: number,
  out?: Float32Array
): { vertices: Float32Array; count: number } {
  const count = points.length / 2;
  const half = width / 2;
  const needed = count * 2 * 3;
  const vertices = out && out.length >= needed ? out : new Float32Array(needed);

  if (count === 0) return { vertices, count: 0 };
  if (count === 1) {
    /**
     * A dot. A single point is a stroke someone made by tapping, and drawing nothing for it makes
     * the pen look broken.
     *
     * Emitted as TWO pairs — a square — rather than one, because a pair is only half a quad and
     * the index list below turns pairs into triangles. One pair would draw nothing at all.
     */
    const x = points[0];
    const y = points[1];
    const square = out && out.length >= 12 ? out : new Float32Array(12);
    square[0] = x - half; square[1] = y - half; square[2] = 0;
    square[3] = x - half; square[4] = y + half; square[5] = 0;
    square[6] = x + half; square[7] = y - half; square[8] = 0;
    square[9] = x + half; square[10] = y + half; square[11] = 0;
    return { vertices: square, count: 4 };
  }

  for (let i = 0; i < count; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];

    let nx = 0;
    let ny = 0;
    if (i > 0) {
      const dx = x - points[(i - 1) * 2];
      const dy = y - points[(i - 1) * 2 + 1];
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
    }
    if (i < count - 1) {
      const dx = points[(i + 1) * 2] - x;
      const dy = points[(i + 1) * 2 + 1] - y;
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
    }
    const len = Math.hypot(nx, ny) || 1;
    nx = (nx / len) * half;
    ny = (ny / len) * half;

    const base = i * 6;
    vertices[base] = x + nx;
    vertices[base + 1] = y + ny;
    vertices[base + 2] = 0;
    vertices[base + 3] = x - nx;
    vertices[base + 4] = y - ny;
    vertices[base + 5] = 0;
  }

  return { vertices, count: count * 2 };
}

/**
 * Whether a point is on a stroke — the hit test for selecting one.
 *
 * Segment by segment, because a stroke's bounding box is mostly not the stroke: a diagonal line
 * fills a corner of its box and nothing else, and clicking that corner should select what is
 * behind it.
 */
export function isPointOnStroke(
  points: readonly number[],
  width: number,
  px: number,
  py: number
): boolean {
  const count = points.length / 2;
  if (count === 0) return false;
  const reach = width / 2 + 2;
  const reachSq = reach * reach;
  if (count === 1) {
    const dx = px - points[0];
    const dy = py - points[1];
    return dx * dx + dy * dy <= reachSq;
  }
  for (let i = 0; i < count - 1; i++) {
    const distSq = pointSegmentDistanceSq(
      px, py,
      points[i * 2], points[i * 2 + 1],
      points[(i + 1) * 2], points[(i + 1) * 2 + 1]
    );
    if (distSq <= reachSq) return true;
  }
  return false;
}

/**
 * The triangles that turn a ribbon's vertex pairs into a surface.
 *
 * Two triangles per segment, wound the same way, since the material draws both sides anyway. Kept
 * out of `buildStrokeRibbon` because it depends only on how MANY points there are: a stroke being
 * drawn re-uploads its vertices every frame and its indices only when it gains a point.
 */
export function strokeIndices(vertexCount: number): Uint32Array {
  const pairs = Math.floor(vertexCount / 2);
  if (pairs < 2) return new Uint32Array(0);
  const indices = new Uint32Array((pairs - 1) * 6);
  let at = 0;
  for (let i = 0; i < pairs - 1; i++) {
    const a = i * 2;
    indices[at++] = a;
    indices[at++] = a + 1;
    indices[at++] = a + 2;
    indices[at++] = a + 1;
    indices[at++] = a + 3;
    indices[at++] = a + 2;
  }
  return indices;
}

/**
 * A stroke at a new width, as the entity changes that keep its ink exactly where it is.
 *
 * The box is padded by half the width on every side and the points are stored relative to that
 * box, so a new width is three changes, not one: the box grows by the difference, its corner moves
 * out by half of it, and every point shifts in by the same half. Changing only `strokeWidth` left
 * a thicker line spilling past a box that no longer held it — the selection ring cut through it and
 * the edge of the ink could not be clicked.
 */
export function restroke(
  position: { x: number; y: number },
  points: readonly number[],
  width: number,
  newWidth: number
): { position: { x: number; y: number }; width: number; height: number; points: number[] } {
  const shift = (newWidth - width) / 2;
  const shifted = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) shifted[i] = points[i] + shift;
  const box = strokeBounds(shifted, newWidth);
  return {
    position: { x: position.x - shift, y: position.y - shift },
    width: box.width,
    height: box.height,
    points: shifted,
  };
}
