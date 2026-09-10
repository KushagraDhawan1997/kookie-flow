import { describe, it, expect } from 'vitest';
import { classifyPreviewValue, sameSource } from './preview-source';

/**
 * A preview band draws whatever its socket holds, and a socket holds whatever the app returned.
 * These tests are the guard against guessing: the band shows a picture when it was given one, and
 * stays empty rather than fetching a value that merely happens to be a string.
 */

describe('what gets drawn', () => {
  it('a picture URL', () => {
    expect(classifyPreviewValue('https://example.com/a.png')).toEqual({
      kind: 'image', src: 'https://example.com/a.png',
    });
  });

  it('a picture with no extension, which is most signed CDN links', () => {
    expect(classifyPreviewValue('https://cdn.example.com/render/42').kind).toBe('image');
  });

  it('a data URI, by its declared type', () => {
    expect(classifyPreviewValue('data:image/png;base64,iVBOR').kind).toBe('image');
    expect(classifyPreviewValue('data:video/mp4;base64,AAAA').kind).toBe('video');
    expect(classifyPreviewValue('data:model/gltf-binary;base64,Z2xU').kind).toBe('mesh');
  });

  it('a blob URL, which has no extension to read', () => {
    expect(classifyPreviewValue('blob:http://localhost/8b1-2c').kind).toBe('image');
  });

  it('a video, by extension', () => {
    for (const src of ['/clip.mp4', '/clip.webm', '/clip.MOV']) {
      expect(classifyPreviewValue(src).kind).toBe('video');
    }
  });

  it('a model, by extension', () => {
    expect(classifyPreviewValue('/duck.glb').kind).toBe('mesh');
    expect(classifyPreviewValue('/duck.gltf').kind).toBe('mesh');
  });

  it('and an extension is still an extension behind a query string', () => {
    expect(classifyPreviewValue('https://x.dev/clip.mp4?sig=abc&t=9').kind).toBe('video');
    expect(classifyPreviewValue('https://x.dev/duck.glb#node=1').kind).toBe('mesh');
  });
});

describe('what leaves the band empty', () => {
  it('nothing at all — a node that has not run yet', () => {
    expect(classifyPreviewValue(undefined).kind).toBe('none');
    expect(classifyPreviewValue(null).kind).toBe('none');
    expect(classifyPreviewValue('').kind).toBe('none');
  });

  it('a number, an object, a boolean', () => {
    expect(classifyPreviewValue(42).kind).toBe('none');
    expect(classifyPreviewValue({ src: '/a.png' }).kind).toBe('none');
    expect(classifyPreviewValue(true).kind).toBe('none');
  });

  it('a word that is not a location — an output of "done" must not be fetched', () => {
    expect(classifyPreviewValue('done').kind).toBe('none');
    expect(classifyPreviewValue('image(seed=4)').kind).toBe('none');
  });

  it('a data URI of something that is not media', () => {
    expect(classifyPreviewValue('data:text/plain,hello').kind).toBe('none');
  });
});

describe('whether the band has to be redrawn', () => {
  it('the same URL is the same source', () => {
    expect(sameSource(classifyPreviewValue('/a.png'), classifyPreviewValue('/a.png'))).toBe(true);
  });

  it('a different URL is not', () => {
    expect(sameSource(classifyPreviewValue('/a.png'), classifyPreviewValue('/b.png'))).toBe(false);
  });

  it('nor is the same URL read as a different kind', () => {
    expect(sameSource(classifyPreviewValue('/a.png'), classifyPreviewValue('/a.mp4'))).toBe(false);
  });

  it('and empty stays empty', () => {
    expect(sameSource(classifyPreviewValue(null), classifyPreviewValue(7))).toBe(true);
  });
});
