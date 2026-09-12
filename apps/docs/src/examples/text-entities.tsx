'use client';

import { useEffect, useRef } from 'react';
import {
  KookieFlow,
  Toolbar,
  resizableForSizingMode,
  useGraph,
  type Entity,
  type EntityTypeDefinition,
  type KookieFlowInstance,
  type TextEntityData,
  type TextSizingMode,
} from '@kushagradhawan/kookie-flow';

// `toolbar: true` shows the sizing, font, and colour controls when text is selected.
const entityTypes: Record<string, EntityTypeDefinition> = { text: { type: 'text', toolbar: true } };

function text(id: string, x: number, y: number, sizingMode: TextSizingMode, data: Partial<TextEntityData>): Entity {
  return {
    id,
    type: 'text',
    position: { x, y },
    width: 220,
    height: 64,
    // A new entity doesn't derive its resize handles from its sizing mode, so state them.
    resizable: resizableForSizingMode(sizingMode),
    data: { content: '', sizingMode, ...data },
  };
}

const initialEntities: Entity[] = [
  text('title', 0, 0, 'auto-width', { content: 'Release notes', fontSize: 28, fontWeight: 600 }),
  text('body', 0, 120, 'auto-height', { content: 'Auto height wraps at the width you drag, and grows downward as you type.' }),
  text('box', 260, 120, 'fixed', { content: 'Fixed keeps both sides where you put them, and clips anything that overflows.', textColor: '#8a8f98' }),
  {
    id: 'note', type: 'comment', position: { x: 520, y: 0 }, width: 200, height: 140,
    data: { content: 'Double-click a text block to edit it. Press Escape to finish.' },
  },
];

export default function TextEntitiesExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange } = useGraph({ initialEntities });

  const flowRef = useRef<KookieFlowInstance>(null);
  useEffect(() => {
    flowRef.current?.fitView({ padding: 48, maxZoom: 1 });
  }, []);

  return (
    <div style={{ width: '100%', height: 360 }}>
      <KookieFlow
        ref={flowRef}
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
