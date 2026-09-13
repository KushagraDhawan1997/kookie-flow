import { describe, it, expect } from 'vitest';
import {
  CONTROL_BAR_HEIGHT,
  CONTROL_BAR_INSET,
  CONTROL_BUTTON_SIZE,
  CONTROL_TRACK_END_PAD,
  EXPAND_BUTTON_SIZE,
  MESH_DRAG_STRIP_HEIGHT,
  ORBIT_MAX_PITCH,
  easeChromePresence,
  fitsControls,
  fitsExpand,
  hitExpandButton,
  hitVideoControls,
  isMeshDragStrip,
  orbitDirection,
  orbitFromDirection,
  orbitFromDrag,
  seekPositionAt,
} from './media-chrome';

describe('the expand button', () => {
  const inset = CONTROL_BAR_INSET;

  it('sits in the top-right corner', () => {
    expect(hitExpandButton(W - inset - EXPAND_BUTTON_SIZE / 2, inset + EXPAND_BUTTON_SIZE / 2, W, H)).toBe(true);
  });

  it('and nowhere else: not the other corners, not the middle', () => {
    expect(hitExpandButton(inset + 4, inset + 4, W, H)).toBe(false);
    expect(hitExpandButton(W / 2, H / 2, W, H)).toBe(false);
    expect(hitExpandButton(W - inset - 4, H - inset - 4, W, H)).toBe(false);
  });

  it('never overlaps the play bar, so a clip keeps both', () => {
    const barTop = H - CONTROL_BAR_INSET - CONTROL_BAR_HEIGHT;
    expect(inset + EXPAND_BUTTON_SIZE).toBeLessThan(barTop);
  });

  it('fits media too small for a bar, and not a speck', () => {
    expect(fitsControls(90, 60)).toBe(false);
    expect(fitsExpand(90, 60)).toBe(true);
    expect(fitsExpand(40, 30)).toBe(false);
    expect(hitExpandButton(38, 10, 40, 30)).toBe(false);
  });
});

describe('chrome fading', () => {
  it('arrives, settles exactly, and leaves no entry once gone', () => {
    const presences = new Map<string, number>();
    let p = 0;
    for (let i = 0; i < 120; i++) p = easeChromePresence(presences, 'a', true, 1 / 60);
    expect(p).toBe(1);
    for (let i = 0; i < 120; i++) p = easeChromePresence(presences, 'a', false, 1 / 60);
    expect(p).toBe(0);
    expect(presences.has('a')).toBe(false);
  });
});

/**
 * Where a press lands. The drawing of these shapes is in the shader and pinned by browser laws;
 * this is the arithmetic both sides read, so the two cannot drift.
 */

const W = 320;
const H = 180;

describe('a press on a video', () => {
  const barMidY = H - CONTROL_BAR_INSET - CONTROL_BAR_HEIGHT / 2;

  it('on the button toggles play', () => {
    expect(hitVideoControls(CONTROL_BAR_INSET + 4, barMidY, W, H)?.kind).toBe('play');
  });

  it('on the track seeks, and where along it says where to', () => {
    const hit = hitVideoControls(W / 2, barMidY, W, H);
    expect(hit?.kind).toBe('seek');
    expect(hit?.t).toBeGreaterThan(0.3);
    expect(hit?.t).toBeLessThan(0.7);
  });

  it('at the far right of the track is the end of the clip', () => {
    expect(hitVideoControls(W - CONTROL_BAR_INSET, barMidY, W, H)?.t).toBe(1);
  });

  it('above the bar is not the chrome — it belongs to the entity', () => {
    expect(hitVideoControls(W / 2, H / 2, W, H)).toBeNull();
  });

  it('below the bar, in the inset, is not the chrome either', () => {
    expect(hitVideoControls(W / 2, H - 2, W, H)).toBeNull();
  });

  it('and neither is a press outside the bar horizontally', () => {
    expect(hitVideoControls(2, barMidY, W, H)).toBeNull();
    expect(hitVideoControls(W - 2, barMidY, W, H)).toBeNull();
  });

  it('a video too small for a bar has none, so a thumbnail is still just a thumbnail', () => {
    expect(fitsControls(90, 60)).toBe(false);
    expect(hitVideoControls(45, 50, 90, 60)).toBeNull();
  });
});

describe('dragging along the track', () => {
  it('past the left end holds at the start, past the right at the end', () => {
    expect(seekPositionAt(-500, W)).toBe(0);
    expect(seekPositionAt(5000, W)).toBe(1);
  });

  it('and the middle of the track is the middle of the clip', () => {
    const trackLeft = CONTROL_BAR_INSET + CONTROL_BUTTON_SIZE + 8;
    const trackRight = W - CONTROL_BAR_INSET - CONTROL_TRACK_END_PAD;
    expect(seekPositionAt((trackLeft + trackRight) / 2, W)).toBeCloseTo(0.5, 5);
  });
});

describe('a press on a model', () => {
  it('at the top is the strip that moves it', () => {
    expect(isMeshDragStrip(4, 240)).toBe(true);
  });

  it('anywhere else turns it', () => {
    expect(isMeshDragStrip(MESH_DRAG_STRIP_HEIGHT + 1, 240)).toBe(false);
    expect(isMeshDragStrip(200, 240)).toBe(false);
  });

  it('and a preview too short to spare a strip keeps all of itself for turning', () => {
    expect(isMeshDragStrip(4, 60)).toBe(false);
  });
});

describe('turning a model', () => {
  const start = { yaw: 0, pitch: 0 };

  it('dragging right turns it right', () => {
    expect(orbitFromDrag(start, 100, 0).yaw).toBeGreaterThan(0);
  });

  it('dragging down looks from below: the pointer pushes the model, not the camera', () => {
    expect(orbitFromDrag(start, 0, 100).pitch).toBeLessThan(0);
  });

  it('and it can never be pushed over the top', () => {
    expect(orbitFromDrag(start, 0, -100000).pitch).toBe(ORBIT_MAX_PITCH);
    expect(orbitFromDrag(start, 0, 100000).pitch).toBe(-ORBIT_MAX_PITCH);
  });

  it('the direction stays on the unit sphere, so distance is the model radius business', () => {
    for (const angles of [{ yaw: 0, pitch: 0 }, { yaw: 2, pitch: 0.7 }, { yaw: -1.3, pitch: -1.1 }]) {
      const d = orbitDirection(angles);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 10);
    }
  });

  it('a drag starts from the stated view: the direction survives the round trip', () => {
    const angles = orbitFromDirection(0, 0.4, 1);
    const d = orbitDirection(angles);
    const len = Math.hypot(0, 0.4, 1);
    expect(d.x).toBeCloseTo(0, 10);
    expect(d.y).toBeCloseTo(0.4 / len, 10);
    expect(d.z).toBeCloseTo(1 / len, 10);
  });

  it('and no turn at all looks from the front', () => {
    const d = orbitDirection({ yaw: 0, pitch: 0 });
    expect(d.z).toBeCloseTo(1, 10);
    expect(d.x).toBeCloseTo(0, 10);
    expect(d.y).toBeCloseTo(0, 10);
  });
});
