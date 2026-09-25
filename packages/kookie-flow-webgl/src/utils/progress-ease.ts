/**
 * The drawn sweep chases the reported one.
 *
 * A handler reports progress at whatever rate suits its work — tenths, once a chunk, once a
 * second — and painting that number raw makes the ring jump between reports, which reads as a
 * stutter rather than as work happening. These two functions turn a coarse series of reports
 * into continuous motion.
 */

/**
 * How much of the remaining gap is closed per second. High enough to arrive within about a
 * tenth of a second, low enough that a report every tenth still reads as motion rather than
 * as a series of snaps.
 */
export const PROGRESS_EASE_RATE = 14;

/**
 * The fraction of the gap to close this frame. Frame-rate independent: the same share of the
 * gap goes per second whether the display runs at 30Hz or 120Hz, so the sweep takes the same
 * wall-clock time on every machine.
 */
export function progressEaseAlpha(deltaSeconds: number): number {
  if (!(deltaSeconds > 0)) return 0;
  return 1 - Math.exp(-deltaSeconds * PROGRESS_EASE_RATE);
}

/**
 * The value to paint, given what was painted last frame.
 *
 * `previous` is undefined on the first frame of a run, and a target below where the ring already
 * stands means a new run has started on the same entity — both begin the sweep from zero rather
 * than jumping to the reported figure, so a run that reports 0.9 first still sweeps there.
 */
export function easeProgress(previous: number | undefined, target: number, alpha: number): number {
  const from = previous === undefined || target < previous ? 0 : previous;
  return from + (target - from) * alpha;
}
