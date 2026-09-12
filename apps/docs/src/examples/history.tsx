'use client';

import { useEffect, useRef } from 'react';
import { Button, Flex, Stack } from '@kookie-ui/react';
import { KookieFlow, useGraph, type Edge, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';

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

export default function HistoryExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect, undo, redo, canUndo, canRedo } = useGraph({
    initialEntities: [node('Load', 0, 60), node('Blur', 300, 0), node('Sharpen', 300, 160), node('Save', 600, 60)],
    initialEdges: [wire('Load', 'Blur'), wire('Blur', 'Save')],
    // Fifty steps, and Cmd/Ctrl+Z while the canvas has focus.
    history: true,
  });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 40, maxZoom: 1 });
  }, []);

  return (
    <Stack gap="3">
      {/* Drag a node, wire Load into Sharpen, or delete one, then undo. Clicking to select adds no step. */}
      <Flex gap="2">
        <Button size="2" onClick={undo} disabled={!canUndo}>Undo</Button>
        <Button size="2" onClick={redo} disabled={!canRedo}>Redo</Button>
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
