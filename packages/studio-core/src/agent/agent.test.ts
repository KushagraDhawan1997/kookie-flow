import { describe, expect, it } from 'vitest';
import { compileOps } from '../ops';
import { registry } from '../nodes';
import { gate, pick } from '../nodes/logic';
import type { RunContext } from '../ports';
import type { MediaRef } from '../values';
import {
  AGENT_EFFORTS,
  agentMaxOutputTokens,
  agentProviderOptions,
  AGENT_MODELS,
  findAgentModel,
  holdEstimateMicros,
  resolveAgentModel,
  tokenMicros,
} from './models';
import { catalogIndex, searchCatalog } from './catalog';
import { layoutCluster } from './layout';
import { agentInstructions } from './instructions';
import { AGENT_TOOLS, isBrowserTool } from './tools';
import { applyOpsToDocument } from './apply';
import { emptyDocument } from '../document';

const ctx = {} as RunContext;
const picture = (hash: string): MediaRef => ({ kind: 'image', hash, width: 1024, height: 1024 });

describe('pick', () => {
  it('holds everything downstream until a choice is made', () => {
    expect(() => pick.run({ a: picture('a'), b: picture('b'), c: picture('c'), d: picture('d'), choice: 'none' }, ctx)).toThrow(
      /Choose one/
    );
  });

  it('passes on the chosen picture', () => {
    const out = pick.run({ a: picture('a'), b: picture('b'), c: picture('c'), d: picture('d'), choice: '2' }, ctx);
    expect(out).toEqual({ picked: picture('b') });
  });

  it('says so when the chosen option is empty', () => {
    expect(() => pick.run({ a: picture('a'), choice: '3' } as never, ctx)).toThrow(/Option 3 has no picture/);
  });
});

describe('gate', () => {
  it('holds while closed and passes while open', () => {
    expect(() => gate.run({ value: 1, open: false }, ctx)).toThrow(/Closed/);
    expect(gate.run({ value: 1, open: true }, ctx)).toEqual({ value: 1 });
  });
});

describe('agent models', () => {
  it('resolves Auto by effort and keeps a stated model', () => {
    expect(resolveAgentModel('auto', 'medium').id).toBe('anthropic/claude-sonnet-5');
    expect(resolveAgentModel('auto', 'max').id).toBe('anthropic/claude-opus-5');
    expect(resolveAgentModel('openai/gpt-5.6-luna', 'high').id).toBe('openai/gpt-5.6-luna');
    expect(resolveAgentModel('someone/else', 'low').id).toBe('anthropic/claude-sonnet-5');
  });

  it('prices tokens at the list price', () => {
    const sonnet = findAgentModel('anthropic/claude-sonnet-5');
    if (!sonnet) throw new Error('missing model');
    // 1M input at $2, 100k output at $10 a million, 500k cache reads at $0.20 a million.
    expect(tokenMicros(sonnet, { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 0 })).toBe(
      2_000_000 + 1_000_000 + 100_000
    );
  });

  it('holds more than one full call would cost', () => {
    for (const model of AGENT_MODELS) {
      const one = tokenMicros(model, { input: 10_000, output: 8_000, cacheRead: 0, cacheWrite: 0 });
      expect(holdEstimateMicros(model, 30_000)).toBeGreaterThanOrEqual(one);
    }
  });

  it('says effort the way each provider hears it', () => {
    const claude = resolveAgentModel('anthropic/claude-opus-5', 'high');
    const gpt = resolveAgentModel('openai/gpt-6-astra', 'high');
    expect(agentProviderOptions(claude, 'high')).toMatchObject({ anthropic: { effort: 'high', thinking: { type: 'adaptive' } } });
    expect(agentProviderOptions(gpt, 'low')).toMatchObject({ openai: { reasoningEffort: 'low' } });
  });

  it('gives Haiku 4.5 a thinking budget under the cap, never adaptive thinking or effort', () => {
    const haiku = resolveAgentModel('anthropic/claude-haiku-4.5', 'max');
    for (const effort of AGENT_EFFORTS.map((e) => e.id)) {
      const options = agentProviderOptions(haiku, effort);
      expect(options.anthropic).not.toHaveProperty('effort');
      const thinking = options.anthropic?.thinking;
      expect(thinking).toMatchObject({ type: 'enabled' });
      const budget = thinking && typeof thinking === 'object' && !Array.isArray(thinking) ? thinking.budgetTokens : 0;
      expect(budget).toBeLessThan(agentMaxOutputTokens(effort));
    }
  });
});

