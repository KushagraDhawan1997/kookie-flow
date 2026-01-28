'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  KookieFlow,
  useGraph,
  useFlowStoreApi,
  useThemeTokens,
  type Node,
  type Edge,
  type NodeVariant,
} from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';
import { Theme } from '@kushagradhawan/kookie-ui';

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

// Kookie UI accent colors for node variety
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

// Widget demo nodes (positioned far left, away from complex nodes)
const widgetDemoNodes: Node[] = [
  {
    id: 'widget-demo-1',
    type: 'default',
    position: { x: -2000, y: 0 },
    data: { label: 'Slider Demo' },
    inputs: [
      { id: 'w1-in-0', name: 'Amount', type: 'float' },
      { id: 'w1-in-1', name: 'Intensity', type: 'float', min: 0, max: 10 },
      { id: 'w1-in-2', name: 'Strength', type: 'float', min: -1, max: 1 },
      { id: 'w1-in-3', name: 'Falloff', type: 'float', min: 0, max: 100 },
      { id: 'w1-in-4', name: 'Bias', type: 'float' },
    ],
    outputs: [
      { id: 'w1-out-0', name: 'Result', type: 'float' },
      { id: 'w1-out-1', name: 'Clamped', type: 'float' },
    ],
  },
  {
    id: 'widget-demo-2',
    type: 'default',
    position: { x: -2000, y: 300 },
    data: { label: 'Number Demo' },
    inputs: [
      { id: 'w2-in-0', name: 'Width', type: 'int' },
      { id: 'w2-in-1', name: 'Height', type: 'int', min: 1, max: 4096 },
      { id: 'w2-in-2', name: 'Depth', type: 'int', min: 1, max: 256 },
      { id: 'w2-in-3', name: 'Channels', type: 'int', min: 1, max: 4 },
      { id: 'w2-in-4', name: 'Batch Size', type: 'int', min: 1, max: 64 },
    ],
    outputs: [
      { id: 'w2-out-0', name: 'Size', type: 'int' },
      { id: 'w2-out-1', name: 'Total', type: 'int' },
    ],
  },
  {
    id: 'widget-demo-3',
    type: 'default',
    position: { x: -2000, y: 600 },
    data: { label: 'Select Demo' },
    inputs: [
      { id: 'w3-in-0', name: 'Mode', type: 'enum', options: ['Linear', 'Cubic', 'Nearest'] },
      { id: 'w3-in-1', name: 'Format', type: 'enum', options: ['RGB', 'RGBA', 'Grayscale'] },
      {
        id: 'w3-in-2',
        name: 'Blend',
        type: 'enum',
        options: ['Normal', 'Multiply', 'Screen', 'Overlay'],
      },
      {
        id: 'w3-in-3',
        name: 'Sampler',
        type: 'enum',
        options: ['Euler', 'DPM++', 'DDIM', 'UniPC'],
      },
    ],
    outputs: [
      { id: 'w3-out-0', name: 'Config', type: 'string' },
      { id: 'w3-out-1', name: 'Preset', type: 'string' },
    ],
  },
  {
    id: 'widget-demo-4',
    type: 'default',
    position: { x: -2000, y: 900 },
    data: { label: 'Mixed Widgets' },
    inputs: [
      { id: 'w4-in-0', name: 'Enabled', type: 'boolean' },
      { id: 'w4-in-1', name: 'Name', type: 'string', placeholder: 'Enter name...' },
      { id: 'w4-in-2', name: 'Tint', type: 'color' },
      { id: 'w4-in-3', name: 'Invert', type: 'boolean' },
      { id: 'w4-in-4', name: 'Label', type: 'string', placeholder: 'Label...' },
      { id: 'w4-in-5', name: 'Background', type: 'color' },
    ],
    outputs: [
      { id: 'w4-out-0', name: 'Output', type: 'image' },
      { id: 'w4-out-1', name: 'Mask', type: 'mask' },
    ],
  },
  {
    id: 'widget-demo-5',
    type: 'default',
    position: { x: -2000, y: 1250 },
    data: { label: 'No Widget' },
    inputs: [
      { id: 'w5-in-0', name: 'Image', type: 'image' }, // No widget (connection only)
      { id: 'w5-in-1', name: 'Disabled', type: 'float', widget: false }, // Explicitly disabled
      { id: 'w5-in-2', name: 'Mask', type: 'mask' }, // No widget
      { id: 'w5-in-3', name: 'Signal', type: 'signal' }, // No widget
    ],
    outputs: [
      { id: 'w5-out-0', name: 'Result', type: 'image' },
      { id: 'w5-out-1', name: 'Debug', type: 'signal' },
    ],
  },
  // Stacked layout demo - textarea and full-width widgets
  {
    id: 'widget-demo-stacked',
    type: 'default',
    position: { x: -2500, y: 0 },
    color: 'violet',
    data: { label: 'Stacked Layout Demo' },
    inputs: [
      // Stacked textarea (label above, widget spans full width)
      {
        id: 'ws-in-0',
        name: 'Prompt',
        type: 'string',
        layout: 'stacked',
        widget: 'textarea',
        rows: 3,
        placeholder: 'Enter your prompt here...',
      },
      // Stacked slider (full-width slider)
      {
        id: 'ws-in-1',
        name: 'CFG Scale',
        type: 'float',
        layout: 'stacked',
        min: 1,
        max: 20,
      },
      // Inline textarea with 3 rows height
      {
        id: 'ws-in-2',
        name: 'Note',
        type: 'string',
        widget: 'textarea',
        rows: 3,
        placeholder: 'Inline textarea...',
      },
      // Standard inline widget for comparison
      { id: 'ws-in-3', name: 'Steps', type: 'int', min: 1, max: 150 },
      // Inline with more rows
      {
        id: 'ws-in-4',
        name: 'Code',
        type: 'string',
        widget: 'textarea',
        rows: 2,
        placeholder: 'Multi-row inline...',
      },
    ],
    outputs: [
      { id: 'ws-out-0', name: 'Image', type: 'image' },
    ],
  },
  // Extremely complex nodes with many widgets
  {
    id: 'complex-node-1',
    type: 'default',
    position: { x: -1500, y: -500 },
    color: 'purple',
    data: { label: 'Image Generator (Complex)' },
    inputs: [
      {
        id: 'cx1-in-0',
        name: 'Positive Prompt Input',
        type: 'string',
        placeholder: 'Enter prompt...',
      },
      {
        id: 'cx1-in-1',
        name: 'Negative Prompt Input',
        type: 'string',
        placeholder: 'Negative prompt...',
      },
      { id: 'cx1-in-2', name: 'Output Width', type: 'int', min: 64, max: 2048 },
      { id: 'cx1-in-3', name: 'Output Height', type: 'int', min: 64, max: 2048 },
      { id: 'cx1-in-4', name: 'Sampling Steps', type: 'int', min: 1, max: 150 },
      { id: 'cx1-in-5', name: 'CFG Scale Factor', type: 'float', min: 1, max: 30 },
      { id: 'cx1-in-6', name: 'Random Seed', type: 'int' },
      {
        id: 'cx1-in-7',
        name: 'Sampler Algorithm',
        type: 'enum',
        options: ['Euler', 'Euler a', 'DPM++ 2M', 'DPM++ SDE', 'DDIM', 'UniPC'],
      },
      {
        id: 'cx1-in-8',
        name: 'Scheduler Type',
        type: 'enum',
        options: ['Normal', 'Karras', 'Exponential', 'SGM Uniform'],
      },
      { id: 'cx1-in-9', name: 'Denoise Strength', type: 'float', min: 0, max: 1 },
      { id: 'cx1-in-10', name: 'Batch Size Count', type: 'int', min: 1, max: 16 },
      { id: 'cx1-in-11', name: 'Enable Tiling', type: 'boolean' },
      { id: 'cx1-in-12', name: 'Hi-Res Fix Enabled', type: 'boolean' },
      { id: 'cx1-in-13', name: 'CLIP Skip Layers', type: 'int', min: 1, max: 12 },
    ],
    outputs: [
      { id: 'cx1-out-0', name: 'Generated Image', type: 'image' },
      { id: 'cx1-out-1', name: 'Latent Output', type: 'signal' },
      { id: 'cx1-out-2', name: 'Seed Value Used', type: 'int' },
    ],
  },
  {
    id: 'complex-node-2',
    type: 'default',
    position: { x: -1200, y: -500 },
    color: 'blue',
    data: { label: 'ControlNet Processor' },
    inputs: [
      { id: 'cx2-in-0', name: 'Image', type: 'image' },
      {
        id: 'cx2-in-1',
        name: 'Control Type',
        type: 'enum',
        options: ['Canny', 'Depth', 'Normal', 'OpenPose', 'Scribble', 'Seg', 'Shuffle', 'Tile'],
      },
      { id: 'cx2-in-2', name: 'Weight', type: 'float', min: 0, max: 2 },
      { id: 'cx2-in-3', name: 'Start', type: 'float', min: 0, max: 1 },
      { id: 'cx2-in-4', name: 'End', type: 'float', min: 0, max: 1 },
      { id: 'cx2-in-5', name: 'Low Threshold', type: 'int', min: 0, max: 255 },
      { id: 'cx2-in-6', name: 'High Threshold', type: 'int', min: 0, max: 255 },
      { id: 'cx2-in-7', name: 'Resolution', type: 'int', min: 64, max: 2048 },
      {
        id: 'cx2-in-8',
        name: 'Guidance Mode',
        type: 'enum',
        options: ['Balanced', 'My prompt', 'ControlNet'],
      },
      { id: 'cx2-in-9', name: 'Soft Injection', type: 'boolean' },
      { id: 'cx2-in-10', name: 'CFG Injection', type: 'boolean' },
    ],
    outputs: [
      { id: 'cx2-out-0', name: 'Control', type: 'signal' },
      { id: 'cx2-out-1', name: 'Preview', type: 'image' },
    ],
  },
  {
    id: 'complex-node-3',
    type: 'default',
    position: { x: -900, y: -500 },
    color: 'orange',
    data: { label: 'Advanced Compositor' },
    inputs: [
      { id: 'cx3-in-0', name: 'Base Image', type: 'image' },
      { id: 'cx3-in-1', name: 'Overlay', type: 'image' },
      { id: 'cx3-in-2', name: 'Mask', type: 'mask' },
      {
        id: 'cx3-in-3',
        name: 'Blend Mode',
        type: 'enum',
        options: [
          'Normal',
          'Multiply',
          'Screen',
          'Overlay',
          'Soft Light',
          'Hard Light',
          'Color Dodge',
          'Color Burn',
        ],
      },
      { id: 'cx3-in-4', name: 'Opacity', type: 'float', min: 0, max: 1 },
      { id: 'cx3-in-5', name: 'X Offset', type: 'int' },
      { id: 'cx3-in-6', name: 'Y Offset', type: 'int' },
      { id: 'cx3-in-7', name: 'Scale', type: 'float', min: 0.1, max: 10 },
      { id: 'cx3-in-8', name: 'Rotation', type: 'float', min: -180, max: 180 },
      { id: 'cx3-in-9', name: 'Feather', type: 'int', min: 0, max: 100 },
      { id: 'cx3-in-10', name: 'Tint', type: 'color' },
      { id: 'cx3-in-11', name: 'Preserve Alpha', type: 'boolean' },
      { id: 'cx3-in-12', name: 'Anti-alias', type: 'boolean' },
    ],
    outputs: [
      { id: 'cx3-out-0', name: 'Composite', type: 'image' },
      { id: 'cx3-out-1', name: 'Alpha', type: 'mask' },
    ],
  },
  {
    id: 'complex-node-4',
    type: 'default',
    position: { x: -600, y: -500 },
    color: 'teal',
    data: { label: 'Mega Color Grading' },
    inputs: [
      { id: 'cx4-in-0', name: 'Image', type: 'image' },
      { id: 'cx4-in-1', name: 'Temperature', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-2', name: 'Tint', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-3', name: 'Exposure', type: 'float', min: -5, max: 5 },
      { id: 'cx4-in-4', name: 'Contrast', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-5', name: 'Highlights', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-6', name: 'Shadows', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-7', name: 'Whites', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-8', name: 'Blacks', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-9', name: 'Vibrance', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-10', name: 'Saturation', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-11', name: 'Clarity', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-12', name: 'Dehaze', type: 'float', min: -100, max: 100 },
      { id: 'cx4-in-13', name: 'Vignette', type: 'float', min: 0, max: 100 },
      { id: 'cx4-in-14', name: 'Grain', type: 'float', min: 0, max: 100 },
      { id: 'cx4-in-15', name: 'Split Tone Hue', type: 'color' },
      { id: 'cx4-in-16', name: 'Enable LUT', type: 'boolean' },
      { id: 'cx4-in-17', name: 'LUT Intensity', type: 'float', min: 0, max: 1 },
    ],
    outputs: [
      { id: 'cx4-out-0', name: 'Graded', type: 'image' },
      { id: 'cx4-out-1', name: 'Histogram', type: 'signal' },
      { id: 'cx4-out-2', name: 'Waveform', type: 'signal' },
    ],
  },
  {
    id: 'complex-node-5',
    type: 'default',
    position: { x: -300, y: -500 },
    color: 'red',
    data: { label: 'Ultimate AI Upscaler' },
    inputs: [
      { id: 'cx5-in-0', name: 'Image', type: 'image' },
      { id: 'cx5-in-1', name: 'Scale Factor', type: 'enum', options: ['2x', '4x', '8x', '16x'] },
      {
        id: 'cx5-in-2',
        name: 'Model',
        type: 'enum',
        options: ['RealESRGAN', 'ESRGAN', 'SwinIR', 'HAT', 'DAT', 'OmniSR'],
      },
      { id: 'cx5-in-3', name: 'Denoise', type: 'float', min: 0, max: 1 },
      { id: 'cx5-in-4', name: 'Sharpness', type: 'float', min: 0, max: 2 },
      { id: 'cx5-in-5', name: 'Face Enhance', type: 'boolean' },
      {
        id: 'cx5-in-6',
        name: 'Face Model',
        type: 'enum',
        options: ['CodeFormer', 'GFPGAN', 'RestoreFormer'],
      },
      { id: 'cx5-in-7', name: 'Face Weight', type: 'float', min: 0, max: 1 },
      { id: 'cx5-in-8', name: 'Tile Size', type: 'int', min: 128, max: 1024 },
      { id: 'cx5-in-9', name: 'Tile Overlap', type: 'int', min: 8, max: 64 },
      { id: 'cx5-in-10', name: 'Half Precision', type: 'boolean' },
      {
        id: 'cx5-in-11',
        name: 'Output Format',
        type: 'enum',
        options: ['PNG', 'JPEG', 'WEBP', 'TIFF'],
      },
      { id: 'cx5-in-12', name: 'Quality', type: 'int', min: 1, max: 100 },
      { id: 'cx5-in-13', name: 'Color Fix', type: 'boolean' },
      { id: 'cx5-in-14', name: 'BG Enhance', type: 'boolean' },
      { id: 'cx5-in-15', name: 'BG Tile', type: 'boolean' },
    ],
    outputs: [
      { id: 'cx5-out-0', name: 'Upscaled', type: 'image' },
      { id: 'cx5-out-1', name: 'Faces', type: 'image' },
      { id: 'cx5-out-2', name: 'Info', type: 'string' },
    ],
  },
];

