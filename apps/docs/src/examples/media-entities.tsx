'use client';

import { useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

/**
 * A picture, a clip and a model, each an entity of its own. Move the pointer over one to see its
 * controls: every one has the expand button, the clip has a play bar, and the model turns.
 */
const initialEntities: Entity[] = [
  {
    id: 'picture', type: 'image', position: { x: 0, y: 0 }, width: 280, height: 186,
    data: { src: '/image-1.jpg', objectFit: 'cover' },
  },
  {
    id: 'clip', type: 'video', position: { x: 320, y: 0 }, width: 320, height: 180,
    data: { src: '/video.mp4', autoplay: true, objectFit: 'cover' },
  },
  {
    id: 'model', type: 'mesh', position: { x: 680, y: 0 }, width: 240, height: 240,
    data: { src: '/model.glb' },
  },
];

export default function MediaEntitiesExample() {
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
