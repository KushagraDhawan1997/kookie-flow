import { describe, it, expect } from 'vitest';
import { TransitionTracker, SETTLED } from './motion';
import { easeOutCubic, easeOutBack } from './ease';

describe('TransitionTracker', () => {
  it('holds nothing for a key that goes to rest without ever leaving it', () => {
    const t = new TransitionTracker(0.2);
    t.set('a', 0, 1);
    expect(t.size).toBe(0);
    expect(t.read('a')).toBeUndefined();
  });

  it('starts from rest on the first move, and does not allocate for a repeat', () => {
    const t = new TransitionTracker(0.2);
    t.set('a', 1, 5);
    const first = t.read('a');
    expect(first).toEqual({ from: 0, to: 1, start: 5 });
    t.set('a', 1, 5.05);
    expect(t.read('a')).toBe(first);
    expect(first?.start).toBe(5);
  });

  it('retargets from where the eased value currently is', () => {
    const t = new TransitionTracker(0.2);
    t.set('a', 1, 0);
    // Halfway through: the value is easeOutCubic(0.5) of the way there.
    t.set('a', 0, 0.1);
    const tr = t.read('a');
    expect(tr?.from).toBeCloseTo(easeOutCubic(0.5), 6);
    expect(tr?.to).toBe(0);
    expect(tr?.start).toBe(0.1);
  });

  it('reports motion while a transition runs, and sweeps settled keys that are at rest', () => {
    const t = new TransitionTracker(0.2);
    t.set('a', 1, 0);
    expect(t.active(0.1)).toBe(true);
    // Finished, but not at rest: kept, so the shader still knows where it came from.
    expect(t.active(0.5)).toBe(false);
    expect(t.size).toBe(1);
    t.set('a', 0, 0.6);
    expect(t.active(0.7)).toBe(true);
    expect(t.active(1.0)).toBe(false);
    expect(t.size).toBe(0);
  });

  it('is settled long before any duration at SETTLED', () => {
    expect(SETTLED).toBeLessThan(-100);
  });
});

describe('easing', () => {
  it('pins both ends', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it('clamps outside 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
