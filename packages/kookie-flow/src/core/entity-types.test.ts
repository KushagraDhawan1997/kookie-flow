import { describe, it, expect } from 'vitest';
import {
  createEntityTypeCache,
  resolveEntities,
  resolveEntity,
  sameTypeTable,
  sourceEntity,
} from './entity-types';
import type { Entity, EntityTypeDefinition, Socket } from '../types';

/**
 * The table fills gaps. That is the whole feature, and these tests are mostly about what counts
 * as a gap — because the failure everyone has with a system like this is the table quietly
 * overruling something the node said for itself.
 */

const A: Socket = { id: 'a', name: 'A', type: 'float' };
const B: Socket = { id: 'b', name: 'B', type: 'float' };
const SUM: Socket = { id: 'sum', name: 'Sum', type: 'float' };

const add: EntityTypeDefinition = {
  type: 'add',
  label: 'Add',
  defaultWidth: 200,
  defaultHeight: 120,
  inputs: [A, B],
  outputs: [SUM],
};
const types = { add };

function node(extra: Partial<Entity> = {}): Entity {
  return { id: 'n1', type: 'add', position: { x: 0, y: 0 }, data: {}, ...extra };
}

describe('what the table fills in', () => {
  it('a node that states nothing gets the type\'s sockets, size and label', () => {
    const r = resolveEntity(node(), types);
    expect(r.inputs).toEqual([A, B]);
    expect(r.outputs).toEqual([SUM]);
    expect(r.width).toBe(200);
    expect(r.height).toBe(120);
    expect(r.data?.label).toBe('Add');
  });

  it('a node of a type the table does not know is left exactly as it is', () => {
    const n = node({ type: 'unknown' });
    expect(resolveEntity(n, types)).toBe(n);
  });

  it('and so is a node when there is no table at all', () => {
    const n = node();
    expect(resolveEntity(n, undefined)).toBe(n);
  });
});

describe('what the node keeps', () => {
  it('sockets it states itself', () => {
    const own: Socket[] = [{ id: 'x', name: 'X', type: 'float' }];
    const r = resolveEntity(node({ inputs: own }), types);
    expect(r.inputs).toBe(own);
    expect(r.outputs).toEqual([SUM]); // the gap it left is still filled
  });

  it('an EMPTY socket list, which is a statement and not a gap', () => {
    // The node that says "I have no inputs" must not be handed two.
    const r = resolveEntity(node({ inputs: [] }), types);
    expect(r.inputs).toEqual([]);
  });

  it('its own size, including a zero', () => {
    const r = resolveEntity(node({ width: 320, height: 0 }), types);
    expect(r.width).toBe(320);
    expect(r.height).toBe(0);
  });

  it('its own label', () => {
    const r = resolveEntity(node({ data: { label: 'First term' } }), types);
    expect(r.data?.label).toBe('First term');
  });

  it('and the identity of its values, because that is how an input change is heard', () => {
    const values = { a: 1 };
    const r = resolveEntity(node({ data: { values } }), types);
    expect((r.data as { values?: unknown }).values).toBe(values);
    expect(r.data?.label).toBe('Add');
  });
});

describe('what it costs', () => {
  it('a node with nothing to fill comes back as the same object', () => {
    const complete = node({ inputs: [], outputs: [], width: 1, height: 1, data: { label: 'x' } });
    expect(resolveEntity(complete, types)).toBe(complete);
  });

  it('resolving the same node twice returns the same resolved object', () => {
    const cache = createEntityTypeCache();
    const n = node();
    expect(resolveEntity(n, types, cache)).toBe(resolveEntity(n, types, cache));
  });

  it('an array where nothing needed filling is handed back unchanged', () => {
    const list = [node({ type: 'unknown' })];
    expect(resolveEntities(list, types)).toBe(list);
  });

  it('an array where one node needed filling keeps the others\' identities', () => {
    const untouched = node({ id: 'n2', type: 'unknown' });
    const out = resolveEntities([untouched, node()], types);
    expect(out[0]).toBe(untouched);
    expect(out[1].inputs).toEqual([A, B]);
  });
});

describe('finding the way back', () => {
  it('a resolved node remembers what the consumer handed over', () => {
    const cache = createEntityTypeCache();
    const n = node();
    const r = resolveEntity(n, types, cache);
    expect(sourceEntity(r, cache)).toBe(n);
  });

  it('a node nobody resolved is its own source', () => {
    const n = node({ type: 'unknown' });
    expect(sourceEntity(n, createEntityTypeCache())).toBe(n);
  });

  it('so a second table fills the gaps the first one did, not the ones it left', () => {
    // A table arriving late — or being swapped — must reach nodes already on the board.
    const cache = createEntityTypeCache();
    const n = node();
    const first = resolveEntity(n, types, cache);
    const wider = { add: { ...add, defaultWidth: 400 } };
    const second = resolveEntity(sourceEntity(first, cache), wider, createEntityTypeCache());
    expect(second.width).toBe(400);
  });
});

describe('whether two tables say the same thing', () => {
  it('the same object does', () => {
    expect(sameTypeTable(types, types)).toBe(true);
  });

  it('a fresh object holding the same entries does', () => {
    expect(sameTypeTable(types, { add })).toBe(true);
  });

  it('a different entry does not', () => {
    expect(sameTypeTable(types, { add: { ...add } })).toBe(false);
  });

  it('nor does a table with an entry more, or one fewer', () => {
    expect(sameTypeTable(types, { add, mul: { type: 'mul' } })).toBe(false);
    expect(sameTypeTable({ add, mul: { type: 'mul' } }, types)).toBe(false);
  });
});
