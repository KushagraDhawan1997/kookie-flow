'use client';

import { useEffect, useRef } from 'react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type EdgeType,
  type Entity,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow';

const PATHS: EdgeType[] = ['bezier', 'straight', 'step', 'smoothstep'];

// One row per path type. Each target sits lower and to the right of its source, so the four shapes look different.
const initialEntities: Entity[] = PATHS.flatMap((path, row): Entity[] => [
  {
    id: `${path}-source`,
    type: 'default',
    position: { x: 0, y: row * 140 },
    width: 160,
    data: { label: 'Source' },
    outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  },
  {
    id: `${path}-target`,
    type: 'default',
    position: { x: 480, y: row * 140 + 60 },
    width: 160,
    data: { label: 'Target' },
    inputs: [{ id: 'in', name: 'In', type: 'float' }],
  },
]);

const initialEdges: Edge[] = PATHS.map((path) => ({
  id: path,
  source: `${path}-source`,
  sourceSocket: 'out',
  target: `${path}-target`,
  targetSocket: 'in',
  type: path,
  label: path,
  // A filled arrow on the straight edge, and moving light on the smoothstep edge.
  markerEnd: path === 'straight' ? 'arrowClosed' : undefined,
  animated: path === 'smoothstep',
}));

export default function EdgesExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges,
  });

  // Frame the graph once, whatever width the box turns out to be.
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
