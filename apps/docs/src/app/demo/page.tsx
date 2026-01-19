'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  KookieFlow,
  useGraph,
  useFlowStoreApi,
  type Node,
  type Edge,
} from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';

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
    outputs: [{ name: 'Output', type: 'image' }],
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
      const edge: Edge = {
        id: `edge-h-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        sourceSocket: `node-${i}-out-0`,
        targetSocket: `node-${i + 1}-in-0`,
      };

      // Add labels to some edges (every 3rd edge)
      if (i % 3 === 0) {
        edge.label = `Data ${i + 1}`;
      }

      // Add arrow markers to some edges (every 2nd edge)
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

  return edges;
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
  const nodeCount = 25; // Smaller for demo
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
        scaleTextWithZoom
      >
        <ClipboardDemo />
      </KookieFlow>
    </main>
  );
}