describe('agent tools', () => {
  it('splits browser tools from server tools', () => {
    expect(isBrowserTool('apply_ops')).toBe(true);
    expect(isBrowserTool('run')).toBe(true);
    expect(isBrowserTool('search_nodes')).toBe(false);
    expect(new Set(AGENT_TOOLS.map((t) => t.name)).size).toBe(AGENT_TOOLS.length);
  });
});

describe('catalog', () => {
  it('indexes every node and marks what costs money', () => {
    const index = catalogIndex(registry);
    expect(index).toContain('logic/pick (Pick)');
    expect(index).toMatch(/ai\/gpt-image-2\.5 \(GPT Image 2\.5\).*Costs money/);
    // Socket names, so the model does not guess them.
    expect(index).toMatch(/source\/text \(Text\).* In: text\. Out: out\./);
    expect(index).toMatch(/logic\/pick \(Pick\).* Out: picked\./);
  });

  it('applies a batch all or nothing', () => {
    const doc = emptyDocument();
    const applied = applyOpsToDocument(
      doc,
      [
        { op: 'add_node', type: 'source/text', id: 'prompt', values: { value: 'a controller' } },
        { op: 'add_node', type: 'ai/gpt-image-2.5', id: 'draft' },
      ],
      registry
    );
    expect(applied.created).toEqual([]);
    expect(applied.doc).toBe(doc);
    expect(applied.errors[0]?.message).toBe('"source/text" has no input "value"; its inputs are "text"');
  });

  it('describes a searched type with its options and defaults', () => {
    const found = searchCatalog(registry, 'pick');
    expect(found).toContain('in choice: text');
    expect(found).toContain('"none"');
    expect(searchCatalog(registry, 'zzzz qqqq')).toMatch(/No node matches/);
  });

  it('keeps the instructions free of anything that changes per turn', () => {
    expect(agentInstructions(registry)).toBe(agentInstructions(registry));
  });
});

describe('layoutCluster', () => {
  const ops = [
    { op: 'add_node' as const, type: 'source/text', label: 'Brief' },
    { op: 'add_node' as const, type: 'ai/gpt-image-2.5', label: 'Draft 1' },
    { op: 'add_node' as const, type: 'ai/gpt-image-2.5', label: 'Draft 2' },
    { op: 'add_node' as const, type: 'logic/pick', label: 'Pick' },
    { op: 'connect' as const, from: 'n1.out', to: 'n2.prompt' },
    { op: 'connect' as const, from: 'n1.out', to: 'n3.prompt' },
    { op: 'connect' as const, from: 'n2.image', to: 'n4.a' },
    { op: 'connect' as const, from: 'n3.image', to: 'n4.b' },
  ];

  it('lays new nodes out left to right by wiring depth, and the ops still compile', () => {
    const placed = layoutCluster({ entities: [] }, ops, registry);
    const pos = (id: string) => {
      const op = placed.find((o) => o.op === 'add_node' && o.id === id);
      if (!op || op.op !== 'add_node' || !op.position) throw new Error(`no position for ${id}`);
      return op.position;
    };
    expect(pos('n1').x).toBeLessThan(pos('n2').x);
    expect(pos('n2').x).toBe(pos('n3').x);
    expect(pos('n3').y).toBeGreaterThan(pos('n2').y);
    expect(pos('n4').x).toBeGreaterThan(pos('n2').x);
    const compiled = compileOps({ entities: [], edges: [] }, placed, registry);
    expect(compiled.errors).toEqual([]);
    expect(compiled.created).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('starts the cluster below what is already on the canvas, with ids that follow it', () => {
    const existing = [{ id: 'n7', type: 'source/text', position: { x: 100, y: 50 }, data: {} }];
    const placed = layoutCluster({ entities: existing }, [{ op: 'add_node', type: 'source/number' }], registry);
    const op = placed[0];
    if (!op || op.op !== 'add_node' || !op.position) throw new Error('not placed');
    expect(op.id).toBe('n8');
    expect(op.position.x).toBe(100);
    expect(op.position.y).toBeGreaterThan(50);
  });

  it('leaves stated positions alone', () => {
    const at = { x: 5, y: 6 };
    const placed = layoutCluster({ entities: [] }, [{ op: 'add_node', type: 'source/number', position: at }], registry);
    expect(placed[0]).toEqual({ op: 'add_node', type: 'source/number', position: at });
  });
});
