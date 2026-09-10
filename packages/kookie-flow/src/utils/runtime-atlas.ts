/**
 * The system font, turned into something the GPU can draw.
 *
 * Every other font here arrives as a pre-baked MSDF atlas built offline. The system font cannot:
 * nobody knows what it is until the page is open, and it differs by machine. So `font="system"`
 * builds its atlas AT RUNTIME — rasterise each glyph with the 2D canvas, turn each cell into a
 * signed distance field, and hand the result to the same loader every other preset uses.
 *
 * A PLAIN SDF, NOT AN MSDF. A multi-channel field needs the outline, and the 2D canvas will not
 * give it — only pixels. A single-channel field is the honest thing that can be built from
 * pixels, and it costs one thing: corners sharper than the field's radius round off slightly.
 * The shader needs no change at all, because it takes the MEDIAN of the three channels, and the
 * median of three equal numbers is that number. So the field is written to R, G and B alike.
 *
 * The distance transform is exact — Felzenszwalb's two-pass squared-Euclidean method — rather
 * than the usual approximation. It costs one pass over the cell in each axis, which for a few
 * hundred glyph cells is a few milliseconds, once, at mount.
 */

import type { FontMetrics, GlyphMetrics } from './text-layout';

/** The glyphs an atlas holds. ASCII, plus the punctuation real interfaces are written with. */
export const DEFAULT_CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '©«»°·×–—‘’“”•…€£¥→←↑↓±≤≥∞';

/** How big each glyph is rasterised. Big enough that a field has room; small enough to be quick. */
export const ATLAS_FONT_SIZE = 48;
/**
 * How far, in atlas pixels, the field reaches either side of an edge.
 *
 * This is the whole quality knob. Too small and the antialiasing has nothing to interpolate at
 * large sizes; too large and thin stems are swallowed by their own field.
 */
export const DISTANCE_RANGE = 6;

/**
 * The exact squared-Euclidean distance transform of one row, in place.
 *
 * Felzenszwalb & Huttenlocher's lower envelope: it walks the row maintaining the parabolas that
 * form the lower boundary of all the distance cones, which is what makes it linear rather than
 * quadratic. `f` holds the squared distance already known for each cell.
 */
export function edt1d(f: Float64Array, n: number, out: Float64Array): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/** The same, over a whole grid: rows then columns, which is what makes the result exact. */
export function edt2d(grid: Float64Array, width: number, height: number): void {
  const row = new Float64Array(Math.max(width, height));
  const out = new Float64Array(Math.max(width, height));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = grid[y * width + x];
    edt1d(row, width, out);
    for (let x = 0; x < width; x++) grid[y * width + x] = out[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) row[y] = grid[y * width + x];
    edt1d(row, height, out);
    for (let y = 0; y < height; y++) grid[y * width + x] = out[y];
  }
}

/**
 * A signed distance field from a coverage mask.
 *
 * 0..255, with 128 on the edge: inside is above, outside below, and `range` says how many pixels
 * the ramp covers. That is the encoding every MSDF atlas uses, so the shader and the layout code
 * do not have to know where a field came from.
 */
export function signedDistanceField(
  alpha: Uint8Array,
  width: number,
  height: number,
  range: number
): Uint8Array {
  const size = width * height;
  const inside = new Float64Array(size);
  const outside = new Float64Array(size);
  const INF = 1e20;

  for (let i = 0; i < size; i++) {
    const on = alpha[i] > 127;
    // Distance to the nearest pixel of the OTHER kind: zero where you already are.
    inside[i] = on ? INF : 0;
    outside[i] = on ? 0 : INF;
  }

  edt2d(inside, width, height);
  edt2d(outside, width, height);

  const field = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    /**
     * Signed: positive inside the glyph, negative outside, in pixels.
     *
     * `inside` holds, for an ON pixel, how far it is from the nearest OFF one — which is how deep
     * inside the glyph it sits. `outside` is the mirror. Exactly one of the two is non-zero for
     * any pixel, so subtracting gives the signed distance with no branch.
     */
    const raw = Math.sqrt(inside[i]) - Math.sqrt(outside[i]);
    /**
     * Half a pixel back, either way.
     *
     * A transform over a MASK measures centre to centre, so the pixel just inside an edge comes
     * out a whole pixel deep when it is really half of one — the edge runs between the two pixel
     * centres, not through the outer one. Left uncorrected every glyph is drawn half a pixel fat,
     * which at small sizes is the difference between text and a smudge.
     */
    const distance = raw > 0 ? raw - 0.5 : raw + 0.5;
    const value = 0.5 + distance / (2 * range);
    field[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
  }
  return field;
}

