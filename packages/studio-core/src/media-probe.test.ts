import { describe, expect, it } from 'vitest';
import { probeMedia } from './media-probe';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

/** An MP4 box: size, type, payload. */
const box = (type: string, ...payload: number[][]): number[] => {
  const body = payload.flat();
  return [...be32(8 + body.length), ...ascii(type), ...body];
};

describe('probeMedia', () => {
  it('reads a PNG', () => {
    const png = bytes(
      [0x89],
      ascii('PNG'),
      [0x0d, 0x0a, 0x1a, 0x0a],
      be32(13),
      ascii('IHDR'),
      be32(640),
      be32(480),
      [8, 6, 0, 0, 0]
    );
    expect(probeMedia(png)).toEqual({ mime: 'image/png', width: 640, height: 480 });
  });

  it('reads a JPEG, past the segments before its frame', () => {
    // Each length counts its own two bytes: 14 bytes of payload is a length of 16.
    const app0 = [0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const dqt = [0xff, 0xdb, ...be16(4), 0, 0];
    const sof0 = [0xff, 0xc0, ...be16(11), 8, ...be16(300), ...be16(400), 1, 1, 0x11, 0];
    expect(probeMedia(bytes([0xff, 0xd8], app0, dqt, sof0, [0xff, 0xda]))).toEqual({
      mime: 'image/jpeg',
      width: 400,
      height: 300,
    });
  });

  it('reads the three WebP flavours', () => {
    const riff = (chunk: string, ...payload: number[][]) => {
      const body = payload.flat();
      return bytes(
        ascii('RIFF'),
        le32(4 + 8 + body.length),
        ascii('WEBP'),
        ascii(chunk),
        le32(body.length),
        body
      );
    };
    // VP8: 3 bytes of frame tag, the start code, then 14-bit width and height.
    const vp8 = riff(
      'VP8 ',
      [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a],
      le16(1024),
      le16(768),
      [0, 0, 0, 0]
    );
    expect(probeMedia(vp8)).toEqual({ mime: 'image/webp', width: 1024, height: 768 });
    // VP8L: a signature byte, then width-1 and height-1 packed in 14 bits each.
    const vp8l = riff('VP8L', [0x2f], le32((99 & 0x3fff) | ((49 & 0x3fff) << 14)), [0, 0, 0, 0]);
    expect(probeMedia(vp8l)).toEqual({ mime: 'image/webp', width: 100, height: 50 });
    // VP8X: flags, then width-1 and height-1 in 24 bits each.
    const vp8x = riff('VP8X', [0, 0, 0, 0], le24(1999), le24(999), [0, 0, 0, 0]);
    expect(probeMedia(vp8x)).toEqual({ mime: 'image/webp', width: 2000, height: 1000 });
  });

  it('reads a GIF', () => {
    expect(
      probeMedia(bytes(ascii('GIF89a'), le16(12), le16(34), [0, 0, 0, 0, 0, 0, 0, 0]))
    ).toEqual({
      mime: 'image/gif',
      width: 12,
      height: 34,
    });
  });

  it('reads an MP4: the duration from the movie header, the size from the picture track', () => {
    const fullBoxHeader = (version: number) => [version, 0, 0, 0];
    const mvhd = box(
      'mvhd',
      fullBoxHeader(0),
      be32(0),
      be32(0),
      be32(1000),
      be32(17951),
      new Array(80).fill(0)
    );
    const tkhd = (w: number, h: number) =>
      box('tkhd', fullBoxHeader(0), new Array(72).fill(0), be32(w << 16), be32(h << 16));
    const sound = box('trak', tkhd(0, 0));
    const picture = box('trak', tkhd(2560, 1440));
    const moov = box('moov', mvhd, sound, picture);
    const ftyp = box('ftyp', ascii('isom'), be32(512), ascii('isomiso2'));
    const mdat = box('mdat', [1, 2, 3, 4]);
    // The movie box after the media, as an encoder that did not fast-start leaves it.
    const probe = probeMedia(bytes(ftyp, mdat, moov));
    expect(probe?.mime).toBe('video/mp4');
    expect(probe?.width).toBe(2560);
    expect(probe?.height).toBe(1440);
    expect(probe?.duration).toBeCloseTo(17.951, 3);
  });

  it('reads the 64-bit versions of the movie and track headers', () => {
    const v1 = [1, 0, 0, 0];
    const mvhd = box(
      'mvhd',
      v1,
      new Array(16).fill(0),
      be32(90000),
      be32(0),
      be32(90000 * 3),
      new Array(80).fill(0)
    );
    const tkhd = box('tkhd', v1, new Array(84).fill(0), be32(1920 << 16), be32(1080 << 16));
    const probe = probeMedia(
      bytes(box('ftyp', ascii('isom'), be32(0)), box('moov', mvhd, box('trak', tkhd)))
    );
    expect(probe).toEqual({ mime: 'video/mp4', width: 1920, height: 1080, duration: 3 });
  });

  it('reads a fragmented file: zero in the movie header is unknown, the extension header is the length', () => {
    const v0 = [0, 0, 0, 0];
    const mvhd = box('mvhd', v0, be32(0), be32(0), be32(1000), be32(0), new Array(80).fill(0));
    const tkhd = box('tkhd', v0, new Array(72).fill(0), be32(640 << 16), be32(360 << 16));
    const trak = box('trak', tkhd);
    const ftyp = box('ftyp', ascii('iso5'), be32(512), ascii('iso5iso6'));
    // Only a `trex` under `mvex`: the length is in the fragments and nowhere else.
    const bare = probeMedia(
      bytes(ftyp, box('moov', mvhd, trak, box('mvex', box('trex', new Array(24).fill(0)))))
    );
    expect(bare).toEqual({ mime: 'video/mp4', width: 640, height: 360 });
    // With `mehd`, the fragments' total is stated up front.
    const mehd = box('mehd', v0, be32(17951));
    const stated = probeMedia(bytes(ftyp, box('moov', mvhd, trak, box('mvex', mehd))));
    expect(stated?.duration).toBeCloseTo(17.951, 3);
  });

  it('says nothing about bytes it does not know', () => {
    expect(probeMedia(new TextEncoder().encode('{"not":"a picture at all"}'))).toBeNull();
    expect(probeMedia(new Uint8Array(4))).toBeNull();
  });
});
