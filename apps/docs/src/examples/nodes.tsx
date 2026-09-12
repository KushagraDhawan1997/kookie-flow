'use client';

import { useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

const initialEntities: Entity[] = [
  {
    id: 'value',
    type: 'math/value',
    position: { x: 0, y: 120 },
    width: 160,
    data: { label: 'Value' },
    outputs: [{ id: 'out', name: 'Value', type: 'float' }],
  },
  {
    id: 'render',
    type: 'image/render',
    position: { x: 240, y: 0 },
    width: 300,
    data: { label: 'Render', values: { steps: 30, mode: 'Cubic' } },
    inputs: [
      {
        id: 'prompt',
        name: 'Prompt',
        type: 'string',
        layout: 'stacked',
        widget: 'textarea',
        rows: 3,
        placeholder: 'Describe the image',
      },
      // Wire Value into Strength and its slider goes away.
      { id: 'strength', name: 'Strength', type: 'float', defaultValue: 0.5 },
      { id: 'steps', name: 'Steps', type: 'int' },
      { id: 'mode', name: 'Mode', type: 'enum', options: ['Linear', 'Cubic'] },
      { id: 'tiled', name: 'Tiled', type: 'boolean' },
      { id: 'tint', name: 'Tint', type: 'color', defaultValue: '#3e63dd' },
    ],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
];

export default function NodesExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 40, maxZoom: 1 });
  }, []);

  return (
    <div style={{ width: '100%', height: 400 }}>
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
