import { describe, it, expect } from 'vitest';
import { easeProgress, progressEaseAlpha, PROGRESS_EASE_RATE } from './progress-ease';

/**
 * The ease exists because handlers report coarsely. These tests hold it to the two things that
 * makes it worth having: it always moves, and it always arrives.
 */

const FRAME = 1 / 60;

describe('how fast the gap closes', () => {
  it('a frame closes part of the gap, never all of it', () => {
    const a = progressEaseAlpha(FRAME);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it('a longer frame closes more, so the sweep takes the same time at any frame rate', () => {
    // Two frames at 120Hz land where one frame at 60Hz does: (1-a)² over half the step.
    const half = progressEaseAlpha(FRAME / 2);
    const whole = progressEaseAlpha(FRAME);
    expect((1 - half) * (1 - half)).toBeCloseTo(1 - whole, 10);
  });

  it('a frame that took no time moves nothing', () => {
    expect(progressEaseAlpha(0)).toBe(0);
    expect(progressEaseAlpha(-1)).toBe(0);
  });

  it('a long stall — a hidden tab — arrives rather than overshooting', () => {
    expect(progressEaseAlpha(10)).toBeGreaterThan(0.999);
    expect(progressEaseAlpha(10)).toBeLessThanOrEqual(1);
  });
});

describe('where the ring is drawn', () => {
  it('the first frame of a run sweeps out of zero, whatever was reported', () => {
    expect(easeProgress(undefined, 0.9, progressEaseAlpha(FRAME))).toBeLessThan(0.9);
    expect(easeProgress(undefined, 0.9, progressEaseAlpha(FRAME))).toBeGreaterThan(0);
  });

  it('a target behind the ring is a new run, so it starts over rather than winding back', () => {
    const next = easeProgress(0.8, 0.1, progressEaseAlpha(FRAME));
    expect(next).toBeLessThan(0.1);
    expect(next).toBeGreaterThan(0);
  });

  it('it never passes what was reported', () => {
    let p: number | undefined;
    for (let i = 0; i < 600; i++) p = easeProgress(p, 0.5, progressEaseAlpha(FRAME));
    expect(p).toBeLessThanOrEqual(0.5);
  });

  it('a report held still is reached within about a tenth of a second', () => {
    // The point of the rate: ten reports a second look continuous because each is arrived at
    // before the next lands.
    let p: number | undefined;
    for (let i = 0; i < Math.round(0.1 / FRAME); i++) p = easeProgress(p, 0.5, progressEaseAlpha(FRAME));
    expect(p).toBeGreaterThan(0.5 * 0.7);
  });

  it('every frame between two reports moves the ring, which is the whole point', () => {
    let p: number | undefined;
    let last = 0;
    for (let i = 0; i < 6; i++) {
      p = easeProgress(p, 0.5, progressEaseAlpha(FRAME));
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  it('a handler that reports every frame is left alone within a frame or two', () => {
    // Fine-grained reports must not be dragged behind: the gap each frame is tiny, so the ease
    // is a rounding difference rather than a lag.
    let p: number | undefined = 0;
    for (let i = 1; i <= 60; i++) p = easeProgress(p, i / 60, progressEaseAlpha(FRAME));
    expect(1 - p).toBeLessThan(0.1);
  });

  it('the rate is the only knob, and it is a rate per second', () => {
    expect(progressEaseAlpha(1)).toBeCloseTo(1 - Math.exp(-PROGRESS_EASE_RATE), 12);
  });
});
