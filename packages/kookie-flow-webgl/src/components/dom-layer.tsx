import type { CSSProperties, ReactNode } from 'react';
import type { EntityTypeDefinition, EntityChange } from '../types';
import { TextEditOverlay } from './text-edit-overlay';
import { ToolbarProvider } from './toolbar';
const EMPTY_ENTITY_TYPES: Record<string, EntityTypeDefinition> = {};
const containerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
};
export interface DOMLayerProps {
  entityTypes?: Record<string, EntityTypeDefinition>;
  onEntitiesChange?: (changes: EntityChange[]) => void;
  children?: ReactNode;
}
/** Native text input and app chrome only. Graph entities are drawn by the GPU. */
export function DOMLayer({
  entityTypes = EMPTY_ENTITY_TYPES,
  onEntitiesChange,
  children,
}: DOMLayerProps) {
  return (
    <div style={containerStyle}>
      <TextEditOverlay onEntitiesChange={onEntitiesChange} />
      <ToolbarProvider entityTypes={entityTypes} onEntitiesChange={onEntitiesChange}>
        {children}
      </ToolbarProvider>
    </div>
  );
}
