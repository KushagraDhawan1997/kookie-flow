import { describe, it, expect } from 'vitest';
import {
  CameraGate,
  CULL_HYSTERESIS,
  emptyCullRect,
  inflateViewRect,
  viewEscaped,
  worldViewRect,
  zoomBucket,
} from './viewport-cull';
import { ViewportCuller } from './viewport-culler';
import { Quadtree } from '../core/spatial';
import type { Entity } from '../types';

/**
 * The hysteresis is the reason a pan is cheap, so these are the laws it has to keep. Each one is
 * the executable form of a way it could go wrong and look fine:
 *
 *  - collect too tightly and the skipped frames drop things that scrolled in, which shows as
 *    nodes popping at the border of a pan and is the classic way this optimisation is quietly
 *    broken;
 *  - re-collect too eagerly and the saving is gone while the code still looks right;
 *  - miss a zoom crossing and a layer whose geometry is `px / zoom` drifts, or one gated on a
 *    zoom threshold never comes back — zooming IN only shrinks the visible rect, which stays
 *    inside the collected one, so nothing else here would ever ask again.
 */
describe('worldViewRect', () => {
  it('is the screen, in world units, under the store viewport convention', () => {
    const out = emptyCullRect();
    // screenPos = (worldPos + offset) * zoom  =>  world = (screen - offset) / zoom
    worldViewRect(out, -100, -50, 2, 800, 600);
    expect(out.left).toBe(50);
    expect(out.right).toBe(450);
    expect(out.top).toBe(25);
    expect(out.bottom).toBe(325);
  });
});

describe('inflateViewRect', () => {
  it('adds the fraction of the view and then the world padding, on every side', () => {
    const out = emptyCullRect();
    inflateViewRect(out, 0, 1000, 0, 500, 100);
    expect(out.left).toBe(-(1000 * CULL_HYSTERESIS) - 100);
    expect(out.right).toBe(1000 + 1000 * CULL_HYSTERESIS + 100);
    expect(out.top).toBe(-(500 * CULL_HYSTERESIS) - 100);
    expect(out.bottom).toBe(500 + 500 * CULL_HYSTERESIS + 100);
  });

  it('contains the view it was inflated from', () => {
    const out = emptyCullRect();
    inflateViewRect(out, 10, 1010, 20, 620);
    expect(viewEscaped(out, 10, 1010, 20, 620)).toBe(false);
  });
});

describe('zoomBucket', () => {
  it('changes on an octave and not inside one', () => {
    expect(zoomBucket(1)).toBe(zoomBucket(1.02));
    expect(zoomBucket(1)).not.toBe(zoomBucket(2));
    expect(zoomBucket(0.25)).not.toBe(zoomBucket(0.5));
  });

  it('is as sensitive at small zoom as at large, because it is a ratio', () => {
    expect(zoomBucket(0.2) - zoomBucket(0.1)).toBe(zoomBucket(20) - zoomBucket(10));
  });
});

describe('CameraGate', () => {
  const W = 1280;
  const H = 800;

  it('collects on the first ask, whatever the camera is doing', () => {
    const gate = new CameraGate();
    expect(gate.moved(0, 0, 1, W, H, 0)).toBe(true);
  });

  it('stays quiet while the screen is inside the margin', () => {
    const gate = new CameraGate();
    gate.moved(0, 0, 1, W, H, 0);
    // A tenth of the screen's width, well inside a 15% margin.
    expect(gate.moved(-W / 10, 0, 1, W, H, 0)).toBe(false);
  });

  it('re-collects once the screen leaves it', () => {
    const gate = new CameraGate();
    gate.moved(0, 0, 1, W, H, 0);
    expect(gate.moved(-W, 0, 1, W, H, 0)).toBe(true);
  });

  it('re-collects on a zoom band crossing even though zooming in only shrinks the view', () => {
    const gate = new CameraGate();
    gate.moved(0, 0, 1, W, H, 0);
    // Zooming IN: the visible world rect shrinks and is still inside the collected one, so the
    // rect test alone would never ask again.
    expect(viewEscapedAt(gate, 4)).toBe(false);
    expect(gate.moved(0, 0, 4, W, H, 0)).toBe(true);
  });

  it('re-collects after invalidate, with the camera untouched', () => {
    const gate = new CameraGate();
    gate.moved(0, 0, 1, W, H, 0);
    expect(gate.moved(0, 0, 1, W, H, 0)).toBe(false);
    gate.invalidate();
    expect(gate.moved(0, 0, 1, W, H, 0)).toBe(true);
  });

  it('covers every frame it skips: nothing can enter the screen between collects', () => {
    const gate = new CameraGate();
    gate.moved(0, 0, 1, W, H, 0);
    const view = emptyCullRect();
    // Walk one world pixel at a time until it asks again; every view along the way must have been
    // inside the rect the layer collected for, or the skipped frames were dropping visible things.
    for (let step = 1; step < 5000; step++) {
      worldViewRect(view, -step, 0, 1, W, H);
      const inside = !viewEscaped(gate.rect, view.left, view.right, view.top, view.bottom);
      if (gate.moved(-step, 0, 1, W, H, 0)) {
        expect(inside).toBe(false);
        return;
      }
      expect(inside).toBe(true);
    }
    throw new Error('the gate never re-collected — the margin is not finite');
  });

  /** Would the rect test alone report this view as escaped? */
  function viewEscapedAt(gate: CameraGate, zoom: number): boolean {
    const view = emptyCullRect();
    worldViewRect(view, 0, 0, zoom, W, H);
    return viewEscaped(gate.rect, view.left, view.right, view.top, view.bottom);
  }
});

