import { describe, it, expect } from 'vitest';
import { planEdgeUpdate, packEdgeFlags, unpackEdgeFlags, edgeHalfWidthAtZoom } from './edges';

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

/**
 * The edge's state bits ride in the magnitude of `uv2.y`, and the fragment shader unpacks them
 * with `mod` and `step`. Nothing at runtime can tell the packer and the unpacker apart if they
 * drift, so the JS mirror of the GLSL decode is pinned against the packer here for every combination.
 */
describe('packEdgeFlags', () => {
  it('round-trips every combination through the shader decode', () => {
    for (const animated of [false, true]) {
      for (const selected of [false, true]) {
        for (const invalid of [false, true]) {
          const packed = packEdgeFlags(animated, selected, invalid);
          expect(packed).toBeGreaterThanOrEqual(0);
          expect(packed).toBeLessThanOrEqual(7);
          expect(unpackEdgeFlags(packed)).toEqual({ animated, selected, invalid });
        }
      }
    }
  });

  it('survives the interpolator, which hands the shader 3.9999 for 4', () => {
    expect(unpackEdgeFlags(3.9999)).toEqual({ animated: false, selected: false, invalid: true });
    expect(unpackEdgeFlags(7.0001)).toEqual({ animated: true, selected: true, invalid: true });
  });

  it('keeps an arrow vertex at zero: side 0 packs to 0 whatever the flags', () => {
    // The vertex shader takes sign(uv2.y) for the side and abs(uv2.y) - 1 for the flags. A
    // value of 0 has no sign and yields flags max(0, -1) = 0, the plain solid arrow.
    expect(0 * (1 + packEdgeFlags(true, true, true))).toBe(0);
  });
});

describe('edgeHalfWidthAtZoom', () => {
  it('is the full 8px ribbon at and above zoom 0.8', () => {
    expect(edgeHalfWidthAtZoom(0.8)).toBeCloseTo(4);
    expect(edgeHalfWidthAtZoom(1)).toBeCloseTo(4);
    expect(edgeHalfWidthAtZoom(3)).toBeCloseTo(4);
  });

  it('is the bare 2px core at and below zoom 0.45', () => {
    expect(edgeHalfWidthAtZoom(0.45)).toBeCloseTo(1);
    expect(edgeHalfWidthAtZoom(0.4)).toBeCloseTo(1);
    expect(edgeHalfWidthAtZoom(0.1)).toBeCloseTo(1);
  });

  it('is monotonic through the fade', () => {
    let prev = edgeHalfWidthAtZoom(0.45);
    for (let z = 0.46; z <= 0.8; z += 0.01) {
      const next = edgeHalfWidthAtZoom(z);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
    expect(edgeHalfWidthAtZoom(0.625)).toBeCloseTo(2.5);
  });
});
