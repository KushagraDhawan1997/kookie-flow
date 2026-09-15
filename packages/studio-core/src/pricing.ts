/**
 * What a model run costs, and what a person pays for it.
 *
 * Money is whole millionths of a US dollar ("micros") everywhere, so a $0.00402 picture is an
 * exact integer and a sum of a thousand of them has no rounding drift.
 *
 * THE MARKUP IS STATED, NOT HIDDEN. A person pays the model's price plus `MARKUP` of it, and both
 * halves are shown and recorded separately. The model prices are fal's published ones, checked on
 * 2026-09-15 against fal's pricing API (`/v1/models/pricing`) and the model pages:
 *
 * - GPT Image 2.5 (Flare and Sunburst): billed by tokens; the page publishes a table by size and
 *   quality, which is what is charged here, at the nearest listed size. A connected picture adds
 *   input image tokens, estimated at $0.01 each.
 * - Clarity Upscaler: $0.03 per megapixel of the result.
 * - BiRefNet: $0.0008 per compute second, estimated at 10 s (20 s for the heavy model, doubled
 *   at 2048 × 2048), since fal does not report the seconds it used.
 * - Wan image to video: $0.40 at 720p, $0.20 at 480p, and 1.25× past 81 frames.
 *
 * Pure: no DOM, no server. The server charges with it and the inspector quotes with it, so the
 * price a person is shown is the price they are charged.
 */

import { isMediaRef } from './values';

/** The service fee, as a fraction of the model's price. */
export const MARKUP = 0.5;

export const MICROS_PER_DOLLAR = 1_000_000;

/** A run's price in micros, split the way it is shown. */
export interface Charge {
  model: number;
  fee: number;
  total: number;
}

export function withFee(modelMicros: number): Charge {
  const model = Math.max(0, Math.round(modelMicros));
  const fee = Math.round(model * MARKUP);
  return { model, fee, total: model + fee };
}

