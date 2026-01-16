'use client';

import { useMemo } from 'react';
import { KookieFlow, useGraph, type Node, type Edge } from '@kushagradhawan/kookie-flow';

// Generate demo nodes
function generateNodes(count: number): Node[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 250;

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
  }));
}

// Generate demo edges (connect sequential nodes)
function generateEdges(nodeCount: number): Edge[] {
  const edges: Edge[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));

  for (let i = 0; i < nodeCount; i++) {
    // Connect to right neighbor
    if ((i + 1) % cols !== 0 && i + 1 < nodeCount) {
      edges.push({
        id: `edge-${i}-${i + 1}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
      });
    }
    // Connect to bottom neighbor
    if (i + cols < nodeCount) {
      edges.push({
        id: `edge-${i}-${i + cols}`,
        source: `node-${i}`,
        target: `node-${i + cols}`,
      });
    }
  }

  return edges;
}

export default function Home() {
  const nodeCount = 100; // Start with 100, increase to test performance

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
      </div>

      <KookieFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        showGrid
      />
    </main>
  );
}
