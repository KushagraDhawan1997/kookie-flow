import { describe, expect, it } from 'vitest';
import { FlowDocumentError, parseFlowObject, validateFlowObject } from './document';
import { validateGraphStructure } from './graph-validation';
import { buildAdjacencyIndex, validate } from './graph';
import type { FlowObject } from '../types';
const fixture = (): FlowObject => ({
  entities: [
    {
      id: 'a',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { payload: [1, 2] },
      outputs: [{ id: 'out', name: 'Out', type: 'number' }],
    },
    {
      id: 'b',
      type: 'custom',
      position: { x: 200, y: 0 },
      data: {},
      inputs: [{ id: 'in', name: 'In', type: 'number' }],
    },
  ],
  edges: [{ id: 'ab', source: 'a', sourceSocket: 'out', target: 'b', targetSocket: 'in' }],
  viewport: { x: 0, y: 0, zoom: 1 },
});
describe('persisted document boundary', () => {
  it('accepts a JSON round trip and preserves custom data', () => {
    const document = fixture();
    document.entities[0].data.content = { applicationOwned: true };
    expect(parseFlowObject(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
  it.each([null, [], 42, {}, { entities: [], edges: [], viewport: { x: 0, y: 0, zoom: 0 } }])(
    'rejects malformed roots: %j',
    (input) => {
      expect(validateFlowObject(input).length).toBeGreaterThan(0);
      expect(() => parseFlowObject(input)).toThrow(FlowDocumentError);
    }
  );
  it.each([
    (d: FlowObject) => {
      d.entities[0].position.x = NaN;
    },
    (d: FlowObject) => {
      d.entities[0].width = -1;
    },
    (d: FlowObject) => {
      d.entities[0].id = '';
    },
    (d: FlowObject) => {
      d.entities.push(d.entities[0]);
    },
    (d: FlowObject) => {
      d.edges.push(d.edges[0]);
    },
    (d: FlowObject) => {
      d.edges[0].source = 'gone';
    },
    (d: FlowObject) => {
      d.edges[0].targetSocket = 'gone';
    },
    (d: FlowObject) => {
      d.edges[0].reroutes = ['b'];
    },
    (d: FlowObject) => {
      d.entities[0].parentId = 'gone';
    },
    (d: FlowObject) => {
      d.entities[0].parentId = 'b';
      d.entities[1].parentId = 'a';
    },
    (d: FlowObject) => {
      d.entities[0].outputs!.push(d.entities[0].outputs![0]);
    },
    (d: FlowObject) => {
      d.entities[0].type = 'text';
      d.entities[0].data.content = {};
    },
  ])('rejects invalid fields and references (%#)', (damage) => {
    const document = fixture();
    damage(document);
    expect(validateFlowObject(document).length).toBeGreaterThan(0);
  });
  it('rejects oversized collections before reading their entries', () => {
    expect(
      validateFlowObject({ entities: [null], edges: [], viewport: null }, { maxEntities: 0 })
    ).toEqual([{ path: '$.entities', message: 'Exceeds the 0 item limit' }]);
    expect(() => validateFlowObject(fixture(), { maxEntities: NaN })).toThrow(RangeError);
  });
  it('permits incomplete graphs; invalid wires do not satisfy required inputs', () => {
    const document = fixture();
    document.edges[0].source = 'missing';
    const issues = validate(document.entities, document.edges, buildAdjacencyIndex(document.edges));
    expect(issues).toContainEqual({
      type: 'unconnected-required',
      entityId: 'b',
      portId: 'in',
      portName: 'In',
    });
    document.edges = [];
    expect(validateFlowObject(document)).toEqual([]);
  });
  it('walks deep parent graphs without recursion', () => {
    const entities = Array.from({ length: 20_000 }, (_, i) => ({
      id: String(i),
      type: 'frame',
      data: {},
      position: { x: 0, y: 0 },
      parentId: i ? String(i - 1) : undefined,
    }));
    expect(validateGraphStructure(entities, [])).toEqual([]);
    entities[0].parentId = '19999';
    const issues = validateGraphStructure(entities, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('parent-cycle');
  });
});
