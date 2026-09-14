/**
 * What a file is and how big its picture is, read from its first bytes.
 *
 * A provider's answer does not always say: one endpoint's sizes are nullable, another's clip
 * carries no size at all, and the server that stores the file has no decoder. Every format the
 * studio stores states its size in its header, so it is read from there — a few dozen bytes for
 * a picture, a walk through the box tree for a clip. Nothing here decodes a pixel.
 */

export interface MediaProbe {
  mime: string;
  width: number;
  height: number;
  /** Seconds; video only. */
  duration?: number;
}

const ASCII = new TextDecoder('ascii');

function tag(bytes: Uint8Array, at: number, length = 4): string {
  return at + length <= bytes.length ? ASCII.decode(bytes.subarray(at, at + length)) : '';
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}
function u16le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}
function u24le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}
function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}
function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
function u64be(b: Uint8Array, at: number): number {
  return u32be(b, at) * 0x1_0000_0000 + u32be(b, at + 4);
}

/** The size and type of a picture or clip, or null for bytes that are neither in a form read here. */
export function probeMedia(bytes: Uint8Array): MediaProbe | null {
  if (bytes.length < 16) return null;
  if (bytes[0] === 0x89 && tag(bytes, 1, 3) === 'PNG') return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WEBP') return webp(bytes);
  if (tag(bytes, 0, 3) === 'GIF')
    return { mime: 'image/gif', width: u16le(bytes, 6), height: u16le(bytes, 8) };
  if (tag(bytes, 4) === 'ftyp') return mp4(bytes);
  return null;
}

/** The IHDR chunk is always first: its width and height sit at fixed offsets. */
function png(b: Uint8Array): MediaProbe | null {
  if (b.length < 24 || tag(b, 12) !== 'IHDR') return null;
  return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * Segments follow the SOI marker, each `FF xx` with a big-endian length that counts itself. The
 * size is in the first start-of-frame segment (`C0`..`CF`, except the three that are not frames),
 * which comes before the scan data, so the walk stops there.
 */
function jpeg(b: Uint8Array): MediaProbe | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Markers without a segment: restart, temporary, start of image.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image, start of scan: no frame seen
    const length = u16be(b, at + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > b.length) return null;
      return { mime: 'image/jpeg', width: u16be(b, at + 7), height: u16be(b, at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

/** Three container flavours, each with the size in its own place. */
function webp(b: Uint8Array): MediaProbe | null {
  const chunk = tag(b, 12);
  const mime = 'image/webp';
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { mime, width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = u32le(b, 21);
    return { mime, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { mime, width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** One box: where its payload starts, where it ends, and its type. */
interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = u32be(b, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = u64be(b, at + 8);
      header = 16;
    } else if (size === 0) {
      size = to - at; // to the end of the file
    }
    if (size < header) return; // not a box: stop rather than loop
    yield { type: tag(b, at + 4), start: at + header, end: Math.min(at + size, to) };
    at += size;
  }
}

/**
 * The movie header gives the duration; the first track with a size is the picture (a sound track
 * says 0 by 0). Both are full boxes whose 64-bit version moves the fields down. `moov` may sit
 * after the media data, so the whole file is walked, which is cheap: the media box is one step.
 *
 * A fragmented file — one written as it was encoded, its samples in `moof` pieces after the
 * header — states a duration of zero in the movie header, and its real length either sits in
 * the extension header (`mvex/mehd`) or is nowhere but the fragments themselves. Zero is read as
 * unknown, never as a length, so whoever made the file gets to say instead.
 */
function mp4(b: Uint8Array): MediaProbe | null {
  const brand = tag(b, 8);
  const mime = brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  let timescale = 0;
  let ticks = 0;
  let width = 0;
  let height = 0;
  for (const box of boxes(b, 0, b.length)) {
    if (box.type !== 'moov') continue;
    for (const child of boxes(b, box.start, box.end)) {
      if (child.type === 'mvhd') {
        const v1 = b[child.start] === 1;
        timescale = u32be(b, child.start + (v1 ? 20 : 12));
        ticks = v1 ? u64be(b, child.start + 24) : u32be(b, child.start + 16);
      } else if (child.type === 'mvex') {
        for (const inner of boxes(b, child.start, child.end)) {
          if (inner.type !== 'mehd' || ticks > 0) continue;
          ticks = b[inner.start] === 1 ? u64be(b, inner.start + 4) : u32be(b, inner.start + 4);
        }
      } else if (child.type === 'trak' && width === 0) {
        for (const inner of boxes(b, child.start, child.end)) {
          if (inner.type !== 'tkhd') continue;
          const v1 = b[inner.start] === 1;
          // 16.16 fixed point: the integer part is the top half.
          const w = u32be(b, inner.start + (v1 ? 88 : 76)) / 65536;
          const h = u32be(b, inner.start + (v1 ? 92 : 80)) / 65536;
          if (w > 0 && h > 0) {
            width = Math.round(w);
            height = Math.round(h);
          }
        }
      }
    }
    break;
  }
  const duration = timescale > 0 && ticks > 0 ? ticks / timescale : undefined;
  if (width === 0 && duration === undefined) return null;
  return duration === undefined ? { mime, width, height } : { mime, width, height, duration };
}
