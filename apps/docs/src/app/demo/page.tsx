'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  KookieFlow,
  useGraph,
  useFlowStoreApi,
  useThemeTokens,
  type Node,
  type Edge,
} from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';

// Socket type patterns designed to chain together
// Each pattern's first output matches the next pattern's first input
const socketPatterns = [
  // Pattern 0: Source/Generator - outputs float (also accepts float to close the loop)
  {
    inputs: [
      { name: 'Input', type: 'float' },
      { name: 'Seed', type: 'int' },
    ],
    outputs: [
      { name: 'Value', type: 'float' },
      { name: 'Signal', type: 'signal' },
    ],
  },
  // Pattern 1: Math - float in, float out (chains from 0)
  {
    inputs: [
      { name: 'A', type: 'float' },
      { name: 'B', type: 'float' },
    ],
    outputs: [{ name: 'Result', type: 'float' }],
  },
  // Pattern 2: Converter - float in, image out (chains from 1)
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
  // Pattern 3: Image processor - image in, image out (chains from 2)
  {
    inputs: [
      { name: 'Image', type: 'image' },
      { name: 'Mask', type: 'mask' },
    ],
    outputs: [{ name: 'Output', type: 'image' }],
  },
  // Pattern 4: Analyzer - image in, float out (chains from 3, back to 0/1)
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

// Find compatible socket pair between two nodes
function findCompatibleSockets(
  sourceIdx: number,
  targetIdx: number
): { sourceSocket: string; targetSocket: string } | null {
  const sourcePattern = socketPatterns[sourceIdx % socketPatterns.length];
  const targetPattern = socketPatterns[targetIdx % socketPatterns.length];

  // Try to find matching types
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

// Generate demo edges with more interlinking (type-aware)
function generateEdges(nodeCount: number): Edge[] {
  const edges: Edge[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));

  for (let i = 0; i < nodeCount; i++) {
    const col = i % cols;

    // Connect to right neighbor
    if (col + 1 < cols && i + 1 < nodeCount) {
      const sockets = findCompatibleSockets(i, i + 1);
      if (sockets) {
        const edge: Edge = {
          id: `edge-h-${i}`,
          source: `node-${i}`,
          target: `node-${i + 1}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        };

        // Add arrow markers to horizontal edges
        if (i % 2 === 0) {
          edge.markerEnd = 'arrow';
        }

        // Add styled label to first edge
        if (i === 0) {
          edge.label = {
            text: 'Primary',
            bgColor: 'rgba(99, 102, 241, 0.8)',
            textColor: '#fff',
            fontSize: 11,
          };
          edge.markerEnd = { type: 'arrow', width: 16, height: 16 };
        }

        edges.push(edge);
      }
    }

    // Connect to bottom neighbor
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

    // Diagonal connections (every 3rd node, connect to bottom-right)
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
          markerEnd: 'arrow',
        });
      }
    }

    // Skip connections (every 5th node, connect 2 ahead)
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

    // Long vertical connections (every 7th node, connect 2 rows down)
    const longVertIdx = i + cols * 2;
    if (i % 7 === 0 && longVertIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, longVertIdx);
      if (sockets) {
        edges.push({
          id: `edge-lv-${i}`,
          source: `node-${i}`,
          target: `node-${longVertIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        });
      }
    }
  }

  return edges;
}

function ThemeTokensTest() {
  const tokens = useThemeTokens();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    console.log('[ThemeTokens Test] Tokens loaded:', {
      spacing: {
        '--space-1': tokens['--space-1'],
        '--space-2': tokens['--space-2'],
        '--space-3': tokens['--space-3'],
      },
      radius: {
        '--radius-3': tokens['--radius-3'],
        '--radius-4': tokens['--radius-4'],
      },
      colors: {
        '--gray-1': tokens['--gray-1'],
        '--gray-6': tokens['--gray-6'],
        '--accent-9': tokens['--accent-9'],
        '--blue-9': tokens['--blue-9'],
      },
      appearance: tokens.appearance,
    });
  }, [tokens]);

  if (!mounted) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        padding: '12px 16px',
        borderRadius: 8,
        fontSize: 11,
        maxWidth: 280,
      }}
    >
      <h3 style={{ fontSize: 12, marginBottom: 8 }}>Theme Tokens Test</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <span style={{ color: '#888' }}>--space-3:</span>
        <span>{tokens['--space-3']}px</span>
        <span style={{ color: '#888' }}>--radius-4:</span>
        <span>{tokens['--radius-4']}px</span>
        <span style={{ color: '#888' }}>--gray-6:</span>
        <span
          style={{ color: `rgb(${tokens['--gray-6'].map((v) => Math.round(v * 255)).join(',')})` }}
        >
          ■ [{tokens['--gray-6'].map((v) => v.toFixed(2)).join(', ')}]
        </span>
        <span style={{ color: '#888' }}>--accent-9:</span>
        <span
          style={{
            color: `rgb(${tokens['--accent-9'].map((v) => Math.round(v * 255)).join(',')})`,
          }}
        >
          ■ [{tokens['--accent-9'].map((v) => v.toFixed(2)).join(', ')}]
        </span>
        <span style={{ color: '#888' }}>appearance:</span>
        <span>{tokens.appearance}</span>
      </div>
      <p style={{ color: '#555', fontSize: 10, marginTop: 8 }}>Check console for full tokens</p>
    </div>
  );
}

