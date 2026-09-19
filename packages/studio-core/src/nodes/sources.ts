import { defineNode, socket } from '../define';

export const number = defineNode({
  type: 'source/number',
  label: 'Number',
  category: 'source',
  summary: 'A number you type.',
  description: 'A number you type. Feeds any numeric input.',
  inputs: { value: socket('float', { widget: 'number', default: 0 }) },
  outputs: { out: socket('float') },
  where: 'inline',
  run: ({ value }) => ({ out: value }),
});

export const slider = defineNode({
  type: 'source/slider',
  label: 'Slider',
  category: 'source',
  summary: 'A number you drag between 0 and 1.',
  description: 'A number between 0 and 1 you drag. Multiply it to reach another range.',
  inputs: { value: socket('float', { widget: 'slider', min: 0, max: 1, step: 0.001, default: 0.5 }) },
  outputs: { out: socket('float') },
  where: 'inline',
  run: ({ value }) => ({ out: value }),
});

export const text = defineNode({
  type: 'source/text',
  label: 'Text',
  category: 'source',
  summary: 'Text you type, like a prompt.',
  description: 'Text you type: a prompt, a name, a line of a script.',
  inputs: { text: socket('text', { widget: 'textarea', rows: 3, layout: 'stacked', default: '' }) },
  outputs: { out: socket('text') },
  where: 'inline',
  width: 280,
  run: ({ text }) => ({ out: text }),
});

export const seed = defineNode({
  type: 'source/seed',
  label: 'Seed',
  category: 'source',
  summary: 'A number that decides a random result. Change it to get a new one.',
  description: 'A seed for anything random. The same seed gives the same result; change it to reroll.',
  inputs: { seed: socket('seed', { default: 1 }) },
  outputs: { out: socket('seed') },
  where: 'inline',
  run: ({ seed }) => ({ out: seed }),
});

export const toggle = defineNode({
  type: 'source/toggle',
  label: 'Toggle',
  category: 'source',
  summary: 'A switch you turn on or off.',
  description: 'On or off. Drives a switch or a gate.',
  inputs: { on: socket('bool', { default: false }) },
  outputs: { out: socket('bool') },
  where: 'inline',
  run: ({ on }) => ({ out: on }),
});

export const color = defineNode({
  type: 'source/color',
  label: 'Color',
  category: 'source',
  summary: 'A color you pick.',
  description: 'A colour you pick, as #rrggbb.',
  inputs: { color: socket('color', { default: '#3e63dd' }) },
  outputs: { out: socket('color') },
  where: 'inline',
  run: ({ color }) => ({ out: color }),
});

/**
 * A picture brought into the graph: attached in the agent's box, dropped in by a person later. The
 * picture is a stored asset's reference held in the node's values, never its bytes, so a graph that
 * carries one stays small and saves like any other.
 */
export const image = defineNode({
  type: 'source/image',
  label: 'Picture',
  category: 'source',
  summary: 'A picture you added.',
  description:
    'A picture the person added. Its output feeds any picture input. The agent cannot make one: it appears when the person attaches a picture.',
  inputs: { image: socket('image', { widget: false, description: 'The stored picture.' }) },
  outputs: { image: socket('image') },
  where: 'inline',
  width: 260,
  run: ({ image }) => {
    if (!image) throw new Error('Add a picture to continue.');
    return { image };
  },
});
