/**
 * The generation nodes, one per model.
 *
 * A node IS a model, named for it, and its inputs are that model's own controls with that
 * model's own defaults — what the endpoint's document lists, no more and no less. A node that
 * stood for a task ("generate image") had to hide what any one model offered and invent what
 * none did. When a model gains a control, its node gains a socket; a new model gets a new node.
 * What the endpoint takes that a graph cannot yet carry (a list of reference pictures, a count of
 * images) waits for list sockets; what it takes that nobody should touch (the safety switch) is
 * left alone.
 *
 * Every one runs `where: 'server'` and `evaluation: 'manual'`, and the two go together: a node
 * that costs money must never run because a slider moved. The engine marks it stale and waits
 * for Run.
 *
 * None of them knows what a provider is. They ask `ctx.jobs` for a task by name and get outputs
 * back; whether that was fal, a local mock, or a queue that survived the tab is the port's
 * business. The same ask with the same inputs is answered from what was already made, so a node
 * asks on every run and pays only for a new one.
 */

import { defineNode, socket, type SocketSpec } from '../define';
import type { RunContext } from '../ports';
import { isMediaRef, type MediaRef } from '../values';

/** Ask the jobs port for one task and pull a named media output off the answer. */
async function generate(
  task: string,
  input: Record<string, unknown>,
  ctx: RunContext,
  key: string
): Promise<MediaRef | undefined> {
  const { output } = await ctx.jobs.run({
    entityId: ctx.entityId,
    task,
    input,
    signal: ctx.signal,
    progress: ctx.progress,
  });
  const value = output[key];
  return isMediaRef(value) ? value : undefined;
}

/**
 * A prompt names `textarea`, not just `rows`.
 *
 * The widget type is what decides the corner: a field takes the control radius whole, and at
 * `radius="full"` that is the pill sentinel, which the shader clamps to half the box it is given.
 * On a one-row field that is a pill and correct; on a three-row field it is a circle. `wellRadius`
 * clamps a text area back to one row's corner, and it is keyed on the type — so a multi-row field
 * that forgot to say `textarea` gets the circle.
 */
function prompt(
  rows: number,
  placeholder: string,
  description: string,
  label?: string
): SocketSpec<'text'> {
  // `stacked`, as the Text source node does it: a prompt is the thing you came to the node to
  // write, and inline puts it in the half-width column beside its own label.
  return socket('text', {
    widget: 'textarea',
    rows,
    layout: 'stacked',
    placeholder,
    description,
    label,
  });
}

/** One of a model's named choices, with the model's default. */
function choice(
  options: string[],
  fallback: string,
  description: string,
  label?: string
): SocketSpec<'text'> {
  return socket('text', { widget: 'select', options, default: fallback, description, label });
}

/** Wider than a math node: these carry a prompt and a picture, not two numbers. */
const NODE_WIDTH = 300;

// GPT Image 2.5 ---------------------------------------------------------------------------------

/**
 * The two flavours of the one model, with the same controls: Flare is the everyday one, fast
 * and cheap; Sunburst is the exact one, slower and dearer, for work that will be looked at
 * closely. One node and a choice, rather than two nodes that differ in nothing else.
 */
const variant = choice(
  ['flare', 'sunburst'],
  'flare',
  'Flare is fast and the usual choice. Sunburst is slower, dearer and more exact.'
);
const quality = choice(
  ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
  'medium',
  'More detail is slower and costs more. Auto lets the model choose.'
);
const background = choice(
  ['auto', 'transparent', 'opaque'],
  'auto',
  'Transparent needs PNG or WebP.'
);
const format = choice(['png', 'jpeg', 'webp'], 'png', 'The kind of file to make.');
const compression = socket('int', {
  min: 0,
  max: 100,
  step: 1,
  default: 100,
  description: 'JPEG and WebP only. 100 keeps everything; lower is a smaller file.',
});

/**
 * GPT Image takes no seed: the same prompt gives a different picture every time, and this is
 * the knob that asks for another one. Unchanged, a re-run returns the picture already made
 * rather than paying for a new one.
 */
const reroll = socket('seed', {
  label: 'Reroll',
  default: 0,
  description:
    'This model takes no seed. Change this to ask for another picture from the same settings.',
});

