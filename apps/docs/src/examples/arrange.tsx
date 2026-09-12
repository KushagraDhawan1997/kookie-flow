'use client';

import { useEffect, useRef } from 'react';
import { Button, Flex, Stack } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type Entity,
  type EntityChange,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow';

const node = (id: string, x: number, y: number): Entity => ({
  id,
  type: 'default',
  position: { x, y },
  data: { label: id },
  inputs: [{ id: 'in', name: 'In', type: 'image' }],
  outputs: [{ id: 'out', name: 'Out', type: 'image' }],
});

const wire = (source: string, target: string): Edge => ({
  id: `${source}-${target}`, source, sourceSocket: 'out', target, targetSocket: 'in',
});

export default function ArrangeExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities: [node('Save', 40, 20), node('Mix', 520, 300), node('Blur', 380, -60), node('Load', -120, 260), node('Mask', 200, 160)],
    initialEdges: [wire('Load', 'Blur'), wire('Load', 'Mask'), wire('Blur', 'Mix'), wire('Mask', 'Mix'), wire('Mix', 'Save')],
  });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 40 });
  }, []);

  const tidy = () => {
    const flow = flowRef.current;
    if (!flow) return;
    // autoLayout moves the nodes but reports nothing, so pass its moves to useGraph yourself.
    const moves = flow.autoLayout({ rankGap: 80, nodeGap: 24 });
    onEntitiesChange(moves.map(({ id, position }): EntityChange => ({ type: 'position', id, position })));
    flow.fitView({ padding: 40 });
  };

  return (
    <Stack gap="3">
      <Flex gap="2">
        <Button size="2" emphasis="loud" onClick={tidy}>Tidy</Button>
        {/* Select two or more nodes to align, three or more to space. Both report their own moves. */}
        <Button size="2" onClick={() => flowRef.current?.alignSelection('left')}>Align left</Button>
        <Button size="2" onClick={() => flowRef.current?.distributeSelection('vertical')}>Space vertically</Button>
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
