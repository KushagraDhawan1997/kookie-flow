'use client';

import { useMemo, useState } from 'react';
import { KookieFlow, useGraph, type Entity, type Edge } from '@kushagradhawan/kookie-flow';

// Socket type patterns for type-aware edge connections
const socketPatterns = [
  {
    inputs: [
      { name: 'Prompt', type: 'string' },
      { name: 'Input', type: 'float' },
      { name: 'Seed', type: 'int' },
    ],
    outputs: [
      { name: 'Value', type: 'float' },
      { name: 'Signal', type: 'signal' },
      { name: 'Log', type: 'string' },
    ],
  },
  {
    inputs: [
      { name: 'A', type: 'float' },
      { name: 'B', type: 'float' },
    ],
    outputs: [{ name: 'Result', type: 'float' }],
  },
  {
    inputs: [
      { name: 'Value', type: 'float' },
      { name: 'Width', type: 'int' },
    ],
    outputs: [
      { name: 'Image', type: 'image' },
      { name: 'Mask', type: 'mask' },
    ],
  },
  {
    inputs: [
      { name: 'Image', type: 'image' },
      { name: 'Mask', type: 'mask' },
    ],
    outputs: [{ name: 'Output', type: 'image' }],
  },
  {
    inputs: [
      { name: 'Image', type: 'image' },
      { name: 'Region', type: 'mask' },
    ],
    outputs: [
      { name: 'Mean', type: 'float' },
      { name: 'Histogram', type: 'signal' },
    ],
  },
];

const nodeColors = [
  'purple',
  'blue',
  'green',
  'orange',
  'red',
  'pink',
  'cyan',
  'teal',
  'indigo',
  'violet',
] as const;

const NODE_COUNT_OPTIONS = [100, 500, 1_000, 2_500, 5_000, 10_000] as const;

