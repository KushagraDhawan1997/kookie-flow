'use client';

import { useMemo } from 'react';
import { KookieFlow, useGraph, type Node, type Edge } from '@kushagradhawan/kookie-flow';

// Generate demo nodes with sockets
function generateNodes(count: number): Node[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 300;

  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    type: 'default',
    position: {
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
    },
    data: {
      label: `Node ${i + 1}`,
    },
    // Add sockets to nodes
    inputs: [
      { id: `node-${i}-in-0`, name: 'Input A', type: 'float' },
      { id: `node-${i}-in-1`, name: 'Input B', type: 'float' },
    ],
    outputs: [
      { id: `node-${i}-out-0`, name: 'Output', type: 'float' },
    ],
  }));
}

// Generate demo edges connecting sockets
function generateEdges(nodeCount: number): Edge[] {
  const edges: Edge[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));

  for (let i = 0; i < nodeCount; i++) {
    // Connect to right neighbor (output to input A)
    if ((i + 1) % cols !== 0 && i + 1 < nodeCount) {
      edges.push({
        id: `edge-${i}-${i + 1}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        sourceSocket: `node-${i}-out-0`,
        targetSocket: `node-${i + 1}-in-0`,
      });
    }
    // Connect to bottom neighbor (output to input B)
    if (i + cols < nodeCount) {
      edges.push({
        id: `edge-${i}-${i + cols}`,
        source: `node-${i}`,
        target: `node-${i + cols}`,
        sourceSocket: `node-${i}-out-0`,
        targetSocket: `node-${i + cols}-in-1`,
      });
    }
  }

  return edges;
}

export default function Home() {
  // Reduced count for socket testing (can increase after verification)
  const nodeCount = 100;

  const initialNodes = useMemo(() => generateNodes(nodeCount), [nodeCount]);
  const initialEdges = useMemo(() => generateEdges(nodeCount), [nodeCount]);

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useGraph({
    initialNodes,
    initialEdges,
  });

  return (
    <main style={{ width: '100vw', height: '100vh' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(0,0,0,0.8)',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: 14,
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Kookie Flow</h1>
        <p style={{ color: '#888' }}>
          {nodes.length} nodes, {edges.length} edges
        </p>
        <p style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
          Drag from sockets to connect
        </p>
      </div>

      <KookieFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        showGrid
        showStats
        scaleTextWithZoom
      />
    </main>
  );
}
