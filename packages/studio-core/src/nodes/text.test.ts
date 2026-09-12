import { describe, expect, it } from 'vitest';
import { length, replace, template } from './text';
import type { RunContext } from '../ports';

/** These nodes are pure: they never touch a port, so the context is never read. */
const ctx = {} as RunContext;

/**
 * A node may answer with a promise, so its declared type is a union. These three answer straight
 * away, and the tests read the values directly rather than awaiting a promise that never comes.
 */
function sync<T>(result: T | Promise<T>): T {
  if (result instanceof Promise) throw new Error('this node was expected to answer synchronously');
  return result;
}

const fill = (values: { template: string; a?: string; b?: string; c?: string; d?: string }): string =>
  sync(
    template.run(
      { template: values.template, a: values.a ?? '', b: values.b ?? '', c: values.c ?? '', d: values.d ?? '' },
      ctx
    )
  ).out ?? '';

describe('template', () => {
  it('keeps the template\'s own spacing around a filled slot', () => {
    expect(fill({ template: 'file_{a}.png', a: '001' })).toBe('file_001.png');
    expect(fill({ template: '#{a}', a: 'red' })).toBe('#red');
    expect(fill({ template: 'Line 1\n{a}', a: 'two' })).toBe('Line 1\ntwo');
    expect(fill({ template: '{a}, {b}', a: 'x', b: 'y' })).toBe('x, y');
    expect(fill({ template: '{a} in the style of {b}', a: 'a cat', b: 'Ukiyo-e' })).toBe('a cat in the style of Ukiyo-e');
  });

  it('takes the separator with the slot when the slot is empty', () => {
    expect(fill({ template: '{a}, {b}', a: 'x' })).toBe('x');
    expect(fill({ template: '{a}, {b}', b: 'y' })).toBe('y');
    expect(fill({ template: '{a}, {b}, {c}', a: 'x', c: 'z' })).toBe('x, z');
    expect(fill({ template: '{a}, {b}' })).toBe('');
  });

  it('leaves the text between slots alone', () => {
    // A comma inside a value is the value's, not a separator to tidy.
    expect(fill({ template: '{a}', a: 'red , blue' })).toBe('red , blue');
  });

  it('is linear on a long run of whitespace, and keeps it', () => {
    // Without the lookbehind this pattern is retried from every position in the run.
    const spaces = ' '.repeat(50_000);
    const started = performance.now();
    const out = fill({ template: `${spaces}{a}`, a: 'x' });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out.length).toBe(spaces.length + 1);
    expect(out.endsWith('  x')).toBe(true);
  });
});

describe('replace', () => {
  it('matches literally, with no pattern syntax', () => {
    expect(sync(replace.run({ text: 'a.b.c', find: '.', replacement: '-' }, ctx)).out).toBe('a-b-c');
    expect(sync(replace.run({ text: 'cost: 5', find: '5', replacement: '$&9' }, ctx)).out).toBe('cost: $&9');
    expect(sync(replace.run({ text: 'keep', find: '', replacement: 'x' }, ctx)).out).toBe('keep');
  });
});

describe('length', () => {
  it('counts what a reader sees, not code units', () => {
    expect(sync(length.run({ text: 'abc' }, ctx))).toEqual({ characters: 3, words: 1 });
    expect(sync(length.run({ text: '👩‍👩‍👧' }, ctx)).characters).toBe(1);
    expect(sync(length.run({ text: 'two words' }, ctx)).words).toBe(2);
    expect(sync(length.run({ text: '   ' }, ctx)).words).toBe(0);
  });
});
