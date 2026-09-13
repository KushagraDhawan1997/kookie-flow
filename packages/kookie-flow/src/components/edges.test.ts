import { describe, it, expect } from 'vitest';
import { planEdgeUpdate, flagsToClearAfterEdgePass, packEdgeFlags, packVertexSide, unpackEdgeFlags, edgeHalfWidthAtZoom, segmentsForZoom, DirtyVertexSpans, MAX_EDGE_UPDATE_RANGES } from './edges';

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

/**
 * What a finished pass may FORGET — the other half of planEdgeUpdate, and the law whose absence
 * made the whole culled-edge path inert.
 *
 * The geometry flag is an INPUT to the plan: a set flag means 'full'. So on a partial frame it was
 * false at plan time, and any value it holds when the pass ends was raised BY the pass — by the
 * cull branch, on an edge that entered or left the rect, each of which needs the vertex layout
 * relaid before it can be drawn or dropped. The pass used to clear it unconditionally, which erased
 * those requests in the frame that made them: a wire dragged back into view never got vertices, and
 * a wire dragged out of view went on drawing at the position it used to have, over empty canvas.
 * Both are ordinary gestures — auto-layout, a select-all drag — and neither was caught by anything.
 *
 * These are laws about which requests a frame is allowed to throw away, stated where the laws about
 * which passes it owes already live.
 */
describe('flagsToClearAfterEdgePass', () => {
  it('keeps the geometry request a partial pass raised for itself', () => {
    expect(flagsToClearAfterEdgePass('partial').geometry).toBe(false);
  });

  it('clears the geometry flag after a full rebuild, which has serviced it', () => {
    expect(flagsToClearAfterEdgePass('full').geometry).toBe(true);
  });

  it('keeps a colour request a partial pass could not service for the whole graph', () => {
    // Unchanged behaviour, restated here so the two guards cannot drift apart again: a partial pass
    // rewrites only the edges that moved, so the rest of the graph is still owed the colour pass.
    expect(flagsToClearAfterEdgePass('partial').color).toBe(false);
    expect(flagsToClearAfterEdgePass('full').color).toBe(true);
  });

  it('always clears position and layer, which every pass services in full', () => {
    for (const geometry of ['full', 'partial'] as const) {
      expect(flagsToClearAfterEdgePass(geometry).position).toBe(true);
      expect(flagsToClearAfterEdgePass(geometry).layer).toBe(true);
    }
  });

  /**
   * The composition that matters: a partial frame that raises a rebuild must leave the NEXT frame
   * planning a full one. If either half of this regresses, a culled edge is never relaid.
   */
  it('a rebuild raised during a partial pass survives into the next plan', () => {
    const raisedDuringPass = true; // the cull branch, on an arriving or departing edge
    const kept = !flagsToClearAfterEdgePass('partial').geometry && raisedDuringPass;
    expect(planEdgeUpdate({ geometry: kept, position: true, color: false, layer: false }).geometry).toBe('full');
  });
});

/**
 * THE SPREAD, NOT THE COUNT, used to set what a drag uploaded.
 *
 * The partial path declared one range from the lowest vertex it touched to the highest, so the
 * bill was the DISTANCE between the moved edges in the buffer rather than how many moved. Nothing
 * orders a node's edges together in the consumer's array: measured on a 10k-node graph, one node
 * with six edges touched slots 225 and 7157 and so declared 86.7% of the buffer — about 280 KB a
 * frame to deliver some two kilobytes of change. It stayed hidden because it depends on the
 * graph's TOPOLOGY and not its size; the fixtures it had been measured on gave that node one edge.
 *
 * These are the laws of the replacement. The one that actually pins the fix is the last: every
 * other test here passes just as well for a class that returns a single envelope.
 */
