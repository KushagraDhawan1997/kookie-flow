import { describe, it, expect, vi } from 'vitest';
import { Evaluator, SUCCESS_HOLD_MS, type EvaluationHost, type EvaluationMode } from './evaluation';
import { buildAdjacencyIndex } from './graph';
import type { Edge, Entity, Socket } from '../types';

/**
 * The evaluation lifecycle is a set of ORDERING claims — what ran before what, with which inputs,
 * and what was thrown away — and ordering claims are what a unit test pins and a browser cannot.
 * Every test here builds a tiny graph, drives it with a scripted `onEvaluate`, and reads the
 * engine's decisions off the call log. Nothing renders.
 *
 * The host is a literal, not the store. That is the point of the engine being a module: the
 * store is one host, and a test is another.
 */

type Values = Record<string, unknown>;

function sock(id: string, defaultValue?: unknown): Socket {
  return { id, name: id, type: 'number', defaultValue };
}

function ent(id: string, inputs: Socket[] = [], outputs: Socket[] = [], type = 'default'): Entity {
  return { id, type, position: { x: 0, y: 0 }, data: {}, inputs, outputs };
}

function edge(source: string, sourceSocket: string, target: string, targetSocket: string): Edge {
  return { id: `${source}.${sourceSocket}->${target}.${targetSocket}`, source, sourceSocket, target, targetSocket };
}

interface World {
  entities: Map<string, Entity>;
  edges: Edge[];
  muted: Set<string>;
  modes: Map<string, EvaluationMode>;
  widget: Map<string, unknown>;
  changes: number;
}

function world(entities: Entity[], edges: Edge[] = []): World {
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    edges,
    muted: new Set(),
    modes: new Map(),
    widget: new Map(),
    changes: 0,
  };
}

function hostFor(w: World): EvaluationHost {
  let index = buildAdjacencyIndex(w.edges);
  let builtFor = w.edges;
  return {
    getEntity: (id) => w.entities.get(id),
    entityIds: () => w.entities.keys(),
    index: () => {
      if (builtFor !== w.edges) {
        index = buildAdjacencyIndex(w.edges);
        builtFor = w.edges;
      }
      return index;
    },
    isMuted: (id) => w.muted.has(id),
    evaluationMode: (e) => w.modes.get(e.type) ?? 'reactive',
    readInputValue: (e, s) => w.widget.get(`${e.id}:${s.id}`) ?? s.defaultValue,
    onChange: () => { w.changes++; },
  };
}

