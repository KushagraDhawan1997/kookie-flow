import { defineNode, socket } from '../define';

/**
 * A slot, with the whitespace and any separator that leads up to it.
 *
 * The lookbehind is what keeps this linear: without it, a long run of spaces that never reaches a
 * slot is retried from every position in the run, which is quadratic on a pasted document.
 */
const SLOT = /(?<![\s,;])(\s*(?:[,;]\s*)?)\{([abcd])\}/g;

/** Counting characters means graphemes, not code units. One segmenter, not one per run. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const template = defineNode({
  type: 'text/template',
  label: 'Template',
  category: 'text',
  description:
    'Fill a template: "{a} in the style of {b}". Slots a–d are the inputs. An empty slot disappears, and so does the space or comma that led up to it.',
  inputs: {
    template: socket('text', { widget: 'textarea', rows: 3, layout: 'stacked', default: '{a}, {b}' }),
    a: socket('text', { default: '' }),
    b: socket('text', { default: '' }),
    c: socket('text', { default: '' }),
    d: socket('text', { default: '' }),
  },
  outputs: { out: socket('text') },
  where: 'inline',
  width: 300,
  run: ({ template, a, b, c, d }) => {
    const slots: Record<string, string> = { a, b, c, d };
    // What leads up to a slot belongs to that slot: kept when it is filled, so "file_{a}.png"
    // and a line break survive, and dropped with it when it is empty, so "{a}, {b}" with no b
    // is "x" rather than "x,".
    const out = template
      .replace(SLOT, (_m, lead: string, key: string) => {
        const value = slots[key] ?? '';
        return value ? lead + value : '';
      })
      // An empty FIRST slot can leave its separator leading the result: "{a}, {b}" with no `a`
      // would start ", ". Only a separator is removed — leading whitespace is the template's own
      // indentation, and stripping that turned every indented template into a flush one.
      .replace(/^[ \t]*[,;]+[ \t]*/, '');
    return { out };
  },
});

export const concat = defineNode({
  type: 'text/concat',
  label: 'Join',
  category: 'text',
  description: 'Join up to four texts with a separator. Empty inputs are skipped.',
  inputs: {
    separator: socket('text', { default: ', ' }),
    a: socket('text', { default: '' }),
    b: socket('text', { default: '' }),
    c: socket('text', { default: '' }),
    d: socket('text', { default: '' }),
  },
  outputs: { out: socket('text') },
  where: 'inline',
  run: ({ separator, a, b, c, d }) => ({ out: [a, b, c, d].filter((s) => s.length > 0).join(separator) }),
});

export const replace = defineNode({
  type: 'text/replace',
  label: 'Replace',
  category: 'text',
  description: 'Replace every occurrence of a piece of text. Matching is literal, not a pattern.',
  inputs: {
    text: socket('text', { default: '' }),
    find: socket('text', { default: '' }),
    replacement: socket('text', { label: 'With', default: '' }),
  },
  outputs: { out: socket('text') },
  where: 'inline',
  run: ({ text, find, replacement }) => {
    if (!find) return { out: text };
    // Split and join rather than `replaceAll`: the string form of `replaceAll` still expands `$&`
    // and friends in the replacement, so "$&" would insert the match instead of a dollar sign.
    //
    // NO REGULAR EXPRESSIONS HERE, and that is a deliberate subtraction. This runs on the main
    // thread during evaluation, and a pattern like "(a+)+b" against 34 characters takes minutes,
    // so a graph carrying one would freeze the tab on every open. The option comes back when
    // deterministic text can run in a worker with a time limit (see plans/studio/plan.md).
    return { out: text.split(find).join(replacement) };
  },
});

export const length = defineNode({
  type: 'text/length',
  label: 'Length',
  category: 'text',
  description: 'How many characters and words a text has. A character means what a reader sees, so an emoji counts once.',
  inputs: { text: socket('text', { default: '' }) },
  outputs: { characters: socket('int'), words: socket('int') },
  where: 'inline',
  run: ({ text }) => {
    let characters = 0;
    for (const _ of GRAPHEMES.segment(text)) characters++;
    return { characters, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
  },
});

export const numberToText = defineNode({
  type: 'text/from-number',
  label: 'Number to text',
  category: 'text',
  description: 'Write a number as text, with a fixed number of decimals.',
  inputs: {
    value: socket('float', { widget: 'number', default: 0 }),
    decimals: socket('int', { default: 0, min: 0, max: 6 }),
  },
  outputs: { out: socket('text') },
  where: 'inline',
  run: ({ value, decimals }) => {
    // A wire can carry any number into this input, and `toFixed` throws outside 0..100.
    const places = Math.min(6, Math.max(0, decimals));
    return { out: value.toFixed(places) };
  },
});
