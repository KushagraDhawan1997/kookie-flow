import { describe, it, expect } from 'vitest';
import { planEdgeUpdate } from './edges';

/**
 * The edge renderer's four dirty flags do not compose into four independent passes, and the
 * combination that mattered was getting lost.
 *
 * Clicking an unselected node and dragging it is ONE pointermove: the handler selects the entity
 * and moves it in the same tick, so the next frame arrives with both layerDirty and positionDirty
 * set. That frame took the partial-update path, which writes layers only on a full rebuild, and
 * then cleared layerDirty at the end anyway. The dragged node's edges kept layer 0, drew from the
 * background mesh at renderOrder 0 instead of the foreground mesh at 3, and slid underneath every
 * node body they crossed — and stayed there after the pointer was released, because only a full
 * rebuild would put them back.
 *
 * These are laws about which passes a frame owes, not about the buffers they write.
 */

describe('planEdgeUpdate', () => {
  it('services the layer flip on a frame that also moved something', () => {
    const plan = planEdgeUpdate({ geometry: false, position: true, color: false, layer: true });
    expect(plan.geometry).toBe('partial');
    // The whole point: the partial path visits only the edges that moved, so the layer pass has
    // to run beside it rather than be swallowed by it.
    expect(plan.layer).toBe(true);
  });

  it('leaves the layer pass to a full rebuild, which writes layers inline', () => {
    const plan = planEdgeUpdate({ geometry: true, position: true, color: true, layer: true });
    expect(plan.geometry).toBe('full');
    expect(plan.layer).toBe(false);
    expect(plan.color).toBe(false);
  });

  it('runs the layer pass alone on an idle selection change', () => {
    const plan = planEdgeUpdate({ geometry: false, position: false, color: false, layer: true });
    expect(plan).toEqual({ layer: true, color: false, geometry: 'none' });
  });

  it('runs the colour pass alone on an idle colour change', () => {
    const plan = planEdgeUpdate({ geometry: false, position: false, color: true, layer: false });
    expect(plan).toEqual({ layer: false, color: true, geometry: 'none' });
  });

  it('holds the colour pass back during a partial update', () => {
    // Colours upload through the partial path's addUpdateRange, so a colour written outside the
    // moved vertex range would never reach the GPU. The caller keeps colorDirty set instead.
    const plan = planEdgeUpdate({ geometry: false, position: true, color: true, layer: false });
    expect(plan.geometry).toBe('partial');
    expect(plan.color).toBe(false);
  });

  it('asks for nothing when nothing is dirty', () => {
    const plan = planEdgeUpdate({ geometry: false, position: false, color: false, layer: false });
    expect(plan).toEqual({ layer: false, color: false, geometry: 'none' });
  });
});