function generateEntities(count: number): Entity[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 450;

  const entities: Entity[] = Array.from({ length: count }, (_, i) => {
    const pattern = socketPatterns[i % socketPatterns.length];
    const entity: Entity = {
      id: `node-${i}`,
      type: 'default',
      position: {
        x: (i % cols) * spacing,
        y: Math.floor(i / cols) * spacing,
      },
      data: { label: `Node ${i + 1}` },
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
    if (i % 10 === 0) {
      entity.color = nodeColors[(i / 10) % nodeColors.length];
    }
    return entity;
  });

  // Add sample text entities with sockets — text nodes are first-class graph participants
  entities.push({
    id: 'text-prompt',
    type: 'text',
    position: { x: -400, y: 0 },
    width: 240,
    height: 60,
    data: { content: 'A photorealistic mountain landscape at golden hour with dramatic clouds' },
    resizable: { width: true, height: false },
    outputs: [{ id: 'text-prompt-out', name: 'Prompt', type: 'string' }],
  });
  entities.push({
    id: 'text-notes',
    type: 'text',
    position: { x: -400, y: 200 },
    width: 200,
    height: 40,
    data: { content: '' },
    resizable: { width: true, height: false },
    inputs: [{ id: 'text-notes-in', name: 'Log', type: 'string' }],
  });

  // Image entities — rendered as WebGL textured quads (real photos from /public)
  entities.push({
    id: 'image-source',
    type: 'image',
    position: { x: -400, y: 400 },
    width: 280,
    height: 200,
    data: {
      src: '/image-1.jpg',
      alt: 'Source image',
      objectFit: 'cover',
    },
    outputs: [{ id: 'image-source-out', name: 'Image', type: 'image' }],
  });

  entities.push({
    id: 'image-processed',
    type: 'image',
    position: { x: -400, y: 680 },
    width: 240,
    height: 180,
    data: {
      src: '/image-2.jpg',
      alt: 'Processed image',
      objectFit: 'contain',
    },
    color: 'orange',
    inputs: [{ id: 'image-processed-in', name: 'Image', type: 'image' }],
    outputs: [{ id: 'image-processed-out', name: 'Output', type: 'image' }],
  });

  entities.push({
    id: 'image-result',
    type: 'image',
    position: { x: -400, y: 940 },
    width: 320,
    height: 220,
    data: {
      src: '/image-3.jpg',
      alt: 'Result image',
    },
    color: 'green',
    inputs: [{ id: 'image-result-in', name: 'Image', type: 'image' }],
  });

  // Standalone image entity with both input and output sockets
  entities.push({
    id: 'image-standalone',
    type: 'image',
    position: { x: -100, y: 600 },
    width: 300,
    height: 220,
    data: {
      src: '/image-2.jpg',
      alt: 'Standalone image with sockets',
    },
    inputs: [
      { id: 'image-standalone-in-1', name: 'Image', type: 'image' },
      { id: 'image-standalone-in-2', name: 'Mask', type: 'image' },
    ],
    outputs: [
      { id: 'image-standalone-out-1', name: 'Result', type: 'image' },
      { id: 'image-standalone-out-2', name: 'Alpha', type: 'float' },
    ],
  });

  return entities;
}

function findCompatibleSockets(
  sourceIdx: number,
  targetIdx: number
): { sourceSocket: string; targetSocket: string } | null {
  const sourcePattern = socketPatterns[sourceIdx % socketPatterns.length];
  const targetPattern = socketPatterns[targetIdx % socketPatterns.length];
  for (let outIdx = 0; outIdx < sourcePattern.outputs.length; outIdx++) {
    const outType = sourcePattern.outputs[outIdx].type;
    for (let inIdx = 0; inIdx < targetPattern.inputs.length; inIdx++) {
      if (targetPattern.inputs[inIdx].type === outType) {
        return {
          sourceSocket: `node-${sourceIdx}-out-${outIdx}`,
          targetSocket: `node-${targetIdx}-in-${inIdx}`,
        };
      }
    }
  }
  return null;
}

function generateEdges(nodeCount: number): Edge[] {
  const edges: Edge[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));

  for (let i = 0; i < nodeCount; i++) {
    const col = i % cols;

    // Horizontal
    if (col + 1 < cols && i + 1 < nodeCount) {
      const sockets = findCompatibleSockets(i, i + 1);
      if (sockets) {
        edges.push({
          id: `edge-h-${i}`,
          source: `node-${i}`,
          target: `node-${i + 1}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        });
      }
    }

    // Vertical
    const bottomIdx = i + cols;
    if (bottomIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, bottomIdx);
      if (sockets) {
        edges.push({
          id: `edge-v-${i}`,
          source: `node-${i}`,
          target: `node-${bottomIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        });
      }
    }

    // Diagonal (every 3rd)
    const diagIdx = i + cols + 1;
    if (i % 3 === 0 && col + 1 < cols && diagIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, diagIdx);
      if (sockets) {
        edges.push({
          id: `edge-d-${i}`,
          source: `node-${i}`,
          target: `node-${diagIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        });
      }
    }

    // Skip (every 5th, 2 ahead)
    if (i % 5 === 0 && col + 2 < cols && i + 2 < nodeCount) {
      const sockets = findCompatibleSockets(i, i + 2);
      if (sockets) {
        edges.push({
          id: `edge-skip-${i}`,
          source: `node-${i}`,
          target: `node-${i + 2}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        });
      }
    }
  }

  // Connect text entities into the graph
  edges.push({
    id: 'edge-text-prompt',
    source: 'text-prompt',
    target: 'node-0',
    sourceSocket: 'text-prompt-out',
    targetSocket: 'node-0-in-0',
  });
  edges.push({
    id: 'edge-text-notes',
    source: 'node-0',
    target: 'text-notes',
    sourceSocket: 'node-0-out-2',
    targetSocket: 'text-notes-in',
  });

  // Connect image entities into an image pipeline
  edges.push({
    id: 'edge-image-source-to-processed',
    source: 'image-source',
    target: 'image-processed',
    sourceSocket: 'image-source-out',
    targetSocket: 'image-processed-in',
  });
  edges.push({
    id: 'edge-image-processed-to-result',
    source: 'image-processed',
    target: 'image-result',
    sourceSocket: 'image-processed-out',
    targetSocket: 'image-result-in',
  });

  return edges;
}

function WebGLBenchmarkGraph({ nodeCount }: { nodeCount: number }) {
  const initialEntities = useMemo(() => generateEntities(nodeCount), [nodeCount]);
  const initialEdges = useMemo(() => generateEdges(nodeCount), [nodeCount]);

  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges,
  });

  return (
    <KookieFlow
      entities={entities}
      edges={edges}
      onEntitiesChange={onEntitiesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      textRenderMode="webgl"
      showSocketLabels={false}
      showEdgeLabels={false}
      showWidgets={false}
      showGrid
      showStats
      showMinimap={false}
      variant="surface"
      size="2"
      header="outside"
    />
  );
}

export default function DemoWebGLPage() {
  const [nodeCount, setNodeCount] = useState<number>(100);

  return (
    <main style={{ width: '100vw', height: '100vh' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(0,0,0,0.85)',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: 13,
          color: '#fff',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span style={{ fontWeight: 600 }}>WebGL Benchmark</span>
        <select
          value={nodeCount}
          onChange={(e) => setNodeCount(Number(e.target.value))}
          style={{
            padding: '4px 8px',
            background: '#222',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {NODE_COUNT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} nodes
            </option>
          ))}
        </select>
      </div>

      <WebGLBenchmarkGraph key={nodeCount} nodeCount={nodeCount} />
    </main>
  );
}
