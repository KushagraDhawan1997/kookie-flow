/**
 * The scratch split, and the one way it could quietly ruin the callers it was written to spare.
 *
 * `getWidgetBox` used to build the rectangle itself. It now calls `readWidgetBoxInto`, which
 * writes into a rectangle the caller owns, so the hover test that runs on every pointermove can
 * pass in one module-scoped box and allocate nothing. The danger in that shape is obvious once
 * stated: hand the same scratch box to two callers, or let `getWidgetBox` start returning one,
 * and every box in the program becomes the same box. `widget-edit-overlay` holds a hit's box for
 * the whole length of an edit and reads it on every frame of a pan — a shared rectangle would
 * make the borrowed input follow the pointer to whatever was hovered last.
 */

import { describe, it, expect } from 'vitest';
import { getWidgetBox, readWidgetBoxInto, isPointInWidget, type WidgetBox } from './widget-geometry';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity } from '../types';

const layout: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  titleBand: 0, // these fixtures are the no-title layout: marginTop === padding
  socketSize: 10,
  padding: 12,
  borderWidth: 1,
  markSize: 20,
  trackHeight: 4,
};

const entity: Entity = {
  id: 'n1',
  type: 'default',
  position: { x: 100, y: 50 },
  data: {},
  width: 240,
  inputs: [
    { id: 'a', name: 'A', type: 'string' },
    { id: 'b', name: 'B', type: 'string' },
  ],
};

describe('getWidgetBox hands out a rectangle the caller can keep', () => {
  it('returns a distinct object per call, so reading a second widget cannot move the first', () => {
    const first = getWidgetBox(entity, 0, layout);
    const firstY = first?.y;
    const second = getWidgetBox(entity, 1, layout);
    expect(first).not.toBe(second);
    // The fixture has to actually put the two rows in different places, or "unchanged" is empty.
    expect(second?.y).not.toBe(firstY);
    expect(first?.y).toBe(firstY);
  });
});

describe('readWidgetBoxInto writes the same rectangle into the caller storage', () => {
  it('agrees with getWidgetBox field for field', () => {
    const out: WidgetBox = { x: 0, y: 0, width: 0, height: 0 };
    for (let i = 0; i < 2; i++) {
      const fresh = getWidgetBox(entity, i, layout);
      const written = readWidgetBoxInto(out, entity, i, layout);
      expect(written).toBe(out);
      expect({ ...out }).toEqual(fresh);
    }
  });

  it('answers null for a socket index that has no row, and leaves the scratch alone', () => {
    // The miss path must not half-write: the next caller reads whatever is in there.
    const out: WidgetBox = { x: 1, y: 2, width: 3, height: 4 };
    expect(readWidgetBoxInto(out, entity, 5, layout)).toBeNull();
    expect(out).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('honours the entity width and label width the caller passes, as getWidgetBox does', () => {
    // Both are public props on <KookieFlow>; a reader that hardcoded the constants would be right
    // until a consumer set one.
    const out: WidgetBox = { x: 0, y: 0, width: 0, height: 0 };
    readWidgetBoxInto(out, { ...entity, width: undefined }, 0, layout, 400, 20);
    // padding + border on each side: the body is border-box.
    const inset = layout.padding + layout.borderWidth;
    expect(out.width).toBe(400 - inset * 2 - 20);
    expect(out.x).toBe(entity.position.x + inset + 20);
  });

  it('contains its own centre and excludes a point just outside it', () => {
    const out: WidgetBox = { x: 0, y: 0, width: 0, height: 0 };
    const box = readWidgetBoxInto(out, entity, 0, layout);
    if (!box) throw new Error('no box — the fixture is wrong, not the code under test');
    expect(isPointInWidget(box, box.x + box.width / 2, box.y + box.height / 2)).toBe(true);
    expect(isPointInWidget(box, box.x - 1, box.y + box.height / 2)).toBe(false);
    expect(isPointInWidget(box, box.x + box.width / 2, box.y + box.height + 1)).toBe(false);
  });
});