/** Let queued microtasks and resolved promises drain. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('a change runs what it touched, in order, with resolved inputs', () => {
  it('runs a reactive chain front to back and passes outputs along the wire', async () => {
    // a(x) -> b(y) -> c(z): each doubles. b must see a's output, c must see b's.
    const w = world(
      [
        ent('a', [sock('in', 1)], [sock('out')]),
        ent('b', [sock('in')], [sock('out')]),
        ent('c', [sock('in')], [sock('out')]),
      ],
      [edge('a', 'out', 'b', 'in'), edge('b', 'out', 'c', 'in')]
    );
    const calls: Array<[string, Values]> = [];
    const ev = new Evaluator(hostFor(w), (id, _t, inputs) => {
      calls.push([id, inputs]);
      return { out: (inputs.in as number) * 2 };
    });

    ev.markDirty('a');
    await ev.settled();

    expect(calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    expect(calls[1][1]).toEqual({ in: 2 });
    expect(calls[2][1]).toEqual({ in: 4 });
    expect(ev.getSocketValue('c', 'out')).toBe(8);
    ev.dispose();
  });

  it('an unconnected input reads its widget, a connected one reads upstream', async () => {
    const w = world(
      [ent('a', [], [sock('out')]), ent('b', [sock('wired'), sock('knob', 5)], [sock('out')])],
      [edge('a', 'out', 'b', 'wired')]
    );
    w.widget.set('b:knob', 7);
    let seen: Values = {};
    const ev = new Evaluator(hostFor(w), (id, _t, inputs) => {
      if (id === 'a') return { out: 'from-a' };
      seen = inputs;
      return {};
    });

    ev.markDirty('a');
    await ev.settled();
    expect(seen).toEqual({ wired: 'from-a', knob: 7 });
    ev.dispose();
  });

  it('falls back to the socket default when no widget value is set', () => {
    const w = world([ent('a', [sock('x', 42)])]);
    const ev = new Evaluator(hostFor(w));
    expect(ev.resolveInputs(w.entities.get('a') as Entity)).toEqual({ x: 42 });
    ev.dispose();
  });

  it('runs siblings at once rather than serialising them', async () => {
    // a -> b, a -> c. Both b and c become ready when a lands; both must be in flight together.
    const w = world(
      [ent('a', [], [sock('out')]), ent('b', [sock('in')]), ent('c', [sock('in')])],
      [edge('a', 'out', 'b', 'in'), edge('a', 'out', 'c', 'in')]
    );
    let inFlight = 0;
    let peak = 0;
    const ev = new Evaluator(hostFor(w), async (id) => {
      if (id === 'a') return { out: 1 };
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return {};
    });
    ev.markDirty('a');
    await ev.settled();
    expect(peak).toBe(2);
    ev.dispose();
  });
});

describe('dirty marking', () => {
  it('marks the whole downstream stale at once, not one hop at a time', () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('b', [sock('i')], [sock('o')]), ent('c', [sock('i')])],
      [edge('a', 'o', 'b', 'i'), edge('b', 'o', 'c', 'i')]
    );
    const ev = new Evaluator(hostFor(w));
    ev.markDirty('a');
    expect(ev.status('a')).toBe('dirty');
    expect(ev.status('b')).toBe('dirty');
    expect(ev.status('c')).toBe('dirty');
    ev.dispose();
  });

  it('does not touch upstream', () => {
    const w = world([ent('a', [], [sock('o')]), ent('b', [sock('i')])], [edge('a', 'o', 'b', 'i')]);
    const ev = new Evaluator(hostFor(w));
    ev.markDirty('b');
    expect(ev.status('a')).toBe('idle');
    expect(ev.status('b')).toBe('dirty');
    ev.dispose();
  });

  it('is cheap on repeat: a mark landing on a dirty entity walks nothing', () => {
    // This is what makes it safe behind a slider drag, which marks the same entity per
    // pointermove. Measured by the number of status-change notifications — a second walk would
    // re-notify the subtree.
    const w = world(
      [ent('a', [], [sock('o')]), ent('b', [sock('i')], [sock('o')]), ent('c', [sock('i')])],
      [edge('a', 'o', 'b', 'i'), edge('b', 'o', 'c', 'i')]
    );
    const onStatus = vi.fn();
    const ev = new Evaluator(hostFor(w), undefined, onStatus);
    ev.markDirty('a');
    const after = onStatus.mock.calls.length;
    for (let i = 0; i < 50; i++) ev.markDirty('a');
    expect(onStatus.mock.calls.length).toBe(after);
    ev.dispose();
  });

  it('with no onEvaluate, an entity stays honestly dirty and nothing spins', async () => {
    const w = world([ent('a', [sock('i', 1)])]);
    const ev = new Evaluator(hostFor(w));
    ev.markDirty('a');
    await ev.settled();
    expect(ev.status('a')).toBe('dirty');
    ev.dispose();
  });
});

describe('manual gates', () => {
  it('a manual entity is marked dirty by upstream change but does not run', async () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('gen', [sock('i')], [sock('o')], 'ai/generate'), ent('post', [sock('i')])],
      [edge('a', 'o', 'gen', 'i'), edge('gen', 'o', 'post', 'i')]
    );
    w.modes.set('ai/generate', 'manual');
    const ran: string[] = [];
    const ev = new Evaluator(hostFor(w), (id) => { ran.push(id); return { o: id }; });

    ev.markDirty('a');
    await ev.settled();

    expect(ran).toEqual(['a']);
    expect(ev.status('gen')).toBe('dirty');
    // Downstream of a closed gate stays stale too: its input has not arrived.
    expect(ev.status('post')).toBe('dirty');
    ev.dispose();
  });

  it('evaluate(id) opens the gate and the cascade continues past it', async () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('gen', [sock('i')], [sock('o')], 'ai/generate'), ent('post', [sock('i')])],
      [edge('a', 'o', 'gen', 'i'), edge('gen', 'o', 'post', 'i')]
    );
    w.modes.set('ai/generate', 'manual');
    const ran: string[] = [];
    const ev = new Evaluator(hostFor(w), (id) => { ran.push(id); return { o: id }; });

    ev.markDirty('a');
    await ev.settled();
    await ev.evaluate('gen');
    await ev.settled();

    expect(ran).toEqual(['a', 'gen', 'post']);
    expect(ev.status('post')).toBe('success');
    ev.dispose();
  });

  it('evaluateDirty opens every closed gate', async () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('g1', [sock('i')], [], 'gate'), ent('g2', [sock('i')], [], 'gate')],
      [edge('a', 'o', 'g1', 'i'), edge('a', 'o', 'g2', 'i')]
    );
    w.modes.set('gate', 'manual');
    const ran: string[] = [];
    const ev = new Evaluator(hostFor(w), (id) => { ran.push(id); return { o: 1 }; });
    ev.markDirty('a');
    await ev.settled();
    expect(ran).toEqual(['a']);
    await ev.evaluateDirty();
    expect(ran.sort()).toEqual(['a', 'g1', 'g2']);
    ev.dispose();
  });
});

describe('cancellation', () => {
  it('a change mid-run aborts the run, discards its result, and re-runs with the new inputs', async () => {
    const w = world([ent('a', [sock('i', 1)], [sock('o')])]);
    let resolveFirst: ((v: Values) => void) | null = null;
    const seen: Values[] = [];
    const signals: AbortSignal[] = [];
    const ev = new Evaluator(hostFor(w), (_id, _t, inputs, ctx) => {
      seen.push(inputs);
      signals.push(ctx.signal);
      if (seen.length === 1) return new Promise<Values>((r) => { resolveFirst = r; });
      return { o: 'second' };
    });

    ev.markDirty('a');
    await tick();
    expect(ev.status('a')).toBe('running');

    // Inputs change under the run.
    w.widget.set('a:i', 2);
    ev.markDirty('a');
    expect(signals[0].aborted).toBe(true);
    expect(ev.status('a')).toBe('dirty');

    await ev.settled();
    // The first run resolves late; its result must not land.
    (resolveFirst as unknown as (v: Values) => void)({ o: 'stale' });
    await tick();

    expect(seen).toEqual([{ i: 1 }, { i: 2 }]);
    expect(ev.getSocketValue('a', 'o')).toBe('second');
    ev.dispose();
  });

  it('a late rejection from a superseded run does not mark the entity as failed', async () => {
    const w = world([ent('a', [sock('i', 1)], [sock('o')])]);
    let rejectFirst: ((e: Error) => void) | null = null;
    let n = 0;
    const ev = new Evaluator(hostFor(w), () => {
      n++;
      if (n === 1) return new Promise<Values>((_r, rej) => { rejectFirst = rej; });
      return { o: 'ok' };
    });
    ev.markDirty('a');
    await tick();
    w.widget.set('a:i', 2);
    ev.markDirty('a');
    await ev.settled();
    (rejectFirst as unknown as (e: Error) => void)(new Error('aborted'));
    await tick();
    expect(ev.status('a')).toBe('success');
    ev.dispose();
  });
});

describe('errors', () => {
  it('a throw sets error with the message and holds the chain', async () => {
    const w = world(
      [ent('a', [sock('i', 1)], [sock('o')]), ent('b', [sock('i')])],
      [edge('a', 'o', 'b', 'i')]
    );
    const onStatus = vi.fn();
    const ran: string[] = [];
    const ev = new Evaluator(
      hostFor(w),
      (id) => { ran.push(id); if (id === 'a') throw new Error('boom'); return {}; },
      onStatus
    );
    ev.markDirty('a');
    await ev.settled();
    expect(ev.status('a')).toBe('error');
    expect(ev.record('a')?.message).toBe('boom');
    // b never ran on a's stale output: it waits, visibly, for a to be fixed.
    expect(ran).toEqual(['a']);
    expect(ev.status('b')).toBe('dirty');
    expect(onStatus).toHaveBeenCalledWith('a', 'error', 'boom');
    ev.dispose();
  });

  it('fixing the input clears the error and the chain resumes', async () => {
    const w = world(
      [ent('a', [sock('i', 1)], [sock('o')]), ent('b', [sock('i')])],
      [edge('a', 'o', 'b', 'i')]
    );
    const ev = new Evaluator(hostFor(w), (id, _t, inputs) => {
      if (id === 'a' && inputs.i === 1) throw new Error('bad');
      return { o: 1 };
    });
    ev.markDirty('a');
    await ev.settled();
    expect(ev.status('a')).toBe('error');
    w.widget.set('a:i', 2);
    ev.markDirty('a');
    await ev.settled();
    expect(ev.status('a')).toBe('success');
    expect(ev.status('b')).toBe('success');
    ev.dispose();
  });
});

describe('status lifecycle', () => {
  it('goes dirty → running → success, then back to idle after the hold', async () => {
    vi.useFakeTimers();
    try {
      const w = world([ent('a', [sock('i', 1)])]);
      const seq: string[] = [];
      const ev = new Evaluator(hostFor(w), () => ({}), (_id, s) => seq.push(s));
      ev.markDirty('a');
      await vi.runAllTimersAsync();
      expect(seq).toEqual(['dirty', 'running', 'success', 'idle']);
      ev.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the success hold is at least long enough to be seen', () => {
    expect(SUCCESS_HOLD_MS).toBeGreaterThanOrEqual(1000);
  });

  it('progress is recorded while running and cleared after', async () => {
    const w = world([ent('a', [sock('i', 1)])]);
    let seenProgress: number | undefined;
    const ev = new Evaluator(hostFor(w), async (id, _t, _i, ctx) => {
      ctx.progress(0.5);
      seenProgress = ev.record(id)?.progress;
      return {};
    });
    ev.markDirty('a');
    await ev.settled();
    expect(seenProgress).toBe(0.5);
    expect(ev.record('a')?.progress).toBeUndefined();
    ev.dispose();
  });

  it('notifies the host on every change so a renderer can repaint', async () => {
    const w = world([ent('a', [sock('i', 1)])]);
    const ev = new Evaluator(hostFor(w), () => ({}));
    ev.markDirty('a');
    await ev.settled();
    expect(w.changes).toBeGreaterThanOrEqual(3); // dirty, running, success at minimum
    ev.dispose();
  });
});

describe('muted entities', () => {
  it('pass inputs through to outputs by position, without calling the consumer', async () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('m', [sock('i')], [sock('o')]), ent('b', [sock('i')])],
      [edge('a', 'o', 'm', 'i'), edge('m', 'o', 'b', 'i')]
    );
    w.muted.add('m');
    const ran: string[] = [];
    let bSaw: Values = {};
    const ev = new Evaluator(hostFor(w), (id, _t, inputs) => {
      ran.push(id);
      if (id === 'b') bSaw = inputs;
      return { o: 'from-a' };
    });
    ev.markDirty('a');
    await ev.settled();
    expect(ran).toEqual(['a', 'b']);
    expect(bSaw).toEqual({ i: 'from-a' });
    ev.dispose();
  });
});

describe('injected values and the whole graph', () => {
  it('setSocketValue feeds downstream without re-running the entity it was set on', async () => {
    const w = world([ent('a', [], [sock('o')]), ent('b', [sock('i')])], [edge('a', 'o', 'b', 'i')]);
    const ran: string[] = [];
    let bSaw: Values = {};
    const ev = new Evaluator(hostFor(w), (id, _t, inputs) => { ran.push(id); if (id === 'b') bSaw = inputs; return {}; });
    ev.setSocketValue('a', 'o', 'loaded');
    await ev.settled();
    expect(ran).toEqual(['b']);
    expect(bSaw).toEqual({ i: 'loaded' });
    ev.dispose();
  });

  it('evaluateAll runs everything, roots first', async () => {
    const w = world(
      [ent('a', [], [sock('o')]), ent('b', [sock('i')], [sock('o')]), ent('c', [sock('i')])],
      [edge('a', 'o', 'b', 'i'), edge('b', 'o', 'c', 'i')]
    );
    const ran: string[] = [];
    const ev = new Evaluator(hostFor(w), (id) => { ran.push(id); return { o: 1 }; });
    await ev.evaluateAll();
    expect(ran).toEqual(['a', 'b', 'c']);
    ev.dispose();
  });

  it('a deleted entity that was dirty is forgotten, not run', async () => {
    const w = world([ent('a', [sock('i', 1)])]);
    const ran: string[] = [];
    const ev = new Evaluator(hostFor(w), (id) => { ran.push(id); return {}; });
    ev.markDirty('a');
    w.entities.delete('a');
    await ev.settled();
    expect(ran).toEqual([]);
    expect(ev.record('a')).toBeUndefined();
    ev.dispose();
  });

  it('dispose aborts everything in flight', async () => {
    const w = world([ent('a', [sock('i', 1)])]);
    let signal: AbortSignal | null = null;
    const ev = new Evaluator(hostFor(w), (_i, _t, _in, ctx) => { signal = ctx.signal; return new Promise(() => {}); });
    ev.markDirty('a');
    await tick();
    ev.dispose();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
  });
});
