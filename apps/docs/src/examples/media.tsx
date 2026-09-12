'use client';

import { useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

const initialEntities: Entity[] = [
  // An image entity: the picture is the whole entity.
  {
    id: 'photo', type: 'image', position: { x: 0, y: 0 }, width: 300, height: 200,
    data: { src: '/image-1.jpg', objectFit: 'cover' },
  },
  // A node with a preview band that shows whatever its `image` output holds.
  {
    id: 'render', type: 'default', position: { x: 360, y: 0 }, width: 240,
    data: { label: 'Render' },
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    preview: { socket: 'image', height: 140 },
  },
];

export default function MediaExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    // No evaluation here, so put a value on the output directly. The band draws it.
    flow.setSocketValue('render', 'image', '/image-3.jpg');
    flow.fitView({ padding: 48, maxZoom: 1 });
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
