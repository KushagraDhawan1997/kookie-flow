'use client';

/**
 * The three header positions, side by side on the same graph.
 *
 *   inside  — the title gets a band of its own at the top of the body (the default)
 *   outside — the title is drawn above the body, on the canvas
 *   none    — no title at all, and no band reserved for one
 *
 * `header` is a whole-canvas setting, not per node, so this is three canvases rather than three
 * nodes. Each holds its own graph state; the accent toggle is the other half of the header story
 * — `accentHeader` lights the top edge in the accent hue at ANY position, including `none`.
 */

import { useEffect, useRef, useState } from 'react';
import { Theme } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type Entity,
  type HeaderPosition,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow';

const initialEntities: Entity[] = [
  {
    id: 'number',
    type: 'number',
    position: { x: 0, y: 0 },
    width: 220,
    data: { label: 'Number', values: { value: 2 } },
    inputs: [{ id: 'value', name: 'Value', type: 'float', min: 0, max: 10, step: 0.1 }],
    outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  },
  {
    id: 'multiply',
    type: 'math/multiply',
    position: { x: 300, y: 60 },
    width: 220,
    data: { label: 'Multiply', values: { by: 2 } },
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'by', name: 'By', type: 'float', min: 0, max: 10, step: 0.1 },
    ],
    outputs: [{ id: 'product', name: 'Product', type: 'float' }],
  },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'number', sourceSocket: 'out', target: 'multiply', targetSocket: 'a' },
];

const POSITIONS: { position: HeaderPosition; note: string }[] = [
  { position: 'inside', note: 'Title in a band at the top of the body' },
  { position: 'outside', note: 'Title above the body' },
  { position: 'none', note: 'No title' },
];

/** One canvas, one header position. Its own graph, so dragging in one board leaves the others put. */
function Board({ position, note, accentHeader }: { position: HeaderPosition; note: string; accentHeader: boolean }) {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges,
  });
  const flowRef = useRef<KookieFlowInstance>(null);

  // Fit once per board so all three open at the same scale whatever the column width is.
  useEffect(() => {
    flowRef.current?.fitView({ padding: 80, maxZoom: 1 });
  }, []);

  return (
    <section style={columnStyle}>
      <header style={captionStyle}>
        <code style={{ fontWeight: 600 }}>header=&quot;{position}&quot;</code>
        <span style={{ opacity: 0.6 }}>{note}</span>
      </header>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <KookieFlow
          ref={flowRef}
          entities={entities}
          edges={edges}
          onEntitiesChange={onEntitiesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onWidgetChange={(entityId, socketId, value) => {
            const entity = entities.find((e) => e.id === entityId);
            const prev = (entity?.data as { values?: Record<string, unknown> } | undefined)?.values ?? {};
            onEntitiesChange([
              {
                type: 'data',
                id: entityId,
                data: { ...(entity?.data ?? {}), values: { ...prev, [socketId]: value } },
              },
            ]);
          }}
          showWidgets
          showSocketLabels
          showGrid
          header={position}
          accentHeader={accentHeader}
          size="2"
        />
      </div>
    </section>
  );
}

export default function DemoHeaderPage() {
  const [accentHeader, setAccentHeader] = useState(false);

  return (
    <Theme>
      <main style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={barStyle}>
          <b>Header positions</b>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={accentHeader}
              onChange={(e) => setAccentHeader(e.target.checked)}
            />
            accentHeader
          </label>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {POSITIONS.map((p) => (
            <Board key={p.position} position={p.position} note={p.note} accentHeader={accentHeader} />
          ))}
        </div>
      </main>
    </Theme>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  gap: 24,
  alignItems: 'center',
  padding: '10px 16px',
  fontSize: 13,
  borderBottom: '1px solid var(--gray-6)',
};

const columnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid var(--gray-6)',
};

const captionStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'baseline',
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
};
