/**
 * The rect a layer culls against, and the hysteresis that keeps a pan from re-deriving it.
 *
 * WHY THIS IS SHARED RATHER THAN PER LAYER. Every GL layer in this package culls to the viewport,
 * and every one of them used to re-derive its whole instance set on every pointermove of a pan:
 * the store bumps `viewport`, the layer's subscription sets a dirty flag, and the frame loop walks
 * the graph again. Instance transforms are WORLD SPACE — a pan moves the camera and not one of
 * them — so the only thing a pan can change is which instances survive the cull, and that answer
 * does not change for most of the frames of a gesture.
 *
 * text-renderer.tsx proved the fix first, on the layer with the most to lose — its dirty pass
 * re-wraps and re-kerns every visible string — and the shape it arrived at is the one here: collect
 * for a rect WIDER than the screen, and re-collect only once the screen has slid out of that rect.
 * The standing cost is (1 + 2f)^2 more instances drawn every frame; the saving is a full rebuild and
 * re-upload on roughly 1/f of the frames of a continuous pan. At f = 0.15 that is about 1.7x the
 * instances for something like a 10x cut in rebuilds — a trade that is worth taking on every layer
 * whose rebuild is O(graph), which is all of them.
 *
 * Nothing here allocates. Every function writes into a caller-owned rect, because all of them run
 * inside `useFrame`.
 */

/** A world-space rect in the renderers' Y-down coordinates: `top` is the smaller y. */
export interface CullRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far past the screen a set is collected, as a fraction of the screen's world size.
 *
 * A fraction rather than a constant because the saving is proportional: the number of pan frames
 * a collected set survives is the margin divided by the distance travelled per frame, and both
 * scale with zoom. A constant would be generous when zoomed out and useless when zoomed in.
 */
export const CULL_HYSTERESIS = 0.15;

/** A rect no view can be inside, so the first frame of a layer always collects. */
export function emptyCullRect(): CullRect {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/**
 * The world rect the canvas currently shows, from the store's viewport and the canvas size.
 *
 * The four lines were copied into eight frame loops, each deriving `1 / viewport.zoom` again and
 * two of them with a subtly different padding convention. One function means one convention.
 */
export function worldViewRect(
  out: CullRect,
  viewportX: number,
  viewportY: number,
  zoom: number,
  width: number,
  height: number
): void {
  const invZoom = 1 / zoom;
  out.left = -viewportX * invZoom;
  out.right = (width - viewportX) * invZoom;
  out.top = -viewportY * invZoom;
  out.bottom = (height - viewportY) * invZoom;
}

/**
 * Widen a visible world rect into the rect a set is collected for.
 *
 * `padWorld` is added on top of the fraction and is what keeps geometry that reaches OUTSIDE its
 * entity's own box — a shadow, a selection halo, an edge's bulge — from popping in at the border.
 * It is in world units, so a caller holding a screen-pixel reach divides by zoom first.
 */
export function inflateViewRect(
  out: CullRect,
  left: number,
  right: number,
  top: number,
  bottom: number,
  padWorld = 0
): void {
  const marginX = (right - left) * CULL_HYSTERESIS + padWorld;
  const marginY = (bottom - top) * CULL_HYSTERESIS + padWorld;
  out.left = left - marginX;
  out.right = right + marginX;
  out.top = top - marginY;
  out.bottom = bottom + marginY;
}

/**
 * Whether the screen has slid out of the rect a set was collected for.
 *
 * The whole point of the hysteresis is that this is false for most frames of a pan, so it is the
 * thing worth pinning down in a test.
 */
export function viewEscaped(
  collected: CullRect,
  left: number,
  right: number,
  top: number,
  bottom: number
): boolean {
  return (
    left < collected.left ||
    right > collected.right ||
    top < collected.top ||
    bottom > collected.bottom
  );
}

/**
 * "Has the camera moved enough that this layer has to rebuild?" — and the rect it should cull to.
 *
 * THE SHAPE THE LAYERS WERE IN. Seven of them subscribed to `viewport` and marked themselves dirty
 * from it, so every pointermove of a pan re-ran the layer's whole rebuild: matrices rewritten,
 * attributes rewritten, buffers re-uploaded. For text entities that included re-wrapping and
 * re-kerning every visible string, sixty times a second, to move a camera the GPU moves on its
 * own — every transform they write is world space and a pan changes none of them.
 *
 * So the subscription goes and this takes its place: asked once a frame, it answers false while the
 * screen is still inside the rect the layer last collected for and the zoom has not crossed a band.
 * A layer culls to `rect` rather than to the live screen, which is what makes the skipped frames
 * correct — everything that could scroll into view during them was collected before they began.
 *
 * `ViewportCuller` is this plus a quadtree query, for the layers that also need to know WHICH
 * entities the rect holds rather than merely whether it moved.
 */
export class CameraGate {
  private readonly collected: CullRect = emptyCullRect();
  private readonly view: CullRect = emptyCullRect();
  private band = Number.NaN;
  private stale = true;

  /** The rect the layer last collected for. Cull against this, never against the bare screen. */
  get rect(): Readonly<CullRect> {
    return this.collected;
  }

  /** Force the next `moved` to answer true — e.g. the layer's geometry inputs changed. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * @param padWorld reach of anything drawn outside an entity's own box, in world units.
   * @returns true when the rect was re-cut and the layer must rebuild against it.
   */
  moved(
    viewportX: number,
    viewportY: number,
    zoom: number,
    width: number,
    height: number,
    padWorld: number
  ): boolean {
    const view = this.view;
    worldViewRect(view, viewportX, viewportY, zoom, width, height);
    const band = zoomBucket(zoom);
    if (
      !this.stale &&
      band === this.band &&
      !viewEscaped(this.collected, view.left, view.right, view.top, view.bottom)
    ) {
      return false;
    }
    inflateViewRect(this.collected, view.left, view.right, view.top, view.bottom, padWorld);
    this.band = band;
    this.stale = false;
    return true;
  }
}

/**
 * Which zoom band the camera is in, as an integer.
 *
 * Zoom is the one camera change the rect test cannot see: zooming IN shrinks the visible rect,
 * which stays inside the collected one, so a layer whose output depends on zoom would never ask
 * again. Any layer that scales geometry by zoom, or gates it on a zoom threshold, compares this
 * alongside the rect.
 *
 * Logarithmic, so a band is a constant RATIO of zoom rather than a constant difference — the same
 * sensitivity at 0.1 as at 10. Eight bands per doubling: fine enough that nothing visibly drifts
 * inside one, coarse enough that a slow wheel does not rebuild on every notch.
 */
export function zoomBucket(zoom: number): number {
  return Math.round(Math.log2(zoom) * 8);
}