/**
 * An explicit size, in pixels, for when Size says custom. The model wants between 655,360 and
 * 8,294,400 of them, no side over 3840 and the sides within 3 to 1 of each other; the server
 * refuses an ask outside that before anything is spent, since a slider cannot hold a rule about
 * two numbers at once.
 */
const width = socket('int', {
  min: 512,
  max: 3840,
  step: 64,
  default: 1024,
  description: 'Pixels across, when Size is custom.',
});
const height = socket('int', {
  min: 512,
  max: 3840,
  step: 64,
  default: 1024,
  description: 'Pixels down, when Size is custom.',
});

const SIZE_PRESETS = [
  'auto',
  'custom',
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
];

/** Sunburst costs about twice what Flare does, and each quality step about doubles again. */
function gptCredits(inputs: Record<string, unknown>): number {
  const flavour = inputs.variant === 'sunburst' ? 2 : 1;
  const detail: Record<string, number> = { low: 1, medium: 2, high: 4, xhigh: 8, max: 12, auto: 4 };
  return flavour * (detail[String(inputs.quality)] ?? 2);
}

function gptSeconds(inputs: Record<string, unknown>): number {
  return inputs.variant === 'sunburst' ? 40 : 15;
}

/**
 * One node for the one model. Making a picture and changing one are two endpoints on fal, but to
 * the person at the canvas they are the same act with or without a picture plugged in — so the
 * picture sockets are optional, and the server goes to the edit endpoint when one is connected.
 */
export const gptImage = defineNode({
  type: 'ai/gpt-image-2.5',
  label: 'GPT Image 2.5',
  category: 'ai',
  description:
    "OpenAI's picture model. A prompt alone makes a picture; with a picture connected it changes that one, keeping the subject and composition. Flare for most work, Sunburst for the finest detail. Costs credits and runs only when you press Run.",
  inputs: {
    prompt: prompt(3, 'A lighthouse in fog', 'What to draw, or the change to make.'),
    image: socket('image', { description: 'A picture to change. Empty makes a new one.' }),
    reference: socket('image', { description: 'Another picture to draw from, if any.' }),
    mask: socket('mask', {
      description: 'Which part of the picture may change, if not all of it.',
    }),
    variant,
    quality,
    size: choice(
      SIZE_PRESETS,
      'auto',
      'Auto follows the picture, or lets the model choose. Custom uses Width and Height.'
    ),
    width,
    height,
    background,
    format,
    compression,
    reroll,
  },
  outputs: { image: socket('image') },
  evaluation: 'manual',
  where: 'server',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    image: await generate('gpt-image-2.5', { ...inputs }, ctx, 'image'),
  }),
  estimate: (inputs) => ({ credits: gptCredits(inputs), seconds: gptSeconds(inputs) }),
});

// Clarity Upscaler ------------------------------------------------------------------------------

export const clarityUpscaler = defineNode({
  type: 'ai/clarity-upscaler',
  label: 'Clarity Upscaler',
  category: 'ai',
  description:
    'Enlarge a picture and invent the detail that enlarging it would otherwise lose. Creativity is how much it invents; resemblance is how closely it keeps to the original.',
  inputs: {
    image: socket('image'),
    factor: socket('float', {
      min: 1,
      max: 4,
      step: 0.5,
      default: 2,
      description: 'How many times larger.',
    }),
    prompt: prompt(
      2,
      'masterpiece, best quality, highres',
      "What the new detail should look like. Empty uses the model's own words."
    ),
    negative: prompt(
      2,
      '(worst quality, low quality, normal quality:2)',
      "What it should not look like. Empty uses the model's own words.",
      'Avoid'
    ),
    creativity: socket('float', {
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      description: 'How much new detail to invent.',
    }),
    resemblance: socket('float', {
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      description: 'How closely to keep to the original.',
    }),
    guidance: socket('float', {
      min: 0,
      max: 20,
      step: 0.5,
      default: 4,
      description: 'How closely to follow the prompt.',
    }),
    steps: socket('int', {
      min: 4,
      max: 50,
      step: 1,
      default: 18,
      description: 'More is slower and finer.',
    }),
    seed: socket('seed', {
      default: 0,
      description: 'The same seed and settings give the same picture.',
    }),
  },
  outputs: { image: socket('image') },
  evaluation: 'manual',
  where: 'server',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    image: await generate('clarity-upscaler', { ...inputs }, ctx, 'image'),
  }),
  estimate: (inputs) => ({ credits: 2, seconds: 4 * Number(inputs.factor ?? 2) }),
});

