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
import { Code, Switch, Text } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type Entity,
  type HeaderPosition,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow';

import { DemoFrame } from '../demo-frame';

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
      {/* Along the bottom of its own column, clear of the floating band across the top. */}
      <div style={captionStyle}>
        <Code>header=&quot;{position}&quot;</Code>
        <Text size="2" emphasis="medium">
          {note}
        </Text>
      </div>
    </section>
  );
}

export default function DemoHeaderPage() {
  const [accentHeader, setAccentHeader] = useState(false);

  return (
    <DemoFrame
      title="Header positions"
      actions={
        <label style={switchLabelStyle}>
          <Switch checked={accentHeader} onCheckedChange={(checked) => setAccentHeader(checked)} />
          <Text size="2">Accent header</Text>
        </label>
      }
    >
      <div style={{ display: 'flex', height: '100%' }}>
        {POSITIONS.map((p) => (
          <Board key={p.position} position={p.position} note={p.note} accentHeader={accentHeader} />
        ))}
      </div>
    </DemoFrame>
  );
}

const columnStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  borderInlineEnd: '1px solid var(--neutral-6)',
};

const captionStyle: React.CSSProperties = {
  position: 'absolute',
  insetInlineStart: 16,
  insetBlockEnd: 16,
  display: 'flex',
  gap: 10,
  alignItems: 'baseline',
  pointerEvents: 'none',
};

const switchLabelStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' };
