/**
 * The magnet: what a socket does when a connection comes near it, as numbers.
 *
 * WHAT IT IS FOR. A wire dragged toward a socket used to be two unrelated things — a curve that
 * ended under the pointer, and a dot that lit up when the pointer was within nine pixels of it.
 * Nothing was drawn to the socket and nothing was felt. This holds the physics instead: how hard
 * the nearest socket is pulling, where the wire's tip actually is (behind the pointer, held back
 * by the pull), and which of the four stages the socket is in. Three layers read it — the socket
 * shader morphs, the connection line bends its tip toward it and draws the fused bridge, and the
 * pointer path lets a release inside the pull win the connection.
 *
 * THE SEAM. Like everything in `src/gl/`, this imports no store, no theme and no component: it is
 * a spring and a distance, and the caller supplies both ends. That is what lets the control kit
 * leave with it.
 *
 * ONE OBJECT, MUTATED. A drag writes it on every pointer move and every frame, so it is a fixed
 * record rather than a fresh one per event — the rule the widget buffers follow for the same
 * reason.
 */

/** How far a socket reaches, and how close counts as fused, in world px. */
export interface MagnetRange {
  /** Beyond this the socket is dormant. */
  range: number;
  /** Inside this the pull is total: the tip is at the socket and the two shapes have merged. */
  fuse: number;
}

/** What the magnet is pulling toward — a socket's world point, and whether it will accept. */
export interface MagnetTarget {
  x: number;
  y: number;
  /** False for a socket that cannot take this connection: it stiffens instead of bulging. */
  compatible: boolean;
}

/** Where a socket is in the ladder. Drawn, in this order, by the socket shader. */
export const MAGNET_STAGE = {
  /** No wire near it: a hollow ring. */
  dormant: 0,
  /** A compatible wire is in range: the ring thickens and its hole shrinks. */
  awake: 1,
  /** The wire is close enough to fuse: the hole closes and the two shapes bulge together. */
  recognised: 2,
} as const;

/**
 * The spring the tip rides. Critically damped — v2's rule that a curve may cross its target at
 * most once, and a wire tip that wobbled past the socket would be a wire tip that is hard to aim.
 */
const STIFFNESS = 320;
const DAMPING = 2 * Math.sqrt(STIFFNESS);

export class Magnet {
  /** True from the first pointer move of a drag until it ends. */
  active = false;
  /** The pointer, in world px — where the wire would end with no magnet at all. */
  pointerX = 0;
  pointerY = 0;
  /** The wire's tip, which lags the pointer by however hard the socket is pulling. */
  tipX = 0;
  tipY = 0;
  /** The socket doing the pulling, in world px. Meaningless while `strength` is 0. */
  socketX = 0;
  socketY = 0;
  /** 0 when nothing is near, 1 when the tip is at the socket. */
  strength = 0;
  /** One of MAGNET_STAGE. */
  stage: number = MAGNET_STAGE.dormant;
  /** Whether the socket being approached would accept the connection. */
  compatible = false;
  /**
   * The socket in range, whether or not it will accept — the socket layer needs the refused one
   * too, so it can stiffen. A release consults `compatible` before taking it.
   */
  targetKey: string | null = null;

  private vx = 0;
  private vy = 0;

  constructor(readonly bounds: MagnetRange) {}

  /** A drag begins at its source socket: the tip starts there rather than springing in from nowhere. */
  begin(x: number, y: number): void {
    this.active = true;
    this.pointerX = x;
    this.pointerY = y;
    this.tipX = x;
    this.tipY = y;
    this.vx = 0;
    this.vy = 0;
    this.strength = 0;
    this.stage = MAGNET_STAGE.dormant;
    this.compatible = false;
    this.targetKey = null;
  }

  /**
   * Where the pointer is now, and the nearest socket it could land on — or null for none in range.
   * Called from the pointer path, which is the only place that knows what a socket is.
   */
  aim(pointerX: number, pointerY: number, target: MagnetTarget | null, targetKey: string | null): void {
    this.pointerX = pointerX;
    this.pointerY = pointerY;
    if (!target) {
      this.strength = 0;
      this.stage = MAGNET_STAGE.dormant;
      this.compatible = false;
      this.targetKey = null;
      return;
    }
    this.socketX = target.x;
    this.socketY = target.y;
    this.compatible = target.compatible;
    this.targetKey = targetKey;
    const d = Math.hypot(pointerX - target.x, pointerY - target.y);
    const { range, fuse } = this.bounds;
    // 1 inside the fuse radius, 0 beyond the range, smooth between. An incompatible socket pulls
    // nothing at all — refusal is felt in the drag, not read off a colour.
    const t = range <= fuse ? (d <= fuse ? 1 : 0) : 1 - clamp01((d - fuse) / (range - fuse));
    const pull = target.compatible ? t * t * (3 - 2 * t) : 0;
    this.strength = pull;
    this.stage =
      pull > 0.55 ? MAGNET_STAGE.recognised : t > 0.02 ? MAGNET_STAGE.awake : MAGNET_STAGE.dormant;
  }

  /**
   * Advance the tip one frame. The goal is the pointer, dragged toward the socket by the pull, so
   * a wire near a socket is held back while the cursor moves on — then released when it leaves.
   */
  advance(dt: number): void {
    if (!this.active) return;
    const step = Math.min(dt, 1 / 30);
    const goalX = this.pointerX + (this.socketX - this.pointerX) * this.strength;
    const goalY = this.pointerY + (this.socketY - this.pointerY) * this.strength;
    this.vx += (-STIFFNESS * (this.tipX - goalX) - DAMPING * this.vx) * step;
    this.vy += (-STIFFNESS * (this.tipY - goalY) - DAMPING * this.vy) * step;
    this.tipX += this.vx * step;
    this.tipY += this.vy * step;
  }

  end(): void {
    this.active = false;
    this.strength = 0;
    this.stage = MAGNET_STAGE.dormant;
    this.compatible = false;
    this.targetKey = null;
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
