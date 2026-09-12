'use client';

import { useState } from 'react';
import { KookieFlow, useGraph, type Entity } from '@kushagradhawan/kookie-flow';
import type { EntitySize, EntityVariant, HeaderPosition } from '@kushagradhawan/kookie-flow';

const image = { name: 'Image', type: 'image' };

const initialEntities: Entity[] = [
  { id: 'load', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Load image' },
    outputs: [{ id: 'out', ...image }] },
  { id: 'blur', type: 'default', position: { x: 300, y: 0 }, color: 'teal', data: { label: 'Blur' },
    inputs: [{ id: 'in', ...image }, { id: 'radius', name: 'Radius', type: 'float' }],
    outputs: [{ id: 'out', ...image }] },
  { id: 'save', type: 'default', position: { x: 600, y: 0 }, data: { label: 'Save' },
    inputs: [{ id: 'in', ...image }] },
];

function Choice<T extends string>(props: { value: T; options: T[]; onChange: (value: T) => void }) {
  const pick = (value: string) => props.options.find((option) => option === value);
  return (
    <select value={props.value} onChange={(e) => { const next = pick(e.target.value); if (next) props.onChange(next); }}>
      {props.options.map((option) => <option key={option}>{option}</option>)}
    </select>
  );
}

export default function EntityStylingExample() {
  const [size, setSize] = useState<EntitySize>('2');
  const [variant, setVariant] = useState<EntityVariant>('surface');
  const [header, setHeader] = useState<HeaderPosition>('inside');
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges: [
      { id: 'e1', source: 'load', sourceSocket: 'out', target: 'blur', targetSocket: 'in' },
      { id: 'e2', source: 'blur', sourceSocket: 'out', target: 'save', targetSocket: 'in' },
    ],
  });

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 12, paddingBottom: 12 }}>
        <Choice value={size} options={['1', '2', '3', '4', '5']} onChange={setSize} />
        <Choice value={variant} options={['surface', 'outline', 'soft', 'classic', 'ghost']} onChange={setVariant} />
        <Choice value={header} options={['inside', 'outside', 'none']} onChange={setHeader} />
      </div>
      <div style={{ height: 360 }}>
        <KookieFlow
          entities={entities}
          edges={edges}
          onEntitiesChange={onEntitiesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          size={size}
          variant={variant}
          header={header}
          defaultViewport={{ x: 32, y: 72, zoom: 0.75 }}
        />
      </div>
    </div>
  );
}
