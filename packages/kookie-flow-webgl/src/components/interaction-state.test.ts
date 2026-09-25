import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInteractionMode,
  setInteractionMode,
  observeInteractionMode,
} from './interaction-state';

/**
 * The interaction mode notifies instead of being polled.
 *
 * The toolbar needed to know when the mode changed and had no way to ask, so it polled: an
 * unconditional `requestAnimationFrame` loop, running for the whole life of the component, every
 * frame, forever, comparing one variable against its previous value. Its own comment gave the
 * reason — "poll interaction mode since it's a side-channel (not in store)" — which describes a
 * missing mechanism rather than justifying a loop.
 *
 * The mode stays OUT of the store deliberately, and that constraint is what these laws protect:
 * it changes at gesture boundaries and is read inside `useFrame`, so a Zustand write would
 * allocate a state object where today there is a plain assignment.
 */

beforeEach(() => {
  setInteractionMode('idle');
});

describe('interaction mode observers', () => {
  it('an observer hears a change', () => {
    const seen: string[] = [];
    const off = observeInteractionMode((m) => seen.push(m));
    setInteractionMode('dragging');
    off();
    expect(seen).toEqual(['dragging']);
  });

  it('a repeat of the same mode notifies nobody', () => {
    // A drag ends with several `setInteractionMode('idle')` calls from different exit paths.
    // Firing on every one would put the polling cost back with extra steps.
    const seen: string[] = [];
    const off = observeInteractionMode((m) => seen.push(m));
    setInteractionMode('dragging');
    setInteractionMode('dragging');
    setInteractionMode('dragging');
    off();
    expect(seen).toEqual(['dragging']);
  });

  it('the value is still readable without observing', () => {
    // `EntitySelection` reads this inside useFrame and must not have to subscribe to do it.
    setInteractionMode('resizing');
    expect(getInteractionMode()).toBe('resizing');
  });

  it('unsubscribing actually stops the notifications', () => {
    // The toolbar unmounts and remounts; a leaked observer would hold a dead component's closure
    // and call setState on it forever.
    const seen: string[] = [];
    const off = observeInteractionMode((m) => seen.push(m));
    setInteractionMode('dragging');
    off();
    setInteractionMode('connecting');
    expect(seen).toEqual(['dragging']);
  });

  it('several observers all hear it', () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = observeInteractionMode((m) => a.push(m));
    const offB = observeInteractionMode((m) => b.push(m));
    setInteractionMode('boxSelecting');
    offA();
    offB();
    expect(a).toEqual(['boxSelecting']);
    expect(b).toEqual(['boxSelecting']);
  });
});
