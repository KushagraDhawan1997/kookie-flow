/**
 * The provider that costs nothing.
 *
 * It answers every request with the same two real files — a photograph for anything that is a
 * picture, a clip for anything that moves — rather than painting a stand-in. A real file is what
 * a provider's result will actually be: a large progressive JPEG and an H.264 MP4, served by range,
 * decoded by the browser, uploaded as a texture. A painted PNG only ever proved that PNGs work.
 *
 * The files live in `apps/studio/mock/`. Their sizes are stated here rather than parsed, because
 * they do not change; swap a file and measure it again (`sips` for the picture, `ffprobe` for the
 * clip) before updating its row. The mock ignores the size a node asks for — the photograph is
 * the photograph — where a real provider will honour it.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from 'studio-core';

export type FixtureKind = 'image' | 'video';

interface FixtureSpec {
  file: string;
  mime: string;
  width: number;
  height: number;
  /** Seconds; video only. */
  duration?: number;
  fps?: number;
}

export interface Fixture {
  bytes: Uint8Array<ArrayBuffer>;
  /** sha-256 of the bytes: the storage key and the asset id. */
  hash: string;
  mime: string;
  width: number;
  height: number;
  duration?: number;
  fps?: number;
}

const FIXTURES: Record<FixtureKind, FixtureSpec> = {
  // Birmingham Museums Trust, via Unsplash.
  image: { file: 'image.jpg', mime: 'image/jpeg', width: 3999, height: 2896 },
  video: { file: 'video.mp4', mime: 'video/mp4', width: 2560, height: 1440, duration: 17.951267, fps: 30000 / 1001 },
};

/**
 * Each file is read and hashed once per process. The clip is 11 MB, and every job would otherwise
 * pay to read it and hash it again to arrive at the same answer.
 */
const loaded = new Map<FixtureKind, Promise<Fixture>>();

async function load(spec: FixtureSpec): Promise<Fixture> {
  // Relative to the app, as the data directory is: `next dev` runs from `apps/studio`.
  const buffer = await fs.readFile(path.resolve(process.cwd(), 'mock', spec.file));
  // Copied out of Node's pooled buffer so the type is the plain ArrayBuffer storage requires.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return {
    bytes,
    hash: await sha256(bytes),
    mime: spec.mime,
    width: spec.width,
    height: spec.height,
    duration: spec.duration,
    fps: spec.fps,
  };
}

export function mockFixture(kind: FixtureKind): Promise<Fixture> {
  let pending = loaded.get(kind);
  if (!pending) {
    pending = load(FIXTURES[kind]);
    // A failed read is not remembered: a missing file would otherwise stay missing until restart.
    pending.catch(() => loaded.delete(kind));
    loaded.set(kind, pending);
  }
  return pending;
}