// BiRefNet --------------------------------------------------------------------------------------

export const birefnet = defineNode({
  type: 'ai/birefnet',
  label: 'BiRefNet',
  category: 'ai',
  description: 'Cut the subject out of a picture. Gives the cutout and the mask that made it.',
  inputs: {
    image: socket('image'),
    model: choice(
      ['General Use (Light)', 'General Use (Heavy)', 'Portrait'],
      'General Use (Light)',
      'Heavy is slower and more careful. Portrait is for people.'
    ),
    resolution: choice(
      ['1024x1024', '2048x2048'],
      '1024x1024',
      'The working size. Larger is slower and keeps finer edges.'
    ),
    refine: socket('bool', {
      default: true,
      description: 'Clean the edges of the cutout with the mask.',
    }),
    format: choice(['png', 'webp'], 'png', 'The kind of file to make.'),
  },
  outputs: { image: socket('image'), mask: socket('mask') },
  evaluation: 'manual',
  where: 'server',
  width: NODE_WIDTH,
  preview: 'image',
  run: async (inputs, ctx) => {
    const { output } = await ctx.jobs.run({
      entityId: ctx.entityId,
      task: 'birefnet',
      input: { ...inputs },
      signal: ctx.signal,
      progress: ctx.progress,
    });
    return {
      image: isMediaRef(output.image) ? output.image : undefined,
      mask: isMediaRef(output.mask) ? output.mask : undefined,
    };
  },
  estimate: (inputs) => ({ credits: 1, seconds: inputs.model === 'General Use (Heavy)' ? 8 : 4 }),
});

// Wan 2.1 image to video ------------------------------------------------------------------------

export const wanImageToVideo = defineNode({
  type: 'video/wan-i2v',
  label: 'Wan Image to Video',
  category: 'video',
  description:
    'Move a still picture into a short clip: 81 to 100 frames at 5 to 24 a second, so between three and twenty seconds.',
  inputs: {
    image: socket('image', { description: 'The first frame.' }),
    prompt: prompt(2, 'Slow push in', 'How it should move.'),
    negative: prompt(
      2,
      "The model's own list",
      "What to steer away from. Empty uses the model's own list.",
      'Avoid'
    ),
    frames: socket('int', {
      min: 81,
      max: 100,
      step: 1,
      default: 81,
      description: 'Over 81 costs a quarter more.',
    }),
    fps: socket('int', {
      min: 5,
      max: 24,
      step: 1,
      default: 16,
      label: 'FPS',
      description: 'Frames a second.',
    }),
    resolution: choice(['480p', '720p'], '720p', '480p costs half.'),
    aspect: choice(['auto', '16:9', '9:16', '1:1'], 'auto', 'Auto follows the picture.'),
    guidance: socket('float', {
      min: 1,
      max: 10,
      step: 0.1,
      default: 5,
      description: 'How closely to follow the prompt.',
    }),
    shift: socket('float', {
      min: 1,
      max: 10,
      step: 0.1,
      default: 5,
      description: "The model's timestep shift. The default suits most clips.",
    }),
    steps: socket('int', {
      min: 2,
      max: 40,
      step: 1,
      default: 30,
      description: 'More is slower and finer.',
    }),
    expand: socket('bool', {
      default: false,
      label: 'Expand prompt',
      description: 'Let the model rewrite the prompt at length first.',
    }),
    acceleration: choice(
      ['regular', 'none'],
      'regular',
      'Regular is faster at little cost. None is the slow, exact path.'
    ),
    seed: socket('seed', {
      default: 0,
      description: 'The same seed and settings give the same clip.',
    }),
  },
  outputs: { video: socket('video') },
  evaluation: 'manual',
  where: 'server',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    video: await generate('wan-i2v', { ...inputs }, ctx, 'video'),
  }),
  estimate: (inputs) => ({
    credits:
      (inputs.resolution === '480p' ? 6 : 12) * (Number(inputs.frames ?? 81) > 81 ? 1.25 : 1),
    seconds: Number(inputs.frames ?? 81) * (inputs.resolution === '480p' ? 1.5 : 3),
  }),
});
