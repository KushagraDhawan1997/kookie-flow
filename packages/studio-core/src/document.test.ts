import { describe, expect, it } from 'vitest';
import type { Viewport, XYPosition } from '@kushagradhawan/kookie-flow';
import { documentFingerprint, emptyDocument, parseDocument, type GraphDocument } from './document';

function graph(changes: { position?: XYPosition; value?: number; viewport?: Viewport } = {}): GraphDocument {
  return {
    version: 1,
    entities: [
      {
        id: 'n1',
        type: 'source/number',
        position: changes.position ?? { x: 10, y: 20 },
        data: { label: 'Four', values: { value: changes.value ?? 4 } },
      },
      { id: 'n2', type: 'math/add', position: { x: 300, y: 20 }, data: {} },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceSocket: 'value', targetSocket: 'a' }],
    viewport: changes.viewport ?? { x: -137, y: 64, zoom: 0.8 },
  };
}

function parsed(raw: string): GraphDocument {
  const doc = parseDocument(JSON.parse(raw));
  if (!doc) throw new Error('not a graph document');
  return doc;
}

describe('documentFingerprint', () => {
  it('is the same for the same graph whatever order its keys come back in', () => {
    // Postgres returns jsonb keys shortest first, so a stored graph never reads back in the order
    // the browser wrote it.
    const fromDatabase = parsed(
      '{"edges":[{"id":"e1","source":"n1","target":"n2","sourceSocket":"value","targetSocket":"a"}],' +
        '"version":1,"entities":[' +
        '{"id":"n1","data":{"label":"Four","values":{"value":4}},"type":"source/number","position":{"x":10,"y":20}},' +
        '{"id":"n2","data":{},"type":"math/add","position":{"x":300,"y":20}}],' +
        '"viewport":{"x":-137,"y":64,"zoom":0.8}}'
    );
    expect(documentFingerprint(fromDatabase)).toBe(documentFingerprint(graph()));
  });

  it('changes with anything a save carries', () => {
    const prints = [
      graph(),
      graph({ position: { x: 11, y: 20 } }),
      graph({ value: 5 }),
      graph({ viewport: { x: -136, y: 64, zoom: 0.8 } }),
      emptyDocument(),
    ].map(documentFingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('skips a field that is undefined, as the JSON a save sends does', () => {
    const base = graph();
    const withUndefined = { ...base, entities: base.entities.map((e) => ({ ...e, parentId: undefined })) };
    expect(documentFingerprint(withUndefined)).toBe(documentFingerprint(base));
  });
});
