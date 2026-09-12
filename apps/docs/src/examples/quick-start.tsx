'use client';

import { useEffect, useRef } from 'react';
import {
  KookieFlow,
  useGraph,
  type Entity,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow';

// Two nodes: one with a float output, one with a float input.
const initialEntities: Entity[] = [
  {
    id: 'constant',
    type: 'constant',
    position: { x: 0, y: 0 },
    data: { label: 'Constant' },
    outputs: [{ id: 'value', name: 'Value', type: 'float' }],
  },
  {
    id: 'viewer',
    type: 'viewer',
    position: { x: 320, y: 0 },
    data: { label: 'Viewer' },
    inputs: [{ id: 'value', name: 'Value', type: 'float' }],
  },
];

export default function QuickStartExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
  });

  // Frame both nodes once, whatever width the box turns out to be.
  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 80 });
  }, []);

  return (
    <div style={{ width: '100%', height: 360 }}>
      <KookieFlow
        ref={flowRef}
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
      />
    </div>
  );
}