/** `$1.25`, and four places under a cent so a $0.0040 picture does not read as free. */
export function formatUsd(micros: number): string {
  const dollars = micros / MICROS_PER_DOLLAR;
  const abs = Math.abs(dollars);
  const places = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${dollars < 0 ? '−' : ''}$${abs.toFixed(places)}`;
}

/** Which task a node type asks the server for. */
export const TASK_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  'ai/gpt-image-2.5': 'gpt-image-2.5',
  'ai/clarity-upscaler': 'clarity-upscaler',
  'ai/birefnet': 'birefnet',
  'video/wan-i2v': 'wan-i2v',
};

const usd = (dollars: number) => Math.round(dollars * MICROS_PER_DOLLAR);

// GPT Image 2.5 ---------------------------------------------------------------------------------

type Quality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** fal's table, short side first: a size and its turn on end are the same price. */
const GPT_TABLE: ReadonlyArray<{ short: number; long: number; price: Record<Quality, number> }> = [
  { short: 768, long: 1024, price: { low: 0.00402, medium: 0.00903, high: 0.03612, xhigh: 0.0642, max: 0.14445 } },
  { short: 1024, long: 1024, price: { low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 } },
  { short: 1024, long: 1536, price: { low: 0.00474, medium: 0.01029, high: 0.04116, xhigh: 0.07377, max: 0.16464 } },
  { short: 1080, long: 1920, price: { low: 0.00441, medium: 0.01029, high: 0.0396, xhigh: 0.07041, max: 0.1584 } },
  { short: 1440, long: 2560, price: { low: 0.00615, medium: 0.01434, high: 0.05529, xhigh: 0.09828, max: 0.2211 } },
  { short: 2160, long: 3840, price: { low: 0.01113, medium: 0.02595, high: 0.10008, xhigh: 0.1779, max: 0.40026 } },
];

/** fal's size presets, as the pixels they ask for. */
const GPT_PRESETS: Readonly<Record<string, readonly [number, number]>> = {
  square_hd: [1024, 1024],
  square: [512, 512],
  portrait_4_3: [768, 1024],
  portrait_16_9: [576, 1024],
  landscape_4_3: [1024, 768],
  landscape_16_9: [1024, 576],
};

const GPT_INPUT_PICTURE = usd(0.01);

function quality(value: unknown): Quality {
  // `auto` is fal's default, which it documents as high.
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
    ? value
    : 'high';
}

/** The listed size nearest this one, by area and then by shape. */
function gptPrice(width: number, height: number, q: Quality): number {
  const short = Math.max(1, Math.min(width, height));
  const long = Math.max(1, Math.max(width, height));
  let best = GPT_TABLE[1];
  let bestDistance = Infinity;
  for (const row of GPT_TABLE) {
    const area = Math.abs(Math.log((short * long) / (row.short * row.long)));
    const shape = Math.abs(Math.log(long / short / (row.long / row.short)));
    const distance = area * 2 + shape;
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return usd(best.price[q]);
}

function connectedPictures(input: Record<string, unknown>): number {
  let n = 0;
  for (const key of ['image', 'reference', 'mask']) if (isMediaRef(input[key])) n++;
  return n;
}

function gptEstimate(input: Record<string, unknown>): number {
  const q = quality(input.quality);
  const size = input.size;
  let pixels: readonly [number, number] = [1024, 1024];
  if (size === 'custom') pixels = [Number(input.width) || 1024, Number(input.height) || 1024];
  else if (typeof size === 'string' && GPT_PRESETS[size]) pixels = GPT_PRESETS[size];
  else if (isMediaRef(input.image) && input.image.width > 0) pixels = [input.image.width, input.image.height];
  // `auto` with nothing to follow: the dearest of the one-megapixel sizes, so a hold is never short.
  return gptPrice(pixels[0], pixels[1], q) + connectedPictures(input) * GPT_INPUT_PICTURE;
}

// The rest --------------------------------------------------------------------------------------

function megapixels(width: number, height: number): number {
  return (Math.max(0, width) * Math.max(0, height)) / 1_000_000;
}

function birefnetMicros(input: Record<string, unknown>): number {
  let seconds = input.model === 'General Use (Heavy)' ? 20 : 10;
  if (input.resolution === '2048x2048') seconds *= 2;
  return usd(0.0008 * seconds);
}

function wanMicros(input: Record<string, unknown>): number {
  const base = input.resolution === '480p' ? 0.2 : 0.4;
  return usd(Number(input.frames ?? 81) > 81 ? base * 1.25 : base);
}

/**
 * The model's price before a run, from what the node asks for: the amount held against the
 * balance. Undefined for a task with no price, which the server refuses to run.
 */
export function estimateModelMicros(task: string, input: Record<string, unknown>): number | undefined {
  switch (task) {
    case 'gpt-image-2.5':
      return gptEstimate(input);
    case 'clarity-upscaler': {
      const image = input.image;
      if (!isMediaRef(image)) return 0;
      const factor = Math.min(4, Math.max(1, Number(input.factor) || 2));
      return usd(0.03 * megapixels(image.width * factor, image.height * factor));
    }
    case 'birefnet':
      return birefnetMicros(input);
    case 'wan-i2v':
      return wanMicros(input);
    default:
      return undefined;
  }
}

/**
 * The model's price after a run, from what it made: what is charged. Where the result says
 * nothing the estimate stands.
 */
export function actualModelMicros(
  task: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> | null | undefined
): number | undefined {
  const image = output?.image;
  if (task === 'gpt-image-2.5' && isMediaRef(image) && image.width > 0) {
    return gptPrice(image.width, image.height, quality(input.quality)) + connectedPictures(input) * GPT_INPUT_PICTURE;
  }
  if (task === 'clarity-upscaler' && isMediaRef(image) && image.width > 0) {
    return usd(0.03 * megapixels(image.width, image.height));
  }
  return estimateModelMicros(task, input);
}
