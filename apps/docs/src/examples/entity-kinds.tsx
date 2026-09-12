'use client';

import { useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

const initialEntities: Entity[] = [
  {
    id: 'load',
    type: 'image/load',
    position: { x: 0, y: 40 },
    data: { label: 'Load image' },
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
  // The frame comes before the node inside it, so the node draws on top.
  { id: 'stage', type: 'frame', position: { x: 300, y: 0 }, width: 300, height: 200, data: { label: 'Clean up' } },
  {
    id: 'blur',
    type: 'image/blur',
    parentId: 'stage',
    position: { x: 330, y: 50 },
    data: { label: 'Blur' },
    inputs: [{ id: 'image', name: 'Image', type: 'image' }],
    outputs: [{ id: 'result', name: 'Result', type: 'image' }],
  },
  {
    id: 'title',
    type: 'text',
    position: { x: 660, y: 0 },
    width: 240,
    height: 40,
    data: { content: 'Four kinds, one array', fontSize: 20 },
  },
  {
    id: 'note',
    type: 'comment',
    position: { x: 660, y: 70 },
    width: 220,
    height: 110,
    data: { content: 'A comment is a sticky note. It has no sockets.' },
  },
];

export default function EntityKindsExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 40, maxZoom: 1 });
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
