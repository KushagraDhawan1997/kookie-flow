import { describe, it, expect } from 'vitest';
import { entityDepth, topmostEntityId, DEPTH_LAYER, STACK_STEP, STACK_COMPACT_AT } from './entity-depth';

const none = new Set<string>();

describe('entityDepth', () => {
  it('a later stack index is nearer the camera', () => {
    const order = new Map([['back', 1], ['front', 2]]);
    expect(entityDepth('front', order, none)).toBeGreaterThan(entityDepth('back', order, none));
  });

  it('every part of an entity sits inside its own slice, never in the next entity\'s', () => {
    // A back node's LABEL (its highest part) must still be behind a front node's BODY.
    const order = new Map([['back', 1], ['front', 2]]);
    const backLabel = entityDepth('back', order, none) + DEPTH_LAYER.label;
    const frontBody = entityDepth('front', order, none) + DEPTH_LAYER.body;
    expect(backLabel).toBeLessThan(frontBody);
    expect(DEPTH_LAYER.label).toBeLessThan(STACK_STEP);
  });

  it('parts paint in order: body, widget, socket, label', () => {
    expect(DEPTH_LAYER.body).toBeLessThan(DEPTH_LAYER.widget);
    expect(DEPTH_LAYER.widget).toBeLessThan(DEPTH_LAYER.socket);
    expect(DEPTH_LAYER.socket).toBeLessThan(DEPTH_LAYER.label);
  });

  it('a selected entity is above every unselected one, whatever their stack indices', () => {
    // The worst case: the lowest possible selected index against the highest unselected one
    // the counter can reach before compaction. The boost has to clear the whole span.
    const order = new Map([['sel', 1], ['top', STACK_COMPACT_AT]]);
    expect(entityDepth('sel', order, new Set(['sel']))).toBeGreaterThan(
      entityDepth('top', order, none) + DEPTH_LAYER.label
    );
  });

  it('stays inside the camera range up to the compaction point', () => {
    // Orthographic camera at z=100, near 0.1: anything at or past 99.9 is clipped.
    const order = new Map([['e', STACK_COMPACT_AT]]);
    expect(entityDepth('e', order, new Set(['e'])) + DEPTH_LAYER.label).toBeLessThan(99.9);
    expect(entityDepth('e', new Map([['e', 0]]), none)).toBeGreaterThan(-900);
  });
});

describe('topmostEntityId', () => {
  it('picks the entity nearest the camera, not the first candidate', () => {
    // The quadtree's order is reverse insertion: 'under' was added later, so it came first.
    const order = new Map([['over', 7], ['under', 3]]);
    expect(topmostEntityId(['under', 'over'], order)).toBe('over');
  });

  it('is null for no candidates', () => {
    expect(topmostEntityId([], new Map())).toBeNull();
  });

  it('an entity with no recorded index sits at the bottom', () => {
    expect(topmostEntityId(['unknown', 'known'], new Map([['known', 1]]))).toBe('known');
  });
});
