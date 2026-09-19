import { describe, expect, it } from 'vitest';
import { applyOpsToDocument, emptyDocument, registry, type GraphOp } from 'studio-core';
import { nextMockTurn, type MockHistory } from './mock-script';

const call = (history: MockHistory) => {
  const turn = nextMockTurn(history);
  const first = turn.calls?.[0];
  return { turn, name: first?.name, input: first?.input ?? {} };
};

describe('the mock agent', () => {
  it('reads the graph first, then asks when the ask is short', () => {
    expect(call({ userText: 'a controller', userMessages: 1, results: [] }).name).toBe('read_graph');
    const asked = nextMockTurn({ userText: 'a controller', userMessages: 1, results: [{ name: 'read_graph', output: '(empty graph)' }] });
    expect(asked.calls).toBeUndefined();
    expect(asked.text).toMatch(/1\. /);
  });

  it('builds drafts, a pick and a final that compile, then prices and runs the drafts', () => {
    const userText = 'Concept art for a controller for a handheld games console';
    const results: MockHistory['results'] = [{ name: 'read_graph', output: '(empty graph)' }];
    expect(call({ userText, userMessages: 1, results }).name).toBe('search_nodes');

    results.push({ name: 'search_nodes', output: '' });
    const build = call({ userText, userMessages: 1, results });
    expect(build.name).toBe('apply_ops');
    const ops = build.input.ops;
    if (!Array.isArray(ops)) throw new Error('no ops');
    const applied = applyOpsToDocument(emptyDocument(), ops as GraphOp[], registry);
    expect(applied.errors).toEqual([]);
    expect(applied.created).toHaveLength(5);

    results.push({ name: 'apply_ops', output: { created: applied.created, errors: [] } });
    const priced = call({ userText, userMessages: 1, results });
    expect(priced.name).toBe('estimate');
    expect(priced.input.nodes).toEqual(['n2', 'n3']);

    results.push({ name: 'estimate', output: { nodes: [{ id: 'n2' }, { id: 'n3' }], total: '$0.02' } });
    const run = call({ userText, userMessages: 1, results });
    expect(run.name).toBe('run');
    expect(run.turn.text).toContain('$0.02');

    results.push({ name: 'run', output: { nodes: [{ id: 'n2', status: 'done' }, { id: 'n3', status: 'done' }] } });
    expect(call({ userText, userMessages: 1, results }).name).toBe('inspect');
    results.push({ name: 'inspect', output: 'ok' });
    expect(nextMockTurn({ userText, userMessages: 1, results }).text).toMatch(/Which one/);
  });

  it('stops when the person declines the price', () => {
    const results: MockHistory['results'] = [
      { name: 'read_graph', output: '(empty graph)' },
      { name: 'run', output: { declined: true, nodes: [] } },
    ];
    expect(nextMockTurn({ userText: 'make it', userMessages: 2, results }).text).toMatch(/Nothing ran/);
  });

  it('finishes on the pick the person names', () => {
    const graph = 'n1 source/text "Brief"\nn4 logic/pick "Pick"\nn5 ai/gpt-image-2.5 "Final" quality="high"';
    const results: MockHistory['results'] = [{ name: 'read_graph', output: graph }];
    const set = call({ userText: 'the second one', userMessages: 2, results });
    expect(set.name).toBe('apply_ops');
    expect(set.input.ops).toEqual([{ op: 'set_values', id: 'n4', values: { choice: '2' } }]);
    results.push({ name: 'apply_ops', output: { created: [], errors: [] } });
    expect(call({ userText: 'the second one', userMessages: 2, results }).input.nodes).toEqual(['n5']);
  });
});
