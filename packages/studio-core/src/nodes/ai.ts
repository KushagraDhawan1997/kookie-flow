/**
 * The generation nodes.
 *
 * Every one of these runs `where: 'server'` and `evaluation: 'manual'`, and the two go together:
 * a node that costs money must never run because a slider moved. The engine marks it stale and
 * waits for Run.
 *
 * None of them knows what a provider is. They ask `ctx.jobs` for a model by name and get outputs
 * back; whether that was fal, a local mock, or a queue that survived the tab is the port's
 * business. Today it is the mock, which paints a deterministic placeholder — so the whole path
 * (manual gate, job row, stored bytes, preview band, cache) is real and only the pixels are not.
 */

import { defineNode, socket } from '../define';
import type { RunContext } from '../ports';
import { isMediaRef, type MediaRef } from '../values';

/** Ask the jobs port for one model and pull a named media output off the answer. */
async function generate(
  model: string,
  input: Record<string, unknown>,
  ctx: RunContext,
  key: string
): Promise<MediaRef | undefined> {
  const { output } = await ctx.jobs.run({
    entityId: ctx.entityId,
    model,
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
function prompt(rows: number, placeholder: string, description: string) {
  // `stacked`, as the Text source node does it: a prompt is the thing you came to the node to
  // write, and inline puts it in the half-width column beside its own label.
  return socket('text', { widget: 'textarea', rows, layout: 'stacked', placeholder, description });
}

/**
 * Sizes are ints with a range rather than a list of presets: the range is enforced in `coerce`,
 * so a wire carrying 6000 from some upstream node is clamped before it reaches a provider that
 * would have charged for the mistake.
 */
const width = socket('int', { min: 256, max: 2048, step: 64, default: 1024, description: 'Pixels across.' });
const height = socket('int', { min: 256, max: 2048, step: 64, default: 1024, description: 'Pixels down.' });

/** Wider than a math node: these carry a prompt and a picture, not two numbers. */
const NODE_WIDTH = 300;

export const textToImage = defineNode({
  type: 'ai/text-to-image',
  label: 'Generate image',
  category: 'ai',
  description:
    'Make a picture from a written prompt. Costs credits and runs only when you press Run.',
  inputs: {
    prompt: prompt(3, 'A lighthouse in fog', 'What to draw.'),
    width,
    height,
    seed: socket('seed', { default: 0, description: 'Same seed and same prompt give the same picture.' }),
  },
  outputs: { image: socket('image') },
  evaluation: 'manual',
  where: 'server',
  color: 'purple',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    image: await generate('mock/text-to-image', { ...inputs }, ctx, 'image'),
  }),
  estimate: () => ({ credits: 4, seconds: 8 }),
});

export const editImage = defineNode({
  type: 'ai/edit-image',
  label: 'Edit image',
  category: 'ai',
  description: 'Change an existing picture by describing the change. Keeps the composition.',
  inputs: {
    image: socket('image', { description: 'The picture to change.' }),
    prompt: prompt(3, 'Make it night', 'The change to make.'),
    strength: socket('float', {
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      description: 'How far from the original to travel. 0 keeps it, 1 ignores it.',
    }),
    seed: socket('seed', { default: 0 }),
  },
  outputs: { image: socket('image') },
  evaluation: 'manual',
  where: 'server',
  color: 'purple',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    image: await generate('mock/edit-image', { ...inputs }, ctx, 'image'),
  }),
  estimate: () => ({ credits: 4, seconds: 8 }),
});

export const upscale = defineNode({
  type: 'ai/upscale',
  label: 'Upscale',
  category: 'ai',
  description: 'Enlarge a picture and invent the detail that enlarging it would otherwise lose.',
  inputs: {
    image: socket('image'),
    factor: socket('int', { min: 2, max: 4, step: 1, default: 2, description: 'How many times larger.' }),
  },
  outputs: { image: socket('image') },
  evaluation: 'manual',
  where: 'server',
  color: 'purple',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    image: await generate('mock/upscale', { ...inputs }, ctx, 'image'),
  }),
  estimate: () => ({ credits: 2, seconds: 6 }),
});

export const removeBackground = defineNode({
  type: 'ai/remove-background',
  label: 'Remove background',
  category: 'ai',
  description: 'Cut the subject out. Gives the cutout and the mask that made it.',
  inputs: { image: socket('image') },
  outputs: { image: socket('image'), mask: socket('mask') },
  evaluation: 'manual',
  where: 'server',
  color: 'purple',
  width: NODE_WIDTH,
  preview: 'image',
  run: async (inputs, ctx) => {
    const { output } = await ctx.jobs.run({
      entityId: ctx.entityId,
      model: 'mock/remove-background',
      input: { ...inputs },
      signal: ctx.signal,
      progress: ctx.progress,
    });
    return {
      image: isMediaRef(output.image) ? output.image : undefined,
      mask: isMediaRef(output.mask) ? output.mask : undefined,
    };
  },
  estimate: () => ({ credits: 1, seconds: 4 }),
});

export const imageToVideo = defineNode({
  type: 'ai/image-to-video',
  label: 'Animate image',
  category: 'video',
  description: 'Move a still picture into a short clip.',
  inputs: {
    image: socket('image', { description: 'The first frame.' }),
    prompt: prompt(2, 'Slow push in', 'How it should move.'),
    seconds: socket('float', { min: 1, max: 10, step: 0.5, default: 4 }),
    fps: socket('int', { min: 8, max: 30, step: 1, default: 24 }),
    seed: socket('seed', { default: 0 }),
  },
  outputs: { video: socket('video') },
  evaluation: 'manual',
  where: 'server',
  color: 'violet',
  width: NODE_WIDTH,
  run: async (inputs, ctx) => ({
    video: await generate('mock/image-to-video', { ...inputs }, ctx, 'video'),
  }),
  estimate: (inputs) => ({ credits: 12, seconds: Number(inputs.seconds ?? 4) * 6 }),
});
