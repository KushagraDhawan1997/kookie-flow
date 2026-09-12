/**
 * Transitions without React and without per-frame writes.
 *
 * HOW A CONTROL ANIMATES HERE. The shader gets, per instance, the state it is going TO (an
 * attribute it already had — hover, checked) plus two more numbers: the state it came FROM and
 * the time the change happened. With a clock uniform it interpolates the rest itself. So an
 * animation costs one buffer write when the state changes and nothing at all on the frames
 * between: no React, no per-frame buffer upload, no subscription firing sixty times a second.
 *
 * This class holds the FROM and the START for every key that is mid-transition or has recently
 * finished one. It allocates only when a state actually changes — a pointer resting on a control
 * costs nothing — and it drops entries once they have settled back at rest, so it holds at most
 * the handful of controls a person has touched in the last few hundred milliseconds.
 *
 * A change that arrives mid-transition retargets from where the eased value currently IS, not
 * from where the old transition was headed, so a hover that leaves halfway through its fade-in
 * fades back out from half rather than snapping to full and then fading.
 */

import { easeOutCubic } from './ease';

/**
 * How long a step into state `to` takes, in seconds. v2 prices a step by where it is going: a hover
 * colour arrives in 80ms and leaves in 220ms, a press lands at once. The shader picks the same
 * duration by the same rule, so the tracker and the GPU agree on where a fade is.
 */
export type DurationFor = (to: number) => number;

/** One key's transition: heading to `to` from `from`, since `start` (seconds, motion clock). */
export interface Transition {
  from: number;
  to: number;
  start: number;
}

/**
 * The motion clock: seconds since this module loaded, as a float the shader can hold.
 *
 * NOT `performance.now() / 1000`. A page that has been open for a day is at 86,400 seconds, and a
 * float32 has 24 bits of mantissa — the shader would see the clock tick in steps of 8ms and every
 * fade would stutter. Subtracting an epoch keeps the number small for as long as anyone keeps a
 * tab open.
 */
const EPOCH = typeof performance !== 'undefined' ? performance.now() : 0;
export function motionNow(): number {
  return (performance.now() - EPOCH) / 1000;
}

/** A start time far enough in the past that any duration has elapsed. */
export const SETTLED = -1e3;

export class TransitionTracker {
  private readonly entries = new Map<string, Transition>();
  private readonly durationFor: DurationFor;

  /**
   * @param duration seconds, or a duration per target state — the same number the shader divides by.
   * @param ease the curve the shader draws, so a retarget starts from where the GPU actually is.
   *   Given the target too, because v2 picks a curve by where a step goes: a press lands on the
   *   stiff spring and recovers on the lively one.
   */
  constructor(
    duration: number | DurationFor,
    private readonly ease: (t: number, to: number) => number = easeOutCubic
  ) {
    this.durationFor = typeof duration === 'number' ? () => duration : duration;
  }

  /**
   * Record that `key` is now in state `to`. Keys not held are at rest, which is state 0, so a
   * first move to 0 records nothing and a first move to anything else starts from 0.
   */
  set(key: string, to: number, now: number): void {
    const t = this.entries.get(key);
    if (!t) {
      if (to === 0) return;
      this.entries.set(key, { from: 0, to, start: now });
      return;
    }
    if (t.to === to) return;
    t.from = this.valueOf(t, now);
    t.to = to;
    t.start = now;
  }

  /** The transition for `key`, or undefined if it is at rest and has been for a while. */
  read(key: string): Transition | undefined {
    return this.entries.get(key);
  }

  /** Where the eased value is right now. */
  valueOf(t: Transition, now: number): number {
    const d = this.durationFor(t.to);
    // A step of no length has already arrived — v2's instant press colour, or reduced motion.
    const k = d <= 0 ? 1 : this.ease((now - t.start) / d, t.to);
    return t.from + (t.to - t.from) * k;
  }

  /**
   * True while anything is still moving. Also the sweep: a transition that has finished and
   * settled at rest is dropped here, so the map never grows past what is in motion.
   */
  active(now: number): boolean {
    let moving = false;
    for (const [key, t] of this.entries) {
      if (now - t.start < this.durationFor(t.to)) {
        moving = true;
      } else if (t.to === 0) {
        this.entries.delete(key);
      }
    }
    return moving;
  }

  /** How many keys are held; for tests. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
