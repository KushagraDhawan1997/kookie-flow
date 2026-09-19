/**
 * Logic that decides what flows on: the pieces the agent's loop needs between cheap drafts and a
 * dear final (plans/studio/vision.md).
 *
 * NEITHER NEEDS A NEW STATUS. A node that throws is `error`, and the engine already holds everything
 * downstream of an error until it clears, so a pick with nothing chosen keeps the final from running
 * without the library learning a `waiting` state. The message says what to do, not what broke.
 */

import { defineNode, socket } from '../define';

/** How many pictures a pick chooses between. Four drafts is the loop's usual spread. */
const OPTIONS = ['a', 'b', 'c', 'd'] as const;

/** In menu order. A list, not an object's keys: keys that look like numbers sort ahead of "none". */
const CHOICE_VALUES = ['none', '1', '2', '3', '4'];
const CHOICES: Record<string, string> = { none: 'None yet', '1': 'Option 1', '2': 'Option 2', '3': 'Option 3', '4': 'Option 4' };

export const pick = defineNode({
  type: 'logic/pick',
  label: 'Pick',
  category: 'logic',
  summary: 'Passes on the one picture you choose, and holds everything after it until you do.',
  description:
    'Choose one of up to four pictures. Wire drafts into Option 1 to 4 and the final step to Picked. Until Choice names an option, nothing downstream runs, so a costly final waits for the person. Set Choice with set_values when the person says which one they want.',
  inputs: {
    a: socket('image', { label: 'Option 1' }),
    b: socket('image', { label: 'Option 2' }),
    c: socket('image', { label: 'Option 3' }),
    d: socket('image', { label: 'Option 4' }),
    choice: socket('text', {
      widget: 'select',
      options: CHOICE_VALUES,
      optionLabels: CHOICES,
      default: 'none',
      description: 'Which option to pass on. None yet holds everything downstream.',
    }),
  },
  outputs: { picked: socket('image', { label: 'Picked' }) },
  where: 'inline',
  run: (inputs) => {
    const index = Number(inputs.choice);
    if (!Number.isInteger(index) || index < 1 || index > OPTIONS.length) {
      throw new Error('Choose one of the options to continue.');
    }
    const key = OPTIONS[index - 1];
    const picked = key ? inputs[key] : undefined;
    if (!picked) throw new Error(`Option ${index} has no picture yet.`);
    return { picked };
  },
});

export const gate = defineNode({
  type: 'logic/gate',
  label: 'Gate',
  category: 'logic',
  summary: 'Passes its input on only while it is open.',
  description:
    'Holds a value until Open is on, and everything downstream waits while it is closed. Use it to stop a branch from running until the person is ready.',
  inputs: {
    value: socket('any'),
    open: socket('bool', { default: false, description: 'On passes the value; off holds it.' }),
  },
  outputs: { value: socket('any') },
  where: 'inline',
  run: ({ value, open }) => {
    if (!open) throw new Error('Closed. Open the gate to continue.');
    return { value };
  },
});