// Generate demo nodes with sockets
function generateNodes(count: number): Node[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 300;

  const gridNodes = Array.from({ length: count }, (_, i) => {
    const pattern = socketPatterns[i % socketPatterns.length];

    const node: Node = {
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

    // Add custom colors to some nodes (every 10th node)
    if (i % 10 === 0) {
      node.color = nodeColors[(i / 10) % nodeColors.length];
    }

    return node;
  });

  return [...widgetDemoNodes, ...gridNodes];
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

        // Add labels to some horizontal edges (spread across graph)
        if (i % 50 === 0) {
          edge.label = { text: `Flow ${i}`, fontSize: 12 };
          edge.markerEnd = { type: 'arrow', width: 16, height: 16 };
        } else if (i % 50 === 25) {
          edge.label = { text: 'Transfer', fontSize: 12 };
        }

        edges.push(edge);
      }
    }

    // Connect to bottom neighbor
    const bottomIdx = i + cols;
    if (bottomIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, bottomIdx);
      if (sockets) {
        const verticalEdge: Edge = {
          id: `edge-v-${i}`,
          source: `node-${i}`,
          target: `node-${bottomIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        };

        // Add labels to some vertical edges (spread across graph)
        if (i % 64 === 0) {
          verticalEdge.label = { text: 'Data ↓', fontSize: 12 };
        } else if (i % 64 === 32) {
          verticalEdge.label = { text: 'Sync', fontSize: 12 };
        }

        edges.push(verticalEdge);
      }
    }

    // Diagonal connections (every 3rd node, connect to bottom-right)
    const diagIdx = i + cols + 1;
    if (i % 3 === 0 && col + 1 < cols && diagIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, diagIdx);
      if (sockets) {
        const diagEdge: Edge = {
          id: `edge-d-${i}`,
          source: `node-${i}`,
          target: `node-${diagIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
          markerEnd: 'arrow',
        };

        // Add labels to some diagonal edges
        if (i % 99 === 0) {
          diagEdge.label = { text: 'Bypass', fontSize: 12, position: 0.6 };
        }

        edges.push(diagEdge);
      }
    }

    // Skip connections (every 5th node, connect 2 ahead)
    if (i % 5 === 0 && col + 2 < cols && i + 2 < nodeCount) {
      const sockets = findCompatibleSockets(i, i + 2);
      if (sockets) {
        const skipEdge: Edge = {
          id: `edge-skip-${i}`,
          source: `node-${i}`,
          target: `node-${i + 2}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        };

        // Add labels to some skip edges
        if (i % 100 === 0) {
          skipEdge.label = { text: 'Skip →', position: 0.4 };
          skipEdge.markerEnd = 'arrow';
        }

        edges.push(skipEdge);
      }
    }

    // Long vertical connections (every 7th node, connect 2 rows down)
    const longVertIdx = i + cols * 2;
    if (i % 7 === 0 && longVertIdx < nodeCount) {
      const sockets = findCompatibleSockets(i, longVertIdx);
      if (sockets) {
        const longEdge: Edge = {
          id: `edge-lv-${i}`,
          source: `node-${i}`,
          target: `node-${longVertIdx}`,
          sourceSocket: sockets.sourceSocket,
          targetSocket: sockets.targetSocket,
        };

        // Add labels to some long edges
        if (i % 77 === 0) {
          longEdge.label = 'Long Path';
        }

        edges.push(longEdge);
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

// Widget values display panel
function WidgetValuesPanel({ values }: { values: Record<string, Record<string, unknown>> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        padding: '12px 16px',
        borderRadius: 8,
        fontSize: 11,
        maxWidth: 300,
        maxHeight: 200,
        overflow: 'auto',
      }}
    >
      <h3 style={{ fontSize: 12, marginBottom: 8 }}>Widget Values</h3>
      {entries.slice(-5).map(([nodeId, sockets]) => (
        <div key={nodeId} style={{ marginBottom: 4 }}>
          <span style={{ color: '#4ade80' }}>{nodeId}</span>
          {Object.entries(sockets).map(([socketId, value]) => (
            <div key={socketId} style={{ paddingLeft: 8, color: '#888' }}>
              .{socketId.split('-').pop()} = {JSON.stringify(value)}
            </div>
          ))}
        </div>
      ))}
      <p style={{ color: '#555', fontSize: 10, marginTop: 8 }}>Last 5 changed nodes shown</p>
    </div>
  );
}

// All available node variants
const VARIANTS: NodeVariant[] = ['surface', 'outline', 'soft', 'classic', 'ghost'];

function VariantShowcase({
  variant,
  setVariant,
}: {
  variant: NodeVariant;
  setVariant: (v: NodeVariant) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 200,
        left: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        padding: '12px 16px',
        borderRadius: 8,
        fontSize: 12,
        minWidth: 180,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ fontSize: 13, marginBottom: 10 }}>Node Variants</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {VARIANTS.map((v) => (
          <label
            key={v}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="variant"
              value={v}
              checked={variant === v}
              onChange={() => setVariant(v)}
              style={{ cursor: 'pointer' }}
            />
            <span
              style={{
                color: variant === v ? '#4ade80' : '#888',
                textTransform: 'capitalize',
              }}
            >
              {v}
              {v === 'classic' && ' (shadow)'}
            </span>
          </label>
        ))}
      </div>
      <p style={{ color: '#555', fontSize: 10, marginTop: 10 }}>
        Classic variant shows drop shadows
      </p>
    </div>
  );
}

export default function DemoPage() {
  const nodeCount = 1000;
  const initialNodes = useMemo(() => generateNodes(nodeCount), [nodeCount]);
  const initialEdges = useMemo(() => generateEdges(nodeCount), [nodeCount]);
  const [variant, setVariant] = useState<NodeVariant>('surface');
  const [widgetValues, setWidgetValues] = useState<Record<string, Record<string, unknown>>>({});

  // Use ref to accumulate changes without triggering re-renders
  const pendingValuesRef = useRef<Record<string, Record<string, unknown>>>({});
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWidgetChange = useCallback((nodeId: string, socketId: string, value: unknown) => {
    // Accumulate in ref (no re-render)
    pendingValuesRef.current = {
      ...pendingValuesRef.current,
      [nodeId]: {
        ...pendingValuesRef.current[nodeId],
        [socketId]: value,
      },
    };

    // Debounce the state update (only updates display panel, not the widget itself)
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      setWidgetValues({ ...pendingValuesRef.current });
    }, 150);
  }, []);

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
          Variant: <span style={{ color: '#4ade80', textTransform: 'capitalize' }}>{variant}</span>
        </p>
      </div>

      <KookieFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        showGrid
        showMinimap
        minimapProps={{ zoomable: false }}
        textRenderMode="webgl"
        showSocketLabels
        showEdgeLabels
        // Styling props (Milestone 2)
        size="2"
        variant="classic"
        radius="medium"
        header="outside"
        accentHeader
        // Widget callback (uses DEFAULT_SOCKET_TYPES from package)
        onWidgetChange={handleWidgetChange}
        // Per-node accent color support for widgets
        ThemeComponent={Theme}
      >
        <ClipboardDemo />
        <ThemeTokensTest />
        <VariantShowcase variant={variant} setVariant={setVariant} />
        <WidgetValuesPanel values={widgetValues} />
      </KookieFlow>
    </main>
  );
}
