import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createFlowStore } from '../core/store';
import { buildAdjacencyIndex, computeAnalysis, validate } from '../core/graph';
import { useGraph } from '../hooks/use-graph';
import type { Entity, Edge } from '../types';
import { buildGlyphMap, buildKerningMap, measureText, countGlyphs } from '../utils/text-layout';
import { EMBEDDED_FONT_METRICS_REGULAR } from '../core/embedded-font';

const node = (id: string, extra: Partial<Entity> = {}): Entity => ({
  id,
  type: 'number',
  position: { x: 0, y: 0 },
  data: {},
  inputs: [{ id: 'in', name: 'in', type: 'number', defaultValue: 0 }],
  outputs: [{ id: 'out', name: 'out', type: 'number' }],
  ...extra,
});
const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  sourceSocket: 'out',
  targetSocket: 'in',
});
const stores: ReturnType<typeof createFlowStore>[] = [];
const store = (entities: Entity[], edges: Edge[] = []) => {
  const s = createFlowStore({ entities, edges });
  stores.push(s);
  return s;
};
afterEach(() => {
  cleanup();
  for (const s of stores) s.getState().disposeEvaluation();
  stores.length = 0;
});

describe('Production regression contracts', () => {
  it('A01 useGraph applies the public collapse change', () => {
    const h = renderHook(() => useGraph({ initialEntities: [node('f', { type: 'frame' })] }));
    act(() => h.result.current.onEntitiesChange([{ type: 'collapse', id: 'f', collapsed: true }]));
    expect(h.result.current.entities[0].collapsed).toBe(true);
  });
  it('C02 documented: imperative hook additions bypass enabled history', () => {
    const h = renderHook(() => useGraph({ initialEntities: [node('a')], history: true }));
    act(() => h.result.current.addEntity(node('b')));
    act(() => h.result.current.undo());
    expect(h.result.current.entities.map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('A03 repeated identical onConnect does not duplicate an edge id', () => {
    const h = renderHook(() => useGraph());
    const c = { source: 'a', sourceSocket: 'out', target: 'b', targetSocket: 'in' };
    act(() => {
      h.result.current.onConnect(c);
      h.result.current.onConnect(c);
    });
    const ids = h.result.current.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('A04 distinct legal connection tuples have distinct generated ids', () => {
    const h = renderHook(() => useGraph());
    act(() => {
      h.result.current.onConnect({
        source: 'a-b',
        sourceSocket: 'c',
        target: 'd',
        targetSocket: 'e',
      });
      h.result.current.onConnect({
        source: 'a',
        sourceSocket: 'b-c',
        target: 'd',
        targetSocket: 'e',
      });
    });
    expect(new Set(h.result.current.edges.map((e) => e.id)).size).toBe(2);
  });
  it('C05 documented: selected entity flags do not own effective selection', () => {
    const s = store([node('a', { selected: true })]);
    expect(s.getState().selectedEntityIds.has('a')).toBe(false);
  });
  it('C06 documented: select changes do not update effective selection', () => {
    const s = store([node('a')]);
    s.getState().applyEntityChanges([{ type: 'select', id: 'a', selected: true }]);
    expect(s.getState().selectedEntityIds.has('a')).toBe(false);
  });
  it('A07 cycle membership excludes descendants that are not on a cycle', () => {
    const es = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('bc', 'b', 'c')];
    expect(computeAnalysis(['a', 'b', 'c'], buildAdjacencyIndex(es)).cycleEntityIds.sort()).toEqual(
      ['a', 'b']
    );
  });
  it('A08 graph validation rejects an edge from a missing source entity', () => {
    const ns = [node('b')],
      es = [edge('ghost-b', 'ghost', 'b')];
    expect(validate(ns, es, buildAdjacencyIndex(es))).not.toEqual([]);
  });
  it('C09 documented: partial output records retain omitted old outputs', async () => {
    const s = store([node('a')]);
    let outputs: Record<string, unknown> = { out: 42 };
    s.getState().setEvaluationHandlers(() => outputs);
    await s.getState().evaluate('a');
    outputs = {};
    await s.getState().evaluate('a');
    expect(s.getState().getSocketValue('a', 'out')).toBe(42);
  });
  it('C10 documented: non-values data requires explicit invalidation', async () => {
    const s = store([node('a', { data: { factor: 2 } })]);
    s.getState().setEvaluationHandlers((_id, _type, _inputs, ctx) => ({
      out: ctx.entity.data.factor,
    }));
    await s.getState().evaluateAll();
    s.getState().applyEntityChanges([{ type: 'data', id: 'a', data: { factor: 3 } }]);
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('a', 'out')).toBe(2);
  });
  it('A11 each moved entity survives until render consumes the movement batch', () => {
    const s = store([node('a'), node('b')]);
    s.getState().updateEntityPositions([{ id: 'a', position: { x: 20, y: 30 } }]);
    s.getState().updateEntityPositions([{ id: 'b', position: { x: 50, y: 60 } }]);
    expect([...s.getState().getMovedEntityIds()].sort()).toEqual(['a', 'b']);
  });
  it('A12 automatic layout keeps frame children at the same relative position', () => {
    const s = store([
      node('f', { type: 'frame', position: { x: 500, y: 500 }, width: 400, height: 400 }),
      node('a', { parentId: 'f', position: { x: 550, y: 550 } }),
    ]);
    s.getState().autoLayout();
    const f = s.getState().entityMap.get('f')!,
      a = s.getState().entityMap.get('a')!;
    expect({ x: a.position.x - f.position.x, y: a.position.y - f.position.y }).toEqual({
      x: 50,
      y: 50,
    });
  });
  it('A13 changing a computational entity to a content type aborts its old run', async () => {
    const s = store([node('a')]);
    let release!: (v: Record<string, unknown>) => void;
    let signal!: AbortSignal;
    s.getState().setEvaluationHandlers((_id, _type, _inputs, ctx) => {
      signal = ctx.signal;
      return new Promise((r) => (release = r));
    });
    const running = s.getState().evaluate('a');
    s.getState().setEntities([node('a', { type: 'text' })]);
    release({ out: 99 });
    await running;
    expect([signal.aborted, s.getState().getSocketValue('a', 'out')]).toEqual([true, undefined]);
  });
  it('A14 deleting a selected entity drops the selection id', () => {
    const s = store([node('a')]);
    s.getState().selectEntity('a');
    s.getState().setEntities([]);
    expect([...s.getState().selectedEntityIds]).toEqual([]);
  });
  it('A15 batched undo then redo returns to the same document', () => {
    const h = renderHook(() => useGraph({ initialEntities: [node('a')], history: true }));
    act(() => h.result.current.onEntitiesChange([{ type: 'add', entity: node('b') }]));
    act(() => {
      h.result.current.undo();
      h.result.current.redo();
    });
    expect(h.result.current.entities.map((e) => e.id)).toEqual(['a', 'b']);
    act(() => h.result.current.undo());
    expect(h.result.current.entities.map((e) => e.id)).toEqual(['a']);
  });
  it('A16 a supplied Unicode codepoint glyph is used for a supplementary character', () => {
    const glyph = {
      id: 0x1f600,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      xoffset: 0,
      yoffset: 0,
      xadvance: 22,
      page: 0,
      chnl: 15,
    };
    const glyphs = new Map([[glyph.id, glyph]]);
    expect({
      width: measureText('😀', glyphs, new Map()),
      count: countGlyphs(
        [{ text: '😀', position: [0, 0, 0], fontSize: 20, color: '#fff' }],
        glyphs
      ),
    }).toEqual({ width: 22, count: 1 });
  });
  it('C17 documented default atlas limitation: unavailable characters draw nothing', () => {
    const m = EMBEDDED_FONT_METRICS_REGULAR;
    expect(measureText('你好', buildGlyphMap(m), buildKerningMap(m))).toBe(0);
  });
});

it('independent movement consumers cannot clear each other’s pending work', () => {
  const s = store([node('a'), node('b')]);
  const first = new Set<string>(),
    second = new Set<string>();
  const off1 = s.getState().trackEntityMovements(first),
    off2 = s.getState().trackEntityMovements(second);
  s.getState().updateEntityPositions([{ id: 'a', position: { x: 1, y: 1 } }]);
  first.clear();
  s.getState().clearMovedEntityIds();
  s.getState().updateEntityPositions([{ id: 'b', position: { x: 2, y: 2 } }]);
  expect([...first]).toEqual(['b']);
  expect([...second]).toEqual(['a', 'b']);
  off1();
  off2();
  s.getState().updateEntityPositions([{ id: 'a', position: { x: 3, y: 3 } }]);
  expect(first.size + second.size).toBe(0);
});
it('batched functional updates and undo use the latest logical document', () => {
  const h = renderHook(() => useGraph({ initialEntities: [node('a')], history: true }));
  act(() => {
    h.result.current.onEntitiesChange([{ type: 'add', entity: node('b') }]);
    h.result.current.onEdgesChange([{ type: 'add', edge: edge('ab', 'a', 'b') }]);
    h.result.current.undo();
  });
  expect(h.result.current.entities.map((e) => e.id)).toEqual(['a']);
  expect(h.result.current.edges).toEqual([]);
  act(() => h.result.current.redo());
  expect(h.result.current.entities.map((e) => e.id)).toEqual(['a', 'b']);
  expect(h.result.current.edges).toHaveLength(1);
});

it('removed owners release active widget references and pending movement IDs', () => {
  const s = store([node('a')]);
  s.getState().setEditingWidgetKey('a:in');
  s.getState().setPressedWidgetKey('a:in');
  s.getState().updateEntityPositions([{ id: 'a', position: { x: 20, y: 20 } }]);
  s.getState().setEntities([]);
  expect(s.getState().editingWidgetKey).toBeNull();
  expect(s.getState().pressedWidgetKey).toBeNull();
  expect(s.getState().getMovedEntityIds().size).toBe(0);
});
it('auto-layout translates nested and collapsed descendants exactly once', () => {
  const s = store([
    node('root', { type: 'frame', collapsed: true, position: { x: 700, y: 800 } }),
    node('inner', { type: 'frame', parentId: 'root', position: { x: 750, y: 850 } }),
    node('leaf', { parentId: 'inner', position: { x: 780, y: 880 } }),
  ]);
  const updates = s.getState().autoLayout();
  expect(new Set(updates.map((update) => update.id)).size).toBe(3);
  const root = s.getState().entityMap.get('root')!,
    leaf = s.getState().entityMap.get('leaf')!;
  expect({ x: leaf.position.x - root.position.x, y: leaf.position.y - root.position.y }).toEqual({
    x: 80,
    y: 80,
  });
});
