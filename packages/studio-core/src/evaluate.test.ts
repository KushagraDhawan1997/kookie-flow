import { describe, expect, it, vi } from 'vitest';
import type { EvaluationContext } from '@kushagradhawan/kookie-flow';
import { createOnEvaluate } from './evaluate';
import { NodeRegistry } from './registry';
import { defineNode, socket, type Where } from './define';
import { NotAvailableError, type Ports } from './ports';
import { evaluateExpression } from './nodes/math';
import { canonicalJson, hashString, LruCache } from './cache';

const ports: Ports = {
  gpu: { run: () => Promise.reject(new NotAvailableError('gpu')), load: () => Promise.reject(new NotAvailableError('gpu')) },
  media: { notYet: () => { throw new NotAvailableError('media'); } },
  jobs: { run: () => Promise.reject(new NotAvailableError('jobs')) },
  assets: { put: () => Promise.reject(new NotAvailableError('assets')) },
};

const ctx = (): EvaluationContext => ({
  entity: { id: 'n1', type: 't', position: { x: 0, y: 0 }, data: {} },
  signal: new AbortController().signal,
  progress: () => {},
});

/** A node that adds `a` and `n`, at whichever tier the test needs. */
function doubler(where: Where, run: (inputs: { a: number; n: number }) => { out: number }) {
  return new NodeRegistry().register(
    defineNode({
      type: 't/double',
      label: 'Double',
      category: 'math',
      description: '',
      inputs: { a: socket('float', { default: 1 }), n: socket('int', { default: 0 }) },
      outputs: { out: socket('float') },
      where,
      run,
    })
  );
}

describe('createOnEvaluate', () => {
  it('coerces inputs to the socket type and caches a paid run by identity', async () => {
    const run = vi.fn(({ a, n }: { a: number; n: number }) => ({ out: a * 2 + n }));
    const onEvaluate = createOnEvaluate({ registry: doubler('server', run), ports });
    expect(await onEvaluate('n1', 't/double', { a: '4', n: 2.4 }, ctx())).toEqual({ out: 10 });
    expect(await onEvaluate('n1', 't/double', { a: 4, n: 2 }, ctx())).toEqual({ out: 10 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await onEvaluate('n1', 't/double', { a: undefined, n: undefined }, ctx())).toEqual({ out: 2 });
  });

  it('does not spend a cache lookup on an inline node', async () => {
    // Hashing the inputs costs more than the arithmetic, and this runs on every frame of a drag.
    const run = vi.fn(({ a }: { a: number }) => ({ out: a * 2 }));
    const onEvaluate = createOnEvaluate({ registry: doubler('inline', run), ports });
    await onEvaluate('n1', 't/double', { a: 2, n: 0 }, ctx());
    await onEvaluate('n1', 't/double', { a: 2, n: 0 }, ctx());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps a number inside the range its socket declares, whatever the wire carried', async () => {
    const seen: number[] = [];
    const registry = new NodeRegistry().register(
      defineNode({
        type: 't/decimals',
        label: 'Decimals',
        category: 'text',
        description: '',
        inputs: { decimals: socket('int', { default: 0, min: 0, max: 6 }) },
        outputs: { out: socket('float') },
        where: 'inline',
        run: ({ decimals }) => {
          seen.push(decimals);
          return { out: decimals };
        },
      })
    );
    const onEvaluate = createOnEvaluate({ registry, ports });
    await onEvaluate('n1', 't/decimals', { decimals: 400 }, ctx());
    await onEvaluate('n1', 't/decimals', { decimals: -3 }, ctx());
    expect(seen).toEqual([6, 0]);
  });

  it('tells -0 from 0 in a cache key', async () => {
    const run = vi.fn(({ a }: { a: number }) => ({ out: Math.atan2(a, -1) }));
    const onEvaluate = createOnEvaluate({ registry: doubler('server', run), ports });
    const first = await onEvaluate('n1', 't/double', { a: 0, n: 0 }, ctx());
    const second = await onEvaluate('n1', 't/double', { a: -0, n: 0 }, ctx());
    expect(run).toHaveBeenCalledTimes(2);
    expect(first).not.toEqual(second);
  });

  it('does not cache a run that was aborted', async () => {
    let calls = 0;
    const registry = doubler('server', ({ a }) => {
      calls++;
      return { out: a };
    });
    const onEvaluate = createOnEvaluate({ registry, ports });
    const controller = new AbortController();
    const c = { ...ctx(), signal: controller.signal };
    controller.abort();
    expect(await onEvaluate('n1', 't/double', { a: 1, n: 0 }, c)).toBeUndefined();
    await onEvaluate('n1', 't/double', { a: 1, n: 0 }, ctx());
    expect(calls).toBe(2);
  });
});

describe('evaluateExpression', () => {
  it('handles precedence, functions, constants and unary minus', () => {
    expect(evaluateExpression('a + b * 2', { a: 1, b: 3 })).toBe(7);
    expect(evaluateExpression('(a + b) * 2', { a: 1, b: 3 })).toBe(8);
    expect(evaluateExpression('2 ^ 3 ^ 2', {})).toBe(512);
    expect(evaluateExpression('-a ^ 2', { a: 3 })).toBe(-9);
    expect(evaluateExpression('mix(0, 10, 0.25) + round(pi)', {})).toBe(5.5);
    expect(evaluateExpression('clamp(a, 0, 1)', { a: 4 })).toBe(1);
    expect(evaluateExpression('a / b', { a: 1, b: 0 })).toBe(0);
    expect(evaluateExpression('a % b', { a: 1, b: 0 })).toBe(0);
  });

  it('rejects names it does not know and trailing junk', () => {
    expect(() => evaluateExpression('foo(1)', {})).toThrow('unknown function foo');
    expect(() => evaluateExpression('a b', { a: 1, b: 2 })).toThrow();
    expect(() => evaluateExpression('window', {})).toThrow('unknown name window');
  });

  it('refuses names inherited from Object.prototype, as functions and as variables', () => {
    // `in` let every one of these through, and they came back as a function or an object where
    // the parser promised a number.
    expect(() => evaluateExpression('constructor(1)', {})).toThrow('unknown function constructor');
    expect(() => evaluateExpression('toString', {})).toThrow('unknown name toString');
    expect(() => evaluateExpression('__proto__', {})).toThrow('unknown name __proto__');
    expect(() => evaluateExpression('hasOwnProperty(1)', { a: 1 })).toThrow('unknown function hasOwnProperty');
  });

  it('refuses a call with the wrong number of arguments instead of answering NaN', () => {
    expect(() => evaluateExpression('sqrt()', {})).toThrow('sqrt takes 1 number, got 0');
    expect(() => evaluateExpression('mix(1, 2)', {})).toThrow('mix takes 3 numbers, got 2');
    expect(() => evaluateExpression('min()', {})).toThrow('at least one');
    expect(evaluateExpression('min(3, 1, 2)', {})).toBe(1);
  });
});

describe('cache', () => {
  it('canonicalises keys and evicts the least recently used', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}');
    expect(hashString('x')).toHaveLength(16);
    expect(hashString('x')).not.toBe(hashString('y'));
    const lru = new LruCache<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
  });
});
