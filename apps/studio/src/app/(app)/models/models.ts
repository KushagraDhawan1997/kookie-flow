/**
 * The models, as Home and a model's page show them. MOCK SHAPE, REAL PRICES: the four that run
 * today carry the prices `studio-core/pricing.ts` charges from, and the rest are marked "soon" with
 * no price at all, because a price we have not checked is not one to show.
 *
 * ONE PRICE, WHAT YOU PAY. Every figure a person sees already includes the fee. The split into the
 * provider's cost and the fee is not shown per model: it is stated once, on Billing.
 *
 * A model's price sheet and its inputs are not written here. They are read from the code that
 * charges a run and from the node's own sockets, so the page cannot say something the canvas and
 * the bill do not.
 */
import {
  estimateModelMicros,
  MARKUP,
  MICROS_PER_DOLLAR,
  registry,
  titleCase,
  withFee,
  type MediaRef,
  type SocketSpec,
  type StudioSocketType,
} from 'studio-core';
import type { ProviderId } from '../../provider-logos';

export type ModelKind = 'image' | 'video' | 'edit';

export interface ModelPrice {
  /** The provider's price at its cheapest and dearest, in US dollars, before the fee. Equal for a flat price. */
  from: number;
  to: number;
  /** What one price buys: "an image", "a clip". */
  unit: string;
  /** The same, short enough for a tile: "image", "clip". */
  per: string;
  /** What moves the price, said plainly. */
  note: string;
}

/** A company that runs models for Studio. Today there is one. */
export type HostId = 'fal';

export interface Host {
  name: string;
  logo: ProviderId;
  terms: string;
  privacy: string;
}

export const HOSTS: Record<HostId, Host> = {
  fal: {
    name: 'fal',
    logo: 'fal',
    terms: 'https://fal.ai/legal/terms-of-service',
    privacy: 'https://fal.ai/legal/privacy-policy',
  },
};

/** Where a model runs: the host, the endpoints a run is sent to, and the host's own page for it. */
export interface ModelSource {
  host: HostId;
  endpoints: string[];
  page: string;
  /** The host's licence for the endpoint allows commercial use (fal's `licenseType: commercial`). */
  commercial: boolean;
}

export interface Model {
  slug: string;
  name: string;
  maker: string;
  /** The maker's mark; absent where there is none to show, and the maker's initial stands in. */
  logo?: ProviderId;
  kind: ModelKind;
  summary: string;
  /** The canvas node that runs it, for a model that runs today. */
  node?: string;
  /** Absent for a model that does not run yet. */
  price?: ModelPrice;
  source?: ModelSource;
}