describe('ViewportCuller', () => {
  const W = 1280;
  const H = 800;

  function board(count: number): Entity[] {
    const out: Entity[] = [];
    const cols = 40;
    for (let i = 0; i < count; i++) {
      out.push({
        id: `e${i}`,
        type: 'default',
        data: {},
        position: { x: (i % cols) * 300, y: Math.floor(i / cols) * 200 },
        width: 240,
        height: 100,
      });
    }
    return out;
  }

  function tree(entities: Entity[]): Quadtree {
    const qt = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
    qt.rebuild(entities);
    return qt;
  }

  it('collects what the rect holds and nothing the graph merely contains', () => {
    const entities = board(800);
    const qt = tree(entities);
    const culler = new ViewportCuller();

    expect(culler.refresh(qt, 0, 0, 1, W, H, 0)).toBe(true);
    expect(culler.count).toBeGreaterThan(0);
    expect(culler.count).toBeLessThan(entities.length);

    const rect = culler.rect;
    const byId = new Map(entities.map((e) => [e.id, e]));
    for (let i = 0; i < culler.count; i++) {
      const e = byId.get(culler.ids[i]);
      expect(e).toBeDefined();
      const b = e as Entity;
      const w = b.width ?? 0;
      const h = b.height ?? 0;
      expect(b.position.x + w >= rect.left && b.position.x <= rect.right).toBe(true);
      expect(b.position.y + h >= rect.top && b.position.y <= rect.bottom).toBe(true);
    }
  });

  it('misses nothing on screen — the set is a superset of a full scan of the view', () => {
    const entities = board(800);
    const qt = tree(entities);
    const culler = new ViewportCuller();
    culler.refresh(qt, -1500, -900, 1, W, H, 0);

    const view = emptyCullRect();
    worldViewRect(view, -1500, -900, 1, W, H);
    const onScreen = entities
      .filter(
        (e) =>
          e.position.x + (e.width ?? 0) >= view.left &&
          e.position.x <= view.right &&
          e.position.y + (e.height ?? 0) >= view.top &&
          e.position.y <= view.bottom
      )
      .map((e) => e.id);

    const collected = new Set(culler.ids.slice(0, culler.count));
    expect(onScreen.length).toBeGreaterThan(0);
    for (const id of onScreen) expect(collected.has(id)).toBe(true);
  });

  it('does not re-query on a pan that stays inside the margin', () => {
    const culler = new ViewportCuller();
    const qt = tree(board(400));
    culler.refresh(qt, 0, 0, 1, W, H, 0);
    const first = culler.count;
    expect(culler.refresh(qt, -40, 0, 1, W, H, 0)).toBe(false);
    expect(culler.count).toBe(first);
  });

  it('re-queries after invalidate, which is how a layer reports a moved node', () => {
    const entities = board(400);
    const qt = tree(entities);
    const culler = new ViewportCuller();
    culler.refresh(qt, 0, 0, 1, W, H, 0);
    const before = culler.count;

    // A node arrives in view without the camera moving — the case the contract exists for.
    const arriving: Entity = {
      id: 'arrived',
      type: 'default',
      data: {},
      position: { x: 100, y: 100 },
      width: 240,
      height: 100,
    };
    qt.incrementalAdd([arriving]);
    expect(culler.refresh(qt, 0, 0, 1, W, H, 0)).toBe(false);

    culler.invalidate();
    expect(culler.refresh(qt, 0, 0, 1, W, H, 0)).toBe(true);
    expect(culler.count).toBe(before + 1);
    expect(culler.ids.slice(0, culler.count)).toContain('arrived');
  });
});
