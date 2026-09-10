import { describe, it, expect } from 'vitest';
import { mediaEntity, mediaKindOfFile, mediaKindOfUrl } from './media-paste';

/**
 * Pasting a picture into a canvas has to put a picture on the canvas. These are the two questions
 * that decides: is this media, and what kind.
 */

describe('a file that arrived', () => {
  it('an image, by its type', () => {
    expect(mediaKindOfFile({ name: 'a.png', type: 'image/png' })).toBe('image');
  });

  it('a video, by its type', () => {
    expect(mediaKindOfFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video');
  });

  it('a model, by its name — because the browser rarely knows glTF', () => {
    expect(mediaKindOfFile({ name: 'duck.glb', type: '' })).toBe('mesh');
    expect(mediaKindOfFile({ name: 'duck.GLTF', type: 'application/octet-stream' })).toBe('mesh');
  });

  it('and a model whose type IS known', () => {
    expect(mediaKindOfFile({ name: 'x', type: 'model/gltf-binary' })).toBe('mesh');
  });

  it('anything else belongs to the app, not to the canvas', () => {
    expect(mediaKindOfFile({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(mediaKindOfFile({ name: 'sheet.csv', type: 'text/csv' })).toBeNull();
    expect(mediaKindOfFile({ name: 'report.pdf', type: 'application/pdf' })).toBeNull();
  });
});

describe('a URL that arrived', () => {
  it('is read by extension', () => {
    expect(mediaKindOfUrl('https://x.dev/a.png')).toBe('image');
    expect(mediaKindOfUrl('https://x.dev/a.mp4')).toBe('video');
    expect(mediaKindOfUrl('/models/duck.glb')).toBe('mesh');
  });

  it('behind a query string, which every signed URL has', () => {
    expect(mediaKindOfUrl('https://x.dev/a.png?sig=abc&t=2')).toBe('image');
  });

  it('or by its data URI type', () => {
    expect(mediaKindOfUrl('data:image/png;base64,iVBO')).toBe('image');
    expect(mediaKindOfUrl('data:video/mp4;base64,AAAA')).toBe('video');
  });

  it('and text that is not a location is just text', () => {
    expect(mediaKindOfUrl('hello world')).toBeNull();
    expect(mediaKindOfUrl('image.png is the file')).toBeNull();
  });

  it('nor is a URL to something that is not media', () => {
    expect(mediaKindOfUrl('https://x.dev/page.html')).toBeNull();
    expect(mediaKindOfUrl('https://x.dev/')).toBeNull();
  });
});

describe('the entity it becomes', () => {
  it('is centred on where it arrived, not hung off it', () => {
    const e = mediaEntity('image', '/a.png', { x: 500, y: 300 }, 'n1');
    expect(e.position.x + (e.width ?? 0) / 2).toBe(500);
    expect(e.position.y + (e.height ?? 0) / 2).toBe(300);
  });

  it('carries the source under the key its renderer reads', () => {
    expect((mediaEntity('mesh', '/duck.glb', { x: 0, y: 0 }, 'n').data as { src?: string }).src)
      .toBe('/duck.glb');
  });

  it('and a pasted video plays, because a still frame reads as a broken one', () => {
    const data = mediaEntity('video', '/c.mp4', { x: 0, y: 0 }, 'n').data as { autoplay?: boolean };
    expect(data.autoplay).toBe(true);
  });

  it('each kind opens at its own size', () => {
    const image = mediaEntity('image', 'a', { x: 0, y: 0 }, '1');
    const video = mediaEntity('video', 'a', { x: 0, y: 0 }, '2');
    expect(image.width).not.toBe(video.width);
  });
});
