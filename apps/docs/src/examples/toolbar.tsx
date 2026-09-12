'use client';

import { Button } from '@kookie-ui/react';
import {
  KookieFlow,
  Toolbar,
  useGraph,
  type Entity,
  type EntityTypeDefinition,
} from '@kushagradhawan/kookie-flow';

// Outside the component, so the table keeps one identity across renders.
const entityTypes: Record<string, EntityTypeDefinition> = {
  text: { type: 'text', toolbar: true },
  comment: { type: 'comment', toolbar: true },
  step: {
    type: 'step',
    toolbar: {
      // Align and distribute, then one control of your own.
      defaults: ['arrange'],
      extra: ({ entities, update }) => {
        const flagged = entities.every((entity) => entity.data.status === 'warning');
        const toggle = () =>
          entities.forEach((entity) => update(entity.id, { status: flagged ? undefined : 'warning' }));
        return (
          <Button size="2" emphasis="quiet" onClick={toggle}>
            {flagged ? 'Clear flag' : 'Flag'}
          </Button>
        );
      },
    },
  },
};

const initialEntities: Entity[] = [
  { id: 'title', type: 'text', position: { x: 40, y: 40 }, width: 320, data: { content: 'Image pipeline' } },
  { id: 'note', type: 'comment', position: { x: 440, y: 30 }, width: 220, height: 90, data: { content: 'Drag a box around all three steps.' } },
  { id: 'load', type: 'step', position: { x: 40, y: 180 }, data: { label: 'Load' } },
  { id: 'resize', type: 'step', position: { x: 340, y: 230 }, data: { label: 'Resize' } },
  { id: 'export', type: 'step', position: { x: 640, y: 200 }, data: { label: 'Export' } },
];

export default function ToolbarExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange } = useGraph({ initialEntities });

  return (
    <div style={{ width: '100%', height: 400 }}>
      <KookieFlow
        entities={entities}
        edges={edges}
        entityTypes={entityTypes}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
      >
        <Toolbar />
      </KookieFlow>
    </div>
  );
}
