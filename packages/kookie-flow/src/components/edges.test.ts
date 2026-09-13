import { describe, it, expect } from 'vitest';
import { planEdgeUpdate, packEdgeFlags, packVertexSide, unpackEdgeFlags, edgeHalfWidthAtZoom, segmentsForZoom } from './edges';

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
    // value of 0 has no sign and yields flags max(0, -1) = 0, the plain solid arrow. Run through
    // the packer the geometry builder itself calls, not through arithmetic written out here.
    for (const animated of [false, true]) {
      for (const selected of [false, true]) {
        for (const invalid of [false, true]) {
          const flags = packEdgeFlags(animated, selected, invalid);
          expect(packVertexSide(0, flags)).toBe(0);
          expect(Math.sign(packVertexSide(1, flags))).toBe(1);
          expect(Math.sign(packVertexSide(-1, flags))).toBe(-1);
          expect(unpackEdgeFlags(Math.abs(packVertexSide(-1, flags)) - 1)).toEqual({ animated, selected, invalid });
        }
      }
    }
  });
});

describe('edgeHalfWidthAtZoom', () => {
  it('is the full 8px ribbon at and above zoom 0.8', () => {
    expect(edgeHalfWidthAtZoom(0.8)).toBeCloseTo(4);
    expect(edgeHalfWidthAtZoom(1)).toBeCloseTo(4);
    expect(edgeHalfWidthAtZoom(3)).toBeCloseTo(4);
  });

  it('is the core plus its AA ramp at and below zoom 0.45 — never a clipped ramp', () => {
    expect(edgeHalfWidthAtZoom(0.45)).toBeCloseTo(1.75);
    expect(edgeHalfWidthAtZoom(0.4)).toBeCloseTo(1.75);
    expect(edgeHalfWidthAtZoom(0.1)).toBeCloseTo(1.75);
  });

  it('is monotonic through the fade', () => {
    let prev = edgeHalfWidthAtZoom(0.45);
    for (let z = 0.46; z <= 0.8; z += 0.01) {
      const next = edgeHalfWidthAtZoom(z);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
    expect(edgeHalfWidthAtZoom(0.625)).toBeCloseTo(1.75 + (4 - 1.75) / 2);
  });
});

/**
 * How finely a curve is sampled, and the two things that must stay true of it whatever the number.
 *
 * THE CEILING IS LOAD-BEARING. The vertex buffers, the point scratch array and the per-edge slot
 * arithmetic are all sized from SEGMENTS_PER_EDGE, and the drag path writes into the slot the last
 * full rebuild laid out — so a count above the ceiling is a buffer overrun into the next edge's
 * vertices, which draws as a wire suddenly growing a second tail. The floor matters for the
 * opposite reason: below about eight segments a bezier reads as a polyline, and the whole point of
 * the LOD is that nobody can tell.
 *
 * MONOTONIC, because the LOD has to get coarser as the camera pulls back and never the reverse.
 * The quantisation is by octave, so the interesting cases are the boundaries themselves.
 */
describe('segmentsForZoom', () => {
  it('stays inside the ceiling the buffers are sized for, at any zoom', () => {
    for (const zoom of [0.001, 0.01, 0.1, 0.25, 0.5, 0.99, 1, 2, 10, 1000]) {
      expect(segmentsForZoom(zoom)).toBeLessThanOrEqual(64);
      expect(segmentsForZoom(zoom)).toBeGreaterThanOrEqual(8);
    }
  });

  it('never samples more finely as the camera pulls back', () => {
    let previous = Infinity;
    for (let zoom = 4; zoom > 0.01; zoom -= 0.01) {
      const segments = segmentsForZoom(zoom);
      expect(segments).toBeLessThanOrEqual(previous);
      previous = segments;
    }
  });

  it('gives a full-detail curve at natural size and above', () => {
    expect(segmentsForZoom(1)).toBe(64);
    expect(segmentsForZoom(4)).toBe(64);
  });

  it('halves with each halving of zoom, down to the floor', () => {
    expect(segmentsForZoom(0.5)).toBe(32);
    expect(segmentsForZoom(0.25)).toBe(16);
    expect(segmentsForZoom(0.125)).toBe(8);
    expect(segmentsForZoom(0.01)).toBe(8);
  });

  it('answers with the ceiling for a zoom that is not a positive number', () => {
    // A degenerate viewport must not produce NaN segments — that is a loop that never terminates
    // and a buffer written at index NaN.
    expect(segmentsForZoom(0)).toBe(64);
    expect(segmentsForZoom(-1)).toBe(64);
    expect(segmentsForZoom(Number.NaN)).toBe(64);
  });
});
