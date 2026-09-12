'use client';

import {
  KookieFlow,
  Toolbar,
  useGraph,
  type EntityTypeDefinition,
  type KookieFlowProps,
} from '@kushagradhawan/kookie-flow';

// Both objects live outside the component, so neither changes identity on a render.
const entityTypes: Record<string, EntityTypeDefinition> = {
  draw: { type: 'draw', toolbar: true },
};

const penStyle: KookieFlowProps['penStyle'] = { strokeWidth: 4, strokeColor: '#e5484d' };

export default function DrawingExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange } = useGraph({
    initialEntities: [
      {
        id: 'hint',
        type: 'text',
        position: { x: 40, y: 40 },
        width: 420,
        data: { content: 'Click the board, press D, and drag to draw. Press Escape to select.' },
      },
    ],
    history: true,
  });

  return (
    <div style={{ width: '100%', height: 360 }}>
      <KookieFlow
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
        entityTypes={entityTypes}
        penStyle={penStyle}
        ariaLabel="Drawing board"
      >
        <Toolbar />
      </KookieFlow>
    </div>
  );
}
