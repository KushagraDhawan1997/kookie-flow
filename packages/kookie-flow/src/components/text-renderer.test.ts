import { describe, it, expect } from 'vitest';
import {
  lodBucket,
  inflateViewRect,
  collectedSetIsStale,
  type CullRect,
} from './text-renderer';

/**
 * A pan must not rebuild the labels.
 *
 * The text layer subscribed to `viewport` and marked its entry list dirty from it, so every
 * pointermove of a pan rebuilt every label entry, re-counted every glyph, re-tessellated the lot
 * into the instance buffers and re-uploaded the full capacity of four attributes. None of that
 * could ever change the answer: glyph transforms are world space, so the camera moving does not
 * move a single glyph. The only thing a pan can change is which labels survive the cull, and the
 * only thing a zoom can change on top of that is which LOD gates are open.
 *
 * So the set is collected for a rect wider than the screen and reused until the screen leaves it.
 * These are the two laws that makes safe: the reused set has to cover the new view completely,
 * and it has to be thrown away the moment the zoom crosses one of the three LOD cliffs — an
 * inward zoom shrinks the visible rect, so containment alone would happily keep serving a set
 * that has no socket labels in it.
 */

function rectFor(left: number, right: number, top: number, bottom: number): CullRect {
  const out: CullRect = { left: 0, right: 0, top: 0, bottom: 0 };
  inflateViewRect(out, left, right, top, bottom);
  return out;
}

describe('LOD buckets', () => {
  it('changes across each of the three zoom cliffs', () => {
    // 0.15 turns text on at all, 0.25 adds edge labels, 0.35 adds socket labels.
    expect(lodBucket(0.14)).not.toBe(lodBucket(0.16));
    expect(lodBucket(0.24)).not.toBe(lodBucket(0.26));
    expect(lodBucket(0.34)).not.toBe(lodBucket(0.36));
  });

  it('is constant between the cliffs, which is what lets a zoom reuse a collected set', () => {
    expect(lodBucket(0.4)).toBe(lodBucket(3));
    expect(lodBucket(0.16)).toBe(lodBucket(0.24));
    expect(lodBucket(0.01)).toBe(lodBucket(0.14));
  });

  it('opens strictly more gates as zoom rises', () => {
    const buckets = [0.1, 0.2, 0.3, 0.5].map(lodBucket);
    expect(buckets).toStrictEqual([...new Set(buckets)]);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i] & buckets[i - 1]).toBe(buckets[i - 1]);
      expect(buckets[i]).toBeGreaterThan(buckets[i - 1]);
    }
  });
});

describe('collected-set reuse', () => {
  const zoom = 1;
  const lod = lodBucket(zoom);

  it('reuses the set for the view it was collected for', () => {
    const collected = rectFor(0, 1920, 0, 1080);
    expect(collectedSetIsStale(collected, lod, zoom, 0, 1920, 0, 1080)).toBe(false);
  });

  it('reuses the set across a pan that stays inside the margin', () => {
    const collected = rectFor(0, 1920, 0, 1080);
    // The margin is a fraction of the view, so a pan of a tenth of a screen is well inside it.
    expect(collectedSetIsStale(collected, lod, zoom, 100, 2020, 50, 1130)).toBe(false);
  });

  it('rebuilds once the pan carries the view past the margin', () => {
    const collected = rectFor(0, 1920, 0, 1080);
    // The margins are 1920 * 0.15 = 288 horizontally and 1080 * 0.15 = 162 vertically, so the
    // collected rect is (-288, 2208, -162, 1242). Each axis is pinned on both sides of its edge:
    // one world unit short of leaving is still reusable, one unit past it is not.
    expect(collectedSetIsStale(collected, lod, zoom, 287, 2207, 0, 1080)).toBe(false);
    expect(collectedSetIsStale(collected, lod, zoom, 289, 2209, 0, 1080)).toBe(true);

    expect(collectedSetIsStale(collected, lod, zoom, -287, 1633, 0, 1080)).toBe(false);
    expect(collectedSetIsStale(collected, lod, zoom, -289, 1631, 0, 1080)).toBe(true);

    expect(collectedSetIsStale(collected, lod, zoom, 0, 1920, 161, 1241)).toBe(false);
    expect(collectedSetIsStale(collected, lod, zoom, 0, 1920, 163, 1243)).toBe(true);

    expect(collectedSetIsStale(collected, lod, zoom, 0, 1920, -161, 919)).toBe(false);
    expect(collectedSetIsStale(collected, lod, zoom, 0, 1920, -163, 917)).toBe(true);
  });

  it('rebuilds when an inward zoom opens an LOD gate, even though the view shrank', () => {
    // Collected at 0.3: edge labels on, socket labels off. The visible world rect at 0.3 is
    // 1920 / 0.3 wide; zooming in to 0.4 shrinks it, so it is still comfortably contained.
    const collected = rectFor(0, 1920 / 0.3, 0, 1080 / 0.3);
    const zoomedIn = { l: 0, r: 1920 / 0.4, t: 0, b: 1080 / 0.4 };
    expect(zoomedIn.r).toBeLessThan(collected.right);
    expect(zoomedIn.b).toBeLessThan(collected.bottom);
    expect(
      collectedSetIsStale(collected, lodBucket(0.3), 0.4, zoomedIn.l, zoomedIn.r, zoomedIn.t, zoomedIn.b)
    ).toBe(true);
  });

  it('rebuilds when an outward zoom closes an LOD gate', () => {
    const collected = rectFor(0, 1920 / 0.4, 0, 1080 / 0.4);
    // 0.4 -> 0.3 drops socket labels. The rect check would also catch this one, so pin the LOD
    // half specifically: same rect, only the zoom moved.
    expect(collectedSetIsStale(collected, lodBucket(0.4), 0.3, 0, 1920 / 0.4, 0, 1080 / 0.4)).toBe(
      true
    );
  });

  it('never returns a rect narrower than the view it was built from', () => {
    const collected = rectFor(-500, 700, -200, 400);
    expect(collected.left).toBeLessThan(-500);
    expect(collected.right).toBeGreaterThan(700);
    expect(collected.top).toBeLessThan(-200);
    expect(collected.bottom).toBeGreaterThan(400);
  });
});