export const MODELS: Model[] = [
  {
    slug: 'gpt-image-2-5',
    logo: 'openai',
    name: 'GPT Image 2.5',
    maker: 'OpenAI',
    kind: 'image',
    summary: 'Makes an image from a prompt, or changes one you give it while keeping the subject.',
    node: 'ai/gpt-image-2.5',
    price: { from: 0.004, to: 0.4, unit: 'an image', per: 'image', note: 'Priced by size and quality.' },
    source: {
      host: 'fal',
      endpoints: [
        'openai/gpt-image-2.5/flare/text-to-image',
        'openai/gpt-image-2.5/flare/edit',
        'openai/gpt-image-2.5/sunburst/text-to-image',
        'openai/gpt-image-2.5/sunburst/edit',
      ],
      page: 'https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image',
      commercial: true,
    },
  },
  {
    slug: 'wan-image-to-video',
    logo: 'alibaba',
    name: 'Wan Image to Video',
    maker: 'Alibaba',
    kind: 'video',
    summary: 'Animates a still into a short clip, moving the way your prompt describes.',
    node: 'video/wan-i2v',
    price: { from: 0.2, to: 0.5, unit: 'a clip', per: 'clip', note: 'Priced by resolution and length.' },
    source: { host: 'fal', endpoints: ['fal-ai/wan-i2v'], page: 'https://fal.ai/models/fal-ai/wan-i2v', commercial: true },
  },
  {
    slug: 'clarity-upscaler',
    name: 'Clarity Upscaler',
    maker: 'Clarity AI',
    kind: 'edit',
    summary: 'Enlarges an image up to four times and restores the fine detail.',
    node: 'ai/clarity-upscaler',
    price: { from: 0.03, to: 0.03, unit: 'a megapixel of the result', per: 'megapixel', note: 'Priced by the size of the result.' },
    source: {
      host: 'fal',
      endpoints: ['fal-ai/clarity-upscaler'],
      page: 'https://fal.ai/models/fal-ai/clarity-upscaler',
      commercial: true,
    },
  },
  {
    slug: 'birefnet',
    name: 'BiRefNet',
    maker: 'Open source',
    kind: 'edit',
    summary: 'Lifts the subject off its background and hands back a mask to keep editing.',
    node: 'ai/birefnet',
    price: {
      from: 0.008,
      to: 0.032,
      unit: 'a cutout',
      per: 'cutout',
      note: 'fal bills this model by the second, so these are typical prices.',
    },
    source: { host: 'fal', endpoints: ['fal-ai/birefnet'], page: 'https://fal.ai/models/fal-ai/birefnet', commercial: true },
  },
  { slug: 'flux-2-pro', logo: 'bfl', name: 'FLUX.2 Pro', maker: 'Black Forest Labs', kind: 'image', summary: 'Photographic images with strong prompt following.' },
  { slug: 'seedream-4', logo: 'bytedance', name: 'Seedream 4', maker: 'ByteDance', kind: 'image', summary: 'Images and edits at up to 4K.' },
  { slug: 'imagen-4', logo: 'deepmind', name: 'Imagen 4', maker: 'Google', kind: 'image', summary: 'Detailed images with legible text.' },
  { slug: 'veo-3', logo: 'deepmind', name: 'Veo 3', maker: 'Google', kind: 'video', summary: 'Video with sound, from text or an image.' },
  { slug: 'kling-2-5', logo: 'kling', name: 'Kling 2.5', maker: 'Kuaishou', kind: 'video', summary: 'Smooth motion from text or a still.' },
];

export const MODEL_KIND_LABEL: Record<ModelKind, string> = { image: 'Image', video: 'Video', edit: 'Edit' };

export function findModel(slug: string): Model | undefined {
  return MODELS.find((m) => m.slug === slug);
}

const BY_NODE = new Map(MODELS.filter((m) => m.node).map((m) => [m.node as string, m]));

/** The model a canvas node runs, so a menu of nodes can draw its maker's mark. */
export function modelForNode(type: string): Model | undefined {
  return BY_NODE.get(type);
}

/** Dollars as a person reads a small price: two places, or three where the third matters ($0.045). */
export function dollars(amount: number): string {
  const three = amount.toFixed(3);
  return `$${amount > 0 && amount < 1 && !three.endsWith('0') ? three : amount.toFixed(2)}`;
}

/**
 * Dollars for a column of prices: one number of places for all of them, so the points line up.
 * Three when any price under a dollar needs the third, else two.
 */
export function columnDollars(amounts: number[]): (amount: number) => string {
  const three = amounts.some((a) => a > 0 && a < 1 && !a.toFixed(3).endsWith('0'));
  return (amount) => `$${amount.toFixed(three ? 3 : 2)}`;
}

function paid(amount: number): number {
  return amount * (1 + MARKUP);
}

/** What a run costs you, as a range: "$0.006–$0.60", or one figure for a flat price. */
export function priceRange(price: ModelPrice): string {
  const from = paid(price.from);
  const to = paid(price.to);
  return from === to ? dollars(from) : `${dollars(from)}–${dollars(to)}`;
}

/** The cheapest run, for a tile: "From $0.006 / image". */
export function fromPrice(price: ModelPrice): string {
  return `From ${dollars(paid(price.from))} / ${price.per}`;
}

// Price sheets -----------------------------------------------------------------------------------

/** A model's prices as a table: rows by one choice, columns by another, each cell what you pay. */
export interface PriceSheet {
  /** Names the rows. */
  corner: string;
  columns: string[];
  rows: Array<{ label: string; prices: number[] }>;
}

type Ask = Record<string, unknown>;

/** What a run with these inputs costs you, in dollars: the charging code's estimate, with the fee. */
function paidFor(task: string, input: Ask): number {
  return withFee(estimateModelMicros(task, input) ?? 0).total / MICROS_PER_DOLLAR;
}

/** A picture of this size, for pricing only: nothing is looked up by its hash. */
function picture(width: number, height: number): MediaRef {
  return { kind: 'image', hash: 'price-sheet', width, height };
}

