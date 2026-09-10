import { describe, it, expect } from 'vitest';
import { isSelfDrawn, isMediaType, locksAspectByDefault } from './entity-kind';
import type { Entity } from '../types';

/**
 * This file exists because the list it guards used to be written out twice.
 *
 * `nodes.tsx` and `text-renderer.tsx` each carried their own `type === 'comment' || …` chain, and
 * the failure mode of two copies is silent: adding a type to one and not the other paints a node
 * body under a video, or a node title over a 3D preview, and nothing errors. So the assertions
 * here are about COMPLETENESS — every type with its own renderer must be in the set — rather than
 * about the trivially true fact that a Set contains what was put in it.
 */

function entity(type: string, data: Record<string, unknown> = {}): Entity {
  return { id: 'e', type, position: { x: 0, y: 0 }, data };
}

describe('types that draw themselves', () => {
  it('covers every type that has a renderer of its own', () => {
    // The complete list, restated deliberately. If a renderer is added without its type landing
    // here, the node layers will paint a body and a title underneath it.
    for (const type of ['comment', 'reroute', 'text', 'image', 'video', 'mesh']) {
      expect(isSelfDrawn(type)).toBe(true);
    }
  });

  it('leaves ordinary nodes to the node renderers', () => {
    expect(isSelfDrawn('default')).toBe(false);
    // A frame IS drawn by nodes.tsx — it is a node-shaped container, not a special renderer.
    expect(isSelfDrawn('frame')).toBe(false);
  });
});

describe('media types', () => {
  it('is the three quad-backed types and nothing else', () => {
    expect(isMediaType('image')).toBe(true);
    expect(isMediaType('video')).toBe(true);
    expect(isMediaType('mesh')).toBe(true);
    for (const type of ['text', 'comment', 'frame', 'default', 'reroute']) {
      expect(isMediaType(type)).toBe(false);
    }
  });

  it('is a subset of the self-drawn types', () => {
    // Media is drawn on a quad by its own renderer, so anything media must also be self-drawn.
    // A media type missing from SELF_DRAWN_TYPES would get a node body painted behind its picture.
    for (const type of ['image', 'video', 'mesh']) {
      expect(isSelfDrawn(type)).toBe(true);
    }
  });
});

describe('aspect lock on resize', () => {
  it('holds proportions for every media type by default', () => {
    for (const type of ['image', 'video', 'mesh']) {
      expect(locksAspectByDefault(entity(type))).toBe(true);
    }
  });

  it('does not hold proportions for anything else', () => {
    for (const type of ['default', 'frame', 'text', 'comment']) {
      expect(locksAspectByDefault(entity(type))).toBe(false);
    }
  });

  it('lets an entity opt out with aspectLocked: false', () => {
    expect(locksAspectByDefault(entity('image', { aspectLocked: false }))).toBe(false);
    expect(locksAspectByDefault(entity('video', { aspectLocked: false }))).toBe(false);
  });

  it('treats an absent flag as locked, not as unlocked', () => {
    // `undefined !== false`, and the distinction is the whole default: an image with no opinion
    // must still resize proportionally.
    expect(locksAspectByDefault(entity('image', { aspectLocked: undefined }))).toBe(true);
  });

  it('answers for a missing entity rather than throwing', () => {
    // The resize handler looks the entity up by id mid-drag; a delete during a drag returns
    // undefined, and a throw there would abort the pointer handler.
    expect(locksAspectByDefault(undefined)).toBe(false);
  });
});
