/**
 * The two things media chrome needs that neither the pointer nor the renderer owns alone.
 *
 * A press on a video's play button happens in the pointer handler; the video element it has to
 * act on belongs to the renderer that loaded it. A drag on a model changes where its camera
 * stands; the camera belongs to the renderer too. Neither belongs in the store: an orbit is
 * sixty writes a second and would put React in the middle of a drag, which is the one thing this
 * library will not do.
 *
 * So both live here, keyed by the store object, which is what identifies one flow among however
 * many are mounted. Renderers register what they own; the pointer handler asks for it.
 */

import type { OrbitAngles } from './media-chrome';

/** What a press on a video's controls can ask for. Registered by the video renderer. */
export interface VideoOps {
  /** Play if paused, pause if playing. */
  toggle(entityId: string): void;
  /** Jump to a fraction of the clip, 0..1. */
  seek(entityId: string, t: number): void;
}

const videoRegistry = new WeakMap<object, VideoOps>();

export function registerVideoOps(key: object, ops: VideoOps | null): void {
  if (ops) videoRegistry.set(key, ops);
  else videoRegistry.delete(key);
}

export function videoOps(key: object): VideoOps | undefined {
  return videoRegistry.get(key);
}

// ---------------------------------------------------------------- orbit

const ORIGIN: OrbitAngles = { yaw: 0, pitch: 0 };

const orbits = new WeakMap<object, Map<string, OrbitAngles>>();
const listeners = new WeakMap<object, Set<() => void>>();

/** Where a model's camera stands. The origin — straight on — until someone turns it. */
export function getOrbit(key: object, entityId: string): OrbitAngles {
  return orbits.get(key)?.get(entityId) ?? ORIGIN;
}

/**
 * Turn a model. Notifies the renderer directly rather than through the store, so a drag redraws
 * one render target and nothing else — no state, no render, no subscriber woken that does not
 * draw models.
 */
export function setOrbit(key: object, entityId: string, angles: OrbitAngles): void {
  let map = orbits.get(key);
  if (!map) {
    map = new Map();
    orbits.set(key, map);
  }
  map.set(entityId, angles);
  const subs = listeners.get(key);
  if (subs) for (const fn of subs) fn();
}

/** Whether this entity has been turned at all — the renderer's cue to override its default view. */
export function hasOrbit(key: object, entityId: string): boolean {
  return orbits.get(key)?.has(entityId) ?? false;
}

export function clearOrbit(key: object, entityId: string): void {
  orbits.get(key)?.delete(entityId);
}

export function subscribeOrbit(key: object, fn: () => void): () => void {
  let subs = listeners.get(key);
  if (!subs) {
    subs = new Set();
    listeners.set(key, subs);
  }
  subs.add(fn);
  return () => { subs?.delete(fn); };
}
