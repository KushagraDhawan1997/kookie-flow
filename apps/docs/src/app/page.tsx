'use client';

import { useMemo } from 'react';
import { KookieFlow, useGraph, type Node, type Edge } from '@kushagradhawan/kookie-flow';

// Socket type patterns for variety
const socketPatterns = [
  // Math node: float inputs, float output
  {
    inputs: [
      { name: 'A', type: 'float' },
      { name: 'B', type: 'float' },
    ],
    outputs: [{ name: 'Result', type: 'float' }],
  },
  // Image processing: image in, image + mask out
  {
    inputs: [
      { name: 'Image', type: 'image' },
      { name: 'Mask', type: 'mask' },
    ],
    outputs: [
      { name: 'Output', type: 'image' },
    ],
  },
  // Model loader: string path, model output
  {
    inputs: [{ name: 'Path', type: 'string' }],
    outputs: [
      { name: 'Model', type: 'model' },
      { name: 'CLIP', type: 'clip' },
    ],
  },
  // Conditioning: model + clip in, conditioning out
  {
    inputs: [
      { name: 'Model', type: 'model' },
      { name: 'CLIP', type: 'clip' },
    ],
    outputs: [{ name: 'Conditioning', type: 'conditioning' }],
  },
  // Sampler: latent + conditioning in, latent out
  {
    inputs: [
      { name: 'Latent', type: 'latent' },
      { name: 'Positive', type: 'conditioning' },
      { name: 'Negative', type: 'conditioning' },
    ],
    outputs: [{ name: 'Latent', type: 'latent' }],
  },
];

// Generate demo nodes with sockets
function generateNodes(count: number): Node[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 300;

  return Array.from({ length: count }, (_, i) => {
    const pattern = socketPatterns[i % socketPatterns.length];

    return {
      id: `node-${i}`,
      type: 'default',
      position: {
        x: (i % cols) * spacing,
        y: Math.floor(i / cols) * spacing,
      },
      data: {
        label: `Node ${i + 1}`,
      },
      inputs: pattern.inputs.map((input, j) => ({
        id: `node-${i}-in-${j}`,
        name: input.name,
        type: input.type,
      })),
      outputs: pattern.outputs.map((output, j) => ({
        id: `node-${i}-out-${j}`,
        name: output.name,
        type: output.type,
      })),
    };
  });
}

// Generate demo edges - connect first output to first input of neighbors
function generateEdges(nodeCount: number): Edge[] {
  const edges: Edge[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));

  for (let i = 0; i < nodeCount; i++) {
    // Connect to right neighbor
    if ((i + 1) % cols !== 0 && i + 1 < nodeCount) {
      edges.push({
        id: `edge-h-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        sourceSocket: `node-${i}-out-0`,
        targetSocket: `node-${i + 1}-in-0`,
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
