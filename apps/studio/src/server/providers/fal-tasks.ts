/**
 * What each task is on fal: the endpoint, the request body built from the node's inputs, and the
 * files to take out of the answer. Pure, so it can be checked without a key.
 *
 * A task is a model, as a node is (see `studio-core/src/nodes/ai.ts`), and its body carries every
 * control the node offers under the name the endpoint gives it. Every shape here is from fal's
 * own OpenAPI document for the endpoint (`/api/openapi/queue/openapi.json?endpoint_id=...`). A
 * control the node leaves at the model's default is still sent, so what was asked is what the
 * row records. Changing a model is a change to this table and its node alone.
 */

import { isMediaRef, type MediaRef } from 'studio-core';
import { JobFailed, type OutputKind, type ProducedFile } from './provider';

/** Turns a picture the node holds into a URL fal can fetch. */
export type MediaUrl = (ref: MediaRef) => Promise<string>;

export interface FalTask {
  /** The endpoint, which for a model with flavours depends on the node's choice. */
  endpoint(input: Record<string, unknown>): string;
  /** The request body. Throws `JobFailed` for an input fal would refuse, before anything is sent. */
  body(input: Record<string, unknown>, media: MediaUrl): Promise<Record<string, unknown>>;
  /** The files in fal's answer, named for the node's output sockets. */
  files(result: Record<string, unknown>, input: Record<string, unknown>): ProducedFile[];
}

type Input = Record<string, unknown>;

/** A text the model needs. */
function text(input: Input, key: string): string {
  const s = optionalText(input, key);
  if (!s) throw new JobFailed(`${key} is empty`);
  return s;
}

/** A text the model has its own words for: undefined when the node left it empty. */
function optionalText(input: Input, key: string): string | undefined {
  const value = input[key];
  const s = typeof value === 'string' ? value.trim() : '';
  return s || undefined;
}

function num(input: Input, key: string, fallback: number): number {
  const n = Number(input[key]);
  return Number.isFinite(n) ? n : fallback;
}

