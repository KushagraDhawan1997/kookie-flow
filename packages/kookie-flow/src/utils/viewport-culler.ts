import type { Quadtree, Bounds } from '../core/spatial';
import { CameraGate, type CullRect } from './viewport-cull';

/**
 * The set of entities one GL layer is currently drawing, and the bookkeeping that keeps a pan from
 * re-deriving it.
 *
 * WHAT THIS REPLACES, in four frame loops. Each one held `for (const entity of entities)` followed
 * by a four-sided box test, and ran it on every frame its dirty flag was set — which the viewport
 * subscription set on every pointermove of a pan. So the cost of moving the camera one pixel was
 * O(graph) per layer, four times over, to arrive at almost exactly the set the previous frame had
 * already computed. At ten thousand nodes that is forty thousand box tests a frame for a screen
 * holding a few dozen cards.
 *
 * Two independent savings, and both are needed:
 *
 *  1. THE QUERY IS SPATIAL. The quadtree skips whole quadrants, so collecting costs what is
 *     visible plus the depth walked to reach it, not what exists. This is the package's own rule
 *     — "spatial indexing, never iterate all nodes" — applied to the render loop, where it had
 *     only ever been applied to hit testing.
 *
 *  2. THE QUERY IS RARE. `CameraGate` collects for a rect wider than the screen and re-collects
 *     only once the screen slides out of it or the zoom crosses a band. Most frames of a pan ask
 *     and are told nothing changed, which lets the layer skip its rebuild AND its upload — the
 *     instance transforms are world space, so a pan invalidates none of them.
 *
 * Nothing here allocates after the first few frames: the id array is caller-owned, reused, and
 * never truncated, so it settles at the high-water mark. `count`, not `ids.length`, says how much
 * of it is live.
 *
 * THE CONTRACT A LAYER HAS TO KEEP. The camera is the only change this tracks. Anything that moves
 * an entity, adds one, removes one, or hides one must call `invalidate()` — in practice, wherever
 * the layer already sets its dirty flag. Skip that and a node dragged into view from off-screen
 * does not appear until the camera happens to escape the margin.
 */
export class ViewportCuller {
  /** Ids of the entities in the collected set. Only the first `count` entries are live. */
  readonly ids: string[] = [];
  count = 0;

  private readonly gate = new CameraGate();

  /** Scratch, reused: the query box handed to the quadtree. */
  private readonly query: Bounds = { x: 0, y: 0, width: 0, height: 0 };

  /**
   * The rect the current set was collected for — what a caller tests individual PARTS against.
   *
   * A layer that draws something smaller than an entity (one widget of several, a label on one
   * row) still culls those parts one by one, and it has to do it against the rect the set was
   * collected for rather than the visible screen: against the screen, a part just outside it
   * would be dropped on the frame it was collected and never looked at again until the camera
   * escaped the margin — which is the pop-in the margin exists to prevent.
   */
  get rect(): Readonly<CullRect> {
    return this.gate.rect;
  }

  /** The graph changed under the camera: the next `refresh` must re-collect. */
  invalidate(): void {
    this.gate.invalidate();
  }

  /**
   * Bring the set up to date, and say whether it moved.
   *
   * `padWorld` is the reach of anything an entity draws OUTSIDE its own box — a shadow, a halo, a
   * label hanging below it — in world units, so a caller holding a screen-pixel reach divides by
   * zoom first.
   *
   * @returns true when `ids`/`count` were rewritten, i.e. the layer has to rebuild.
   */
  refresh(
    quadtree: Quadtree,
    viewportX: number,
    viewportY: number,
    zoom: number,
    width: number,
    height: number,
    padWorld: number
  ): boolean {
    if (!this.gate.moved(viewportX, viewportY, zoom, width, height, padWorld)) {
      return false;
    }

    const rect = this.gate.rect;
    const q = this.query;
    q.x = rect.left;
    q.y = rect.top;
    q.width = rect.right - rect.left;
    q.height = rect.bottom - rect.top;
    this.count = quadtree.queryRangeInto(q, this.ids);
    return true;
  }
}