export interface RuntimeAtlas {
  metrics: FontMetrics;
  /** A data URL of the atlas page, ready for the same texture loader every preset uses. */
  atlasUrl: string;
}

export interface RuntimeAtlasOptions {
  /** A CSS font family list. Defaults to the platform's UI font. */
  family?: string;
  /** 400, 600, whatever the platform has. */
  weight?: number;
  charset?: string;
}

/**
 * Build an atlas for a CSS font, here and now.
 *
 * Returns null where there is no 2D canvas to draw on — server rendering, a jsdom without one —
 * so the caller falls back the same way it would for a font that failed to load.
 */
export function buildRuntimeAtlas(options: RuntimeAtlasOptions = {}): RuntimeAtlas | null {
  if (typeof document === 'undefined') return null;

  const family = options.family ??
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const weight = options.weight ?? 400;
  const charset = options.charset ?? DEFAULT_CHARSET;

  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  if (!measure) return null;
  measure.font = `${weight} ${ATLAS_FONT_SIZE}px ${family}`;

  const pad = DISTANCE_RANGE + 2;
  // One cell per glyph, all the same size: a grid is far simpler than a packer and wastes atlas
  // space that costs nothing at these dimensions.
  const cellWidth = Math.ceil(ATLAS_FONT_SIZE * 1.4) + pad * 2;
  const cellHeight = Math.ceil(ATLAS_FONT_SIZE * 1.6) + pad * 2;
  const columns = Math.ceil(Math.sqrt(charset.length));
  const rows = Math.ceil(charset.length / columns);
  const atlasWidth = nextPowerOfTwo(columns * cellWidth);
  const atlasHeight = nextPowerOfTwo(rows * cellHeight);

  const cell = document.createElement('canvas');
  cell.width = cellWidth;
  cell.height = cellHeight;
  const cellCtx = cell.getContext('2d', { willReadFrequently: true });
  if (!cellCtx) return null;

  const atlas = document.createElement('canvas');
  atlas.width = atlasWidth;
  atlas.height = atlasHeight;
  const atlasCtx = atlas.getContext('2d');
  if (!atlasCtx) return null;

  // The baseline sits low enough in the cell that ascenders and descenders both fit.
  const baseline = Math.round(cellHeight * 0.72);
  const chars: GlyphMetrics[] = [];

  for (let i = 0; i < charset.length; i++) {
    const char = charset[i];
    cellCtx.clearRect(0, 0, cellWidth, cellHeight);
    cellCtx.font = `${weight} ${ATLAS_FONT_SIZE}px ${family}`;
    cellCtx.fillStyle = '#fff';
    cellCtx.textBaseline = 'alphabetic';
    cellCtx.fillText(char, pad, baseline);

    const metrics = cellCtx.measureText(char);
    const image = cellCtx.getImageData(0, 0, cellWidth, cellHeight);
    const mask = new Uint8Array(cellWidth * cellHeight);
    for (let p = 0; p < mask.length; p++) mask[p] = image.data[p * 4 + 3];

    const field = signedDistanceField(mask, cellWidth, cellHeight, DISTANCE_RANGE);
    const out = atlasCtx.createImageData(cellWidth, cellHeight);
    for (let p = 0; p < field.length; p++) {
      // The same value in all three channels: the shader takes their median.
      out.data[p * 4] = field[p];
      out.data[p * 4 + 1] = field[p];
      out.data[p * 4 + 2] = field[p];
      out.data[p * 4 + 3] = 255;
    }
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    atlasCtx.putImageData(out, x, y);

    chars.push({
      id: char.charCodeAt(0),
      char,
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      // The cell was drawn with the pen at (pad, baseline), so the glyph's origin sits there.
      xoffset: -pad,
      yoffset: -baseline,
      xadvance: metrics.width,
      page: 0,
      chnl: 15,
    });
  }

  const metrics: FontMetrics = {
    pages: ['runtime'],
    chars,
    info: {
      face: 'system',
      size: ATLAS_FONT_SIZE,
      bold: weight >= 600 ? 1 : 0,
      italic: 0,
      charset: charset.split(''),
      padding: [pad, pad, pad, pad],
      spacing: [0, 0],
    },
    common: {
      // The two numbers text layout actually reads: where the baseline sits and how far apart
      // two lines are. Both are in the same units as `size`.
      lineHeight: Math.round(ATLAS_FONT_SIZE * 1.25),
      base: Math.round(ATLAS_FONT_SIZE * 0.8),
      scaleW: atlasWidth,
      scaleH: atlasHeight,
      pages: 1,
      packed: 0,
    },
    distanceField: { fieldType: 'sdf', distanceRange: DISTANCE_RANGE },
  };

  return { metrics, atlasUrl: atlas.toDataURL('image/png') };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
