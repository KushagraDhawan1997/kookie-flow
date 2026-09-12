'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Card } from '@kookie-ui/react';
import {
  KookieFlow, getEntityAtPosition, screenToWorld, useGraph, useSocketLayout,
  type Entity, type KookieFlowInstance, type ResolvedSocketLayout, type XYPosition,
} from '@kushagradhawan/kookie-flow';
import { useContextMenu } from '@kushagradhawan/kookie-flow/plugins';

const step = (id: string, x: number, y: number, label = id): Entity => ({
  id, type: 'default', position: { x, y }, data: { label },
  inputs: [{ id: 'in', name: 'In', type: 'float', widget: false }],
  outputs: [{ id: 'out', name: 'Out', type: 'float' }],
});

// useSocketLayout works only inside KookieFlow, so this child copies the layout into a ref.
function ShareLayout({ into }: { into: RefObject<ResolvedSocketLayout | undefined> }) {
  const layout = useSocketLayout();
  useEffect(() => { into.current = layout; }, [into, layout]);
  return null;
}

export default function ContextMenuExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities: [step('Load', 40, 60), step('Resize', 380, 120)],
    initialEdges: [{ id: 'e1', source: 'Load', sourceSocket: 'out', target: 'Resize', targetSocket: 'in' }],
  });
  const flowRef = useRef<KookieFlowInstance>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<XYPosition>({ x: 0, y: 0 });
  const layoutRef = useRef<ResolvedSocketLayout | undefined>(undefined);
  const { contextMenu, onContextMenu } = useContextMenu();

  const handleContextMenu = (event: React.MouseEvent) => {
    const flow = flowRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!flow || !box) return;
    const world = screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top }, flow.getViewport());
    const entity = getEntityAtPosition(world, flow.getEntities(), layoutRef.current);
    setOrigin({ x: box.left, y: box.top });
    onContextMenu(event, entity ? { type: 'entity', entity } : { type: 'pane' }, world);
  };

  const remove = (id: string) => {
    // Removing an entity leaves its edges behind, so remove those too.
    onEdgesChange(edges.filter((e) => e.source === id || e.target === id).map((e) => ({ type: 'remove', id: e.id })));
    onEntitiesChange([{ type: 'remove', id }]);
  };
  const add = (position: XYPosition) =>
    onEntitiesChange([{ type: 'add', entity: step(crypto.randomUUID(), position.x, position.y, 'New step') }]);

  const target = contextMenu?.target;
  return (
    <div ref={boxRef} onContextMenu={handleContextMenu} style={{ position: 'relative', width: '100%', height: 360 }}>
      <KookieFlow ref={flowRef} entities={entities} edges={edges}
        onEntitiesChange={onEntitiesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}>
        <ShareLayout into={layoutRef} />
      </KookieFlow>
      {contextMenu && (
        <div style={{ position: 'absolute', left: contextMenu.position.x - origin.x, top: contextMenu.position.y - origin.y, zIndex: 10 }}>
          <Card size="1">
            {target?.type === 'entity' ? (
              <Button emphasis="quiet" tone="destructive" onClick={() => remove(target.entity.id)}>Delete</Button>
            ) : (
              <Button emphasis="quiet" onClick={() => add(contextMenu.worldPosition)}>Add node</Button>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
