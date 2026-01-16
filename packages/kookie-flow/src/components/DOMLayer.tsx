import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useFlowStore } from './context';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';
import type { Node, NodeTypeDefinition } from '../types';

export interface DOMLayerProps {
  nodeTypes?: Record<string, NodeTypeDefinition>;
  children?: ReactNode;
}

/**
 * DOM overlay layer for text labels and interactive widgets.
 * Positioned absolutely over the WebGL canvas.
 */
export function DOMLayer({ nodeTypes = {}, children }: DOMLayerProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const viewport = useFlowStore((state) => state.viewport);

  // Transform style to match camera
  const containerStyle: CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
    }),
    []
  );

  const transformStyle: CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      transformOrigin: '0 0',
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    }),
    [viewport]
  );

  return (
    <div style={containerStyle}>
      <div style={transformStyle}>
        {nodes.map((node) => (
          <NodeLabel key={node.id} node={node} nodeTypes={nodeTypes} />
        ))}
      </div>
      {children}
    </div>
  );
}

interface NodeLabelProps {
  node: Node;
  nodeTypes: Record<string, NodeTypeDefinition>;
}

function NodeLabel({ node, nodeTypes }: NodeLabelProps) {
  const nodeType = nodeTypes[node.type];
  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;

  const style: CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      left: node.position.x,
      top: node.position.y,
      width,
      height,
      pointerEvents: 'auto',
      userSelect: 'none',
    }),
    [node.position.x, node.position.y, width, height]
  );

  const labelStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const label = nodeType?.label ?? node.data.label ?? node.type;

  return (
    <div style={style}>
      <div style={labelStyle}>{label}</div>
    </div>
  );
}