function ClipboardDemo() {
  const store = useFlowStoreApi();
  const { copy, paste, cut, hasClipboardContent } = useClipboard();
  const [clipboardSize, setClipboardSize] = useState(0);
  const [preserveExternal, setPreserveExternal] = useState(true);

  // Update clipboard size display when clipboard changes
  useEffect(() => {
    const unsubscribe = store.subscribe(
      (state) => state.internalClipboard,
      (clipboard) => {
        setClipboardSize(clipboard?.nodes.length ?? 0);
      }
    );
    return unsubscribe;
  }, [store]);

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    bindings: {
      'mod+c': () => {
        copy();
        const clipboard = store.getState().internalClipboard;
        setClipboardSize(clipboard?.nodes.length ?? 0);
      },
      'mod+v': () => paste({ preserveExternalConnections: preserveExternal }),
      'mod+x': () => {
        cut();
        setClipboardSize(0);
      },
      'mod+a': () => store.getState().selectAll(),
      delete: () => store.getState().deleteSelected(),
      escape: () => store.getState().deselectAll(),
    },
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        padding: '12px 16px',
        borderRadius: 8,
        fontSize: 12,
        minWidth: 220,
        pointerEvents: 'auto',
      }}
    >
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Clipboard</h2>
      <p style={{ color: clipboardSize > 0 ? '#4ade80' : '#666' }}>
        {clipboardSize > 0 ? `${clipboardSize} nodes copied` : 'Empty'}
      </p>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button
          onClick={copy}
          style={{
            padding: '4px 8px',
            background: '#333',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Copy
        </button>
        <button
          onClick={() => paste({ preserveExternalConnections: preserveExternal })}
          disabled={!hasClipboardContent()}
          style={{
            padding: '4px 8px',
            background: hasClipboardContent() ? '#333' : '#222',
            border: '1px solid #555',
            borderRadius: 4,
            color: hasClipboardContent() ? '#fff' : '#666',
            cursor: hasClipboardContent() ? 'pointer' : 'not-allowed',
          }}
        >
          Paste
        </button>
        <button
          onClick={cut}
          style={{
            padding: '4px 8px',
            background: '#333',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Cut
        </button>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={preserveExternal}
          onChange={(e) => setPreserveExternal(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ color: preserveExternal ? '#4ade80' : '#888' }}>
          Keep external connections
        </span>
      </label>
      <p style={{ color: '#555', fontSize: 10, marginTop: 8 }}>
        {preserveExternal
          ? 'Pasted nodes will reconnect to original neighbors'
          : 'Pasted nodes are isolated (internal edges only)'}
      </p>
      <p style={{ color: '#444', fontSize: 10, marginTop: 4 }}>Shortcuts: ⌘C ⌘V ⌘X ⌘A Del Esc</p>
    </div>
  );
}

export default function DemoPage() {
  const nodeCount = 1000; // Smxpaller for demo
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
          Edge labels &amp; arrow markers demo
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
        showMinimap
        minimapProps={{ zoomable: false }}
        textRenderMode="webgl"
        showSocketLabels
        showEdgeLabels
        // Styling props (Milestone 2) - try different values!
        size="2"
        variant="classic"
        radius="medium"
        header="outside"
        accentHeader
      >
        <ClipboardDemo />
        <ThemeTokensTest />
      </KookieFlow>
    </main>
  );
}