function int(input: Input, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function bool(input: Input, key: string, fallback: boolean): boolean {
  const value = input[key];
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

/** One of the model's named choices, or its default for anything else. */
function choice<T extends string>(
  input: Input,
  key: string,
  options: readonly T[],
  fallback: T
): T {
  const value = input[key];
  return (options as readonly string[]).includes(String(value)) ? (value as T) : fallback;
}

function picture(input: Input, key: string): MediaRef {
  const value = input[key];
  if (!isMediaRef(value)) throw new JobFailed(`${key} is not connected`);
  return value;
}

/** A file as fal describes one: only `url` is promised. */
function file(value: unknown, name: string, kind: OutputKind): ProducedFile {
  const f = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (typeof f.url !== 'string') throw new JobFailed(`fal answered without a ${name}`);
  const out: ProducedFile = { name, kind, url: f.url };
  if (typeof f.content_type === 'string') out.mime = f.content_type;
  if (typeof f.width === 'number' && f.width > 0) out.width = f.width;
  if (typeof f.height === 'number' && f.height > 0) out.height = f.height;
  return out;
}

function firstImage(result: Record<string, unknown>): ProducedFile {
  const images = Array.isArray(result.images) ? result.images : [];
  return file(images[0], 'image', 'image');
}

// GPT Image 2.5 ---------------------------------------------------------------------------------

const GPT_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const GPT_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
const GPT_FORMATS = ['png', 'jpeg', 'webp'] as const;
const GPT_SIZES = [
  'auto',
  'custom',
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
] as const;
const GPT_MIN_PIXELS = 655_360;
const GPT_MAX_PIXELS = 8_294_400;
const GPT_MAX_EDGE = 3840;
const GPT_MAX_RATIO = 3;

function gptFlavour(input: Input): 'flare' | 'sunburst' {
  return input.variant === 'sunburst' ? 'sunburst' : 'flare';
}

/** A picture connected, to change or to draw from, makes the ask an edit. */
function gptEdits(input: Input): boolean {
  return isMediaRef(input.image) || isMediaRef(input.reference);
}

/** The controls the two GPT Image endpoints share. */
function gptCommon(input: Input): Record<string, unknown> {
  const format = choice(input, 'format', GPT_FORMATS, 'png');
  const body: Record<string, unknown> = {
    quality: choice(input, 'quality', GPT_QUALITIES, 'medium'),
    background: choice(input, 'background', GPT_BACKGROUNDS, 'auto'),
    output_format: format,
    num_images: 1,
  };
  // Compression is a JPEG and WebP idea; sent with a PNG it is refused.
  if (format !== 'png') body.output_compression = clamp(int(input, 'compression', 100), 0, 100);
  return body;
}

/**
 * A preset by name, or for `custom` the width and height, checked against the rule the endpoint
 * states before anything is spent on breaking it.
 */
function gptSize(input: Input): string | { width: number; height: number } {
  const size = choice(input, 'size', GPT_SIZES, 'auto');
  if (size !== 'custom') return size;
  const width = int(input, 'width', 1024);
  const height = int(input, 'height', 1024);
  if (width <= 0 || height <= 0) throw new JobFailed('the size must be positive');
  if (width > GPT_MAX_EDGE || height > GPT_MAX_EDGE)
    throw new JobFailed(`no side can be over ${GPT_MAX_EDGE} pixels`);
  const pixels = width * height;
  if (pixels < GPT_MIN_PIXELS)
    throw new JobFailed(
      `too small: the model wants at least ${GPT_MIN_PIXELS.toLocaleString('en')} pixels, 1024 by 640 say`
    );
  if (pixels > GPT_MAX_PIXELS)
    throw new JobFailed(
      `too large: the model takes at most ${GPT_MAX_PIXELS.toLocaleString('en')} pixels, 3840 by 2160 say`
    );
  if (Math.max(width, height) > GPT_MAX_RATIO * Math.min(width, height)) {
    throw new JobFailed(`the sides can differ by ${GPT_MAX_RATIO} to 1 at most`);
  }
  return { width, height };
}

// Wan -------------------------------------------------------------------------------------------

const WAN_RESOLUTIONS = ['480p', '720p'] as const;
const WAN_ASPECTS = ['auto', '16:9', '9:16', '1:1'] as const;
const WAN_ACCELERATIONS = ['none', 'regular'] as const;

function wanFps(input: Input): number {
  return clamp(int(input, 'fps', 16), 5, 24);
}

// BiRefNet --------------------------------------------------------------------------------------

const BIREFNET_MODELS = ['General Use (Light)', 'General Use (Heavy)', 'Portrait'] as const;
const BIREFNET_RESOLUTIONS = ['1024x1024', '2048x2048'] as const;
const BIREFNET_FORMATS = ['png', 'webp'] as const;

export const FAL_TASKS: Record<string, FalTask> = {
  /**
   * One task, two endpoints: a picture connected means an edit. The same controls go to both,
   * and the edit adds the pictures — the one to change first, a reference after it; the endpoint
   * takes up to sixteen, and the node offers two until a socket can carry a list — and the mask.
   */
  'gpt-image-2.5': {
    endpoint: (input) =>
      `openai/gpt-image-2.5/${gptFlavour(input)}/${gptEdits(input) ? 'edit' : 'text-to-image'}`,
    body: async (input, media) => {
      const body: Record<string, unknown> = {
        prompt: text(input, 'prompt'),
        image_size: gptSize(input),
        ...gptCommon(input),
      };
      if (!gptEdits(input)) return body;
      const urls: string[] = [];
      for (const key of ['image', 'reference']) {
        const ref = input[key];
        if (isMediaRef(ref)) urls.push(await media(ref));
      }
      body.image_urls = urls;
      if (isMediaRef(input.mask)) body.mask_url = await media(input.mask);
      return body;
    },
    files: (result) => [firstImage(result)],
  },

  'clarity-upscaler': {
    endpoint: () => 'fal-ai/clarity-upscaler',
    body: async (input, media) => {
      const body: Record<string, unknown> = {
        image_url: await media(picture(input, 'image')),
        upscale_factor: clamp(num(input, 'factor', 2), 1, 4),
        creativity: clamp(num(input, 'creativity', 0.35), 0, 1),
        resemblance: clamp(num(input, 'resemblance', 0.6), 0, 1),
        guidance_scale: clamp(num(input, 'guidance', 4), 0, 20),
        num_inference_steps: clamp(int(input, 'steps', 18), 4, 50),
        seed: int(input, 'seed', 0),
      };
      // Left out when empty, so the model's own words apply.
      const prompt = optionalText(input, 'prompt');
      const negative = optionalText(input, 'negative');
      if (prompt) body.prompt = prompt;
      if (negative) body.negative_prompt = negative;
      return body;
    },
    files: (result) => [file(result.image, 'image', 'image')],
  },

  birefnet: {
    endpoint: () => 'fal-ai/birefnet',
    body: async (input, media) => ({
      image_url: await media(picture(input, 'image')),
      model: choice(input, 'model', BIREFNET_MODELS, 'General Use (Light)'),
      operating_resolution: choice(input, 'resolution', BIREFNET_RESOLUTIONS, '1024x1024'),
      output_format: choice(input, 'format', BIREFNET_FORMATS, 'png'),
      refine_foreground: bool(input, 'refine', true),
      // The mask is an output socket, so it is always asked for.
      output_mask: true,
    }),
    files: (result) => [
      file(result.image, 'image', 'image'),
      file(result.mask_image, 'mask', 'mask'),
    ],
  },

  'wan-i2v': {
    endpoint: () => 'fal-ai/wan-i2v',
    body: async (input, media) => {
      const body: Record<string, unknown> = {
        prompt: text(input, 'prompt'),
        image_url: await media(picture(input, 'image')),
        num_frames: clamp(int(input, 'frames', 81), 81, 100),
        frames_per_second: wanFps(input),
        resolution: choice(input, 'resolution', WAN_RESOLUTIONS, '720p'),
        aspect_ratio: choice(input, 'aspect', WAN_ASPECTS, 'auto'),
        guide_scale: clamp(num(input, 'guidance', 5), 1, 10),
        shift: clamp(num(input, 'shift', 5), 1, 10),
        num_inference_steps: clamp(int(input, 'steps', 30), 2, 40),
        enable_prompt_expansion: bool(input, 'expand', false),
        acceleration: choice(input, 'acceleration', WAN_ACCELERATIONS, 'regular'),
        seed: int(input, 'seed', 0),
      };
      const negative = optionalText(input, 'negative');
      if (negative) body.negative_prompt = negative;
      return body;
    },
    files: (result, input) => {
      const video = file(result.video, 'video', 'video');
      // The clip's header may not say; the rate asked for is the rate made.
      video.fps = wanFps(input);
      return [video];
    },
  },
};
