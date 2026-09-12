'use client';

import { useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

// A float output, an image output, and one node that takes one of each.
const initialEntities: Entity[] = [
  {
    id: 'number',
    type: 'default',
    position: { x: 0, y: 0 },
    data: { label: 'Number' },
    outputs: [{ id: 'value', name: 'Value', type: 'float' }],
  },
  {
    id: 'photo',
    type: 'default',
    position: { x: 0, y: 160 },
    data: { label: 'Photo' },
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
  {
    id: 'blur',
    type: 'default',
    position: { x: 400, y: 60 },
    data: { label: 'Blur' },
    inputs: [
      { id: 'image', name: 'Image', type: 'image' },
      { id: 'radius', name: 'Radius', type: 'float' },
    ],
  },
];

export default function ConnectionRulesExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
  });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 60, maxZoom: 1 });
  }, []);

  return (
    <div style={{ width: '100%', height: 360 }}>
      {/* Strict: a wire only connects sockets whose types are compatible. */}
      <KookieFlow
        ref={flowRef}
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionMode="strict"
      />
    </div>
  );
}