/** A select socket's options as [label, value], in the node's order, less the ones named. */
function options(node: string, key: string, skip: string[] = []): Array<[string, string]> {
  const spec = registry.get(node)?.inputs[key];
  return (spec?.options ?? [])
    .filter((value) => !skip.includes(value))
    .map((value) => [spec?.optionLabels?.[value] ?? value, value]);
}

function sheet(
  task: string,
  corner: string,
  rows: Array<[string, Ask]>,
  columns: Array<[string, Ask]>
): PriceSheet {
  return {
    corner,
    columns: columns.map(([label]) => label),
    rows: rows.map(([label, row]) => ({
      label,
      prices: columns.map(([, column]) => paidFor(task, { ...row, ...column })),
    })),
  };
}

const px = (width: number, height: number) => `${width} × ${height}`;

/** fal's GPT Image table lists these sizes; the landscape turn of each is the same price. */
const GPT_SIZES: Array<[number, number]> = [
  [1024, 768],
  [1024, 1024],
  [1536, 1024],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

const SHEETS: Record<string, () => PriceSheet> = {
  'gpt-image-2-5': () =>
    sheet(
      'gpt-image-2.5',
      'Size',
      GPT_SIZES.map(([w, h]) => [px(w, h), { size: 'custom', width: w, height: h }]),
      options('ai/gpt-image-2.5', 'quality', ['auto']).map(([label, quality]) => [label, { quality }])
    ),
  'wan-image-to-video': () =>
    sheet(
      'wan-i2v',
      'Resolution',
      options('video/wan-i2v', 'resolution').map(([label, resolution]) => [label, { resolution }]),
      [
        ['81 frames', { frames: 81 }],
        ['82 to 100 frames', { frames: 100 }],
      ]
    ),
  'clarity-upscaler': () =>
    sheet(
      'clarity-upscaler',
      'Your image',
      [
        [px(1024, 1024), { image: picture(1024, 1024) }],
        [px(1920, 1080), { image: picture(1920, 1080) }],
      ],
      [
        ['2×', { factor: 2 }],
        ['4×', { factor: 4 }],
      ]
    ),
  birefnet: () =>
    sheet(
      'birefnet',
      'Model',
      options('ai/birefnet', 'model').map(([label, model]) => [label, { model }]),
      options('ai/birefnet', 'resolution').map(([label, resolution]) => [label, { resolution }])
    ),
};

export function priceSheet(model: Model): PriceSheet | undefined {
  return SHEETS[model.slug]?.();
}

/** What connecting a picture adds to a GPT Image run, which the table leaves out. */
export function gptPicturePrice(): number {
  const ask = { quality: 'low', size: 'square_hd' };
  return paidFor('gpt-image-2.5', { ...ask, image: picture(1024, 1024) }) - paidFor('gpt-image-2.5', ask);
}

// Inputs and outputs -----------------------------------------------------------------------------

const TYPE_WORD: Record<StudioSocketType, string> = {
  image: 'Image',
  video: 'Video',
  mask: 'Mask',
  text: 'Text',
  float: 'Number',
  int: 'Whole number',
  bool: 'On or off',
  color: 'Colour',
  seed: 'Seed',
  any: 'Any',
};

export interface SocketRow {
  name: string;
  type: string;
  about?: string;
  /** The value when nobody sets it, as the node reads it. */
  fallback?: string;
}

function socketRow(key: string, spec: SocketSpec): SocketRow {
  const value = spec.default;
  const fallback =
    value === undefined || typeof value === 'object'
      ? undefined
      : typeof value === 'boolean'
        ? value
          ? 'On'
          : 'Off'
        : (spec.optionLabels?.[String(value)] ?? String(value));
  return {
    name: spec.label ?? titleCase(key),
    type: spec.options ? 'Choice' : TYPE_WORD[spec.type],
    about: spec.description,
    fallback,
  };
}

/** The node's sockets, in its order: what a run takes and what it gives. */
export function modelSockets(model: Model): { inputs: SocketRow[]; outputs: SocketRow[] } {
  const def = model.node ? registry.get(model.node) : undefined;
  if (!def) return { inputs: [], outputs: [] };
  return {
    inputs: Object.entries(def.inputs).map(([key, spec]) => socketRow(key, spec)),
    outputs: Object.entries(def.outputs).map(([key, spec]) => socketRow(key, spec)),
  };
}
