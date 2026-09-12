'use client';

import { useEffect, useRef } from 'react';
import { Button, Flex, Stack } from '@kookie-ui/react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

const initialEntities: Entity[] = [
  // First in the array, so the frame paints behind the entities it holds.
  { id: 'stage', type: 'frame', position: { x: 0, y: 0 }, width: 600, height: 220, data: { label: 'Stage' } },
  {
    id: 'load', type: 'default', parentId: 'stage', position: { x: 32, y: 64 },
    data: { label: 'Load' }, outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
  {
    id: 'blur', type: 'default', parentId: 'stage', position: { x: 328, y: 64 },
    data: { label: 'Blur' }, inputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
];

export default function FramesExample() {
  const { entities, edges, setEntities, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges: [{ id: 'e1', source: 'load', sourceSocket: 'image', target: 'blur', targetSocket: 'image' }],
  });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 40, maxZoom: 1 });
  }, []);

  const toggle = () => {
    // Ask the canvas, then write the answer into your own state so the next render keeps it.
    const collapsed = !flowRef.current?.isGroupCollapsed('stage');
    setEntities((all) => all.map((e) => (e.id === 'stage' ? { ...e, collapsed } : e)));
  };

  return (
    <Stack gap="3">
      <Flex gap="2">
        <Button size="2" onClick={toggle}>Collapse or expand</Button>
      </Flex>
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
    </Stack>
  );
}