describe('DirtyVertexSpans', () => {
  /** What `declareOn` asks of an attribute, without dragging three into a unit test. */
  function declared(spans: DirtyVertexSpans, perVertex = 1): Array<{ start: number; count: number }> {
    const ranges: Array<{ start: number; count: number }> = [];
    const fake = { addUpdateRange: (start: number, count: number) => ranges.push({ start, count }) };
    spans.declareOn(fake as unknown as Parameters<DirtyVertexSpans['declareOn']>[0], perVertex);
    return ranges;
  }

  it('declares nothing when nothing was written', () => {
    const spans = new DirtyVertexSpans();
    expect(spans.count).toBe(0);
    expect(declared(spans)).toEqual([]);
  });

  it('ignores empty and inverted spans, which a culled edge produces', () => {
    const spans = new DirtyVertexSpans();
    spans.add(100, 100);
    spans.add(200, 150);
    expect(spans.count).toBe(0);
  });

  it('scales each span by the attribute width', () => {
    const spans = new DirtyVertexSpans();
    spans.add(10, 20);
    expect(declared(spans, 3)).toEqual([{ start: 30, count: 30 }]);
    expect(declared(spans, 2)).toEqual([{ start: 20, count: 20 }]);
  });

  it('merges runs that touch, so adjacent edges stay one range', () => {
    const spans = new DirtyVertexSpans();
    spans.add(0, 64);
    spans.add(64, 128);
    spans.add(128, 192);
    expect(spans.count).toBe(1);
    expect(declared(spans)).toEqual([{ start: 0, count: 192 }]);
  });

  it('keeps runs that do not touch apart, which is the entire point', () => {
    const spans = new DirtyVertexSpans();
    spans.add(0, 64);
    spans.add(9000, 9064);
    expect(spans.count).toBe(2);
    expect(declared(spans)).toEqual([
      { start: 0, count: 64 },
      { start: 9000, count: 64 },
    ]);
  });

  it('reset forgets the frame before it', () => {
    const spans = new DirtyVertexSpans();
    spans.add(0, 64);
    spans.reset();
    expect(spans.count).toBe(0);
    expect(declared(spans)).toEqual([]);
  });

  /**
   * Ranges are not free — each is one `bufferSubData` — so past a cap the envelope is cheaper than
   * the list. Over the cap the list is deliberately NOT a complete record, so declaring it would
   * upload less than was written and leave stale vertices on the GPU; the envelope is the only
   * safe answer and is what comes back.
   */
  it('falls back to one envelope past the cap, and the envelope covers everything written', () => {
    const spans = new DirtyVertexSpans();
    const n = MAX_EDGE_UPDATE_RANGES + 10;
    for (let i = 0; i < n; i++) spans.add(i * 100, i * 100 + 10);

    const ranges = declared(spans);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    // Everything written, including the spans past the cap that `add` stopped recording.
    expect(ranges[0].start + ranges[0].count).toBe((n - 1) * 100 + 10);
  });

  it('a list filled exactly to the cap is still declared span by span', () => {
    const spans = new DirtyVertexSpans();
    for (let i = 0; i < MAX_EDGE_UPDATE_RANGES; i++) spans.add(i * 100, i * 100 + 10);
    expect(spans.count).toBe(MAX_EDGE_UPDATE_RANGES);
    expect(declared(spans)).toHaveLength(MAX_EDGE_UPDATE_RANGES);
  });

  /**
   * THE LAW THE FIX EXISTS FOR, stated as the comparison that was failing.
   *
   * A node's edges land far apart in the buffer. What is declared must be proportional to what
   * MOVED, not to the distance between the pieces of it — so this asserts against the envelope a
   * min..max would have produced. Proved necessary by mutation: making `declareOn` always declare
   * `min..max` leaves every other test in this block green.
   */
  it('uploads what moved, not the gap between the first and last of it', () => {
    const spans = new DirtyVertexSpans();
    // Six edges of 128 vertices each, scattered the way the 10k measurement found them.
    for (const start of [225, 1400, 3000, 4820, 6100, 7157]) spans.add(start, start + 128);

    const envelope = spans.max - spans.min;
    expect(spans.vertexCount()).toBe(6 * 128);
    expect(spans.vertexCount()).toBeLessThan(envelope / 8);

    const ranges = declared(spans, 3);
    const bytes = ranges.reduce((sum, r) => sum + r.count, 0);
    expect(bytes).toBe(6 * 128 * 3);
    expect(bytes).toBeLessThan(envelope * 3 / 8);
  });
});
