import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

/**
 * A font atlas is loaded once per URL, not once per render.
 *
 * An atlas is a 512x512 RGBA texture — roughly 1MB of GPU memory per weight, two per font — and
 * `loadTexture` minted a fresh one on every run of the font-loading effect. That effect is keyed on
 * the `font` PROP, so a consumer writing an inline `font={{ name, weights }}` object hands it a new
 * identity on every render: every render of the host component uploaded two more atlases and
 * dropped the previous pair, with nothing disposing them.
 *
 * The repair is a URL-keyed cache rather than a disposal protocol, which is the trade
 * `text-renderer.tsx` already made for the same asset class one file over. It makes the leak
 * structurally impossible instead of guarded — two configs naming one atlas ARE one texture, so
 * there is nothing to dispose and no window in which a live uniform can point at a disposed one.
 */

const loaded: string[] = [];

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class CountingLoader {
    load(url: string) {
      loaded.push(url);
      return new actual.Texture();
    }
  }
  return { ...actual, TextureLoader: CountingLoader };
});

const { __testing } = await import('./FontContext');

beforeEach(() => {
  loaded.length = 0;
  __testing.clearAtlasCache();
});

describe('font atlas loading', () => {
  it('the same URL is uploaded once', () => {
    const a = __testing.loadTexture('atlas.png');
    const b = __testing.loadTexture('atlas.png');
    expect(loaded).toEqual(['atlas.png']);
    expect(b).toBe(a);
  });

  it('a different URL is a different texture', () => {
    // The guard against a cache that returns one texture for everything.
    const a = __testing.loadTexture('regular.png');
    const b = __testing.loadTexture('semibold.png');
    expect(loaded).toEqual(['regular.png', 'semibold.png']);
    expect(b).not.toBe(a);
  });

  it('a hundred renders of an inline font config upload two atlases, not two hundred', () => {
    // The shape that made this severe: a fresh config object each render, naming the same files.
    for (let i = 0; i < 100; i++) {
      __testing.loadTexture('regular.png');
      __testing.loadTexture('semibold.png');
    }
    expect(loaded).toHaveLength(2);
  });

  it('the texture is configured the way MSDF needs', () => {
    // Caching must not turn into not-configuring: an atlas with flipY or mipmaps renders wrong.
    const tex = __testing.loadTexture('atlas.png') as THREE.Texture;
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });
});
