'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  KookieFlow,
  useGraph,
  useFlowStoreApi,
  type Entity,
  type Edge,
  type KookieFlowInstance,
  type ConnectionEndState,
} from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';
import { Code, Flex, Switch, Text, ToolbarButton, ToolbarGroup } from '@kushagradhawan/kookie-ui-react';

import { DemoFrame } from '../demo-frame';
import { MinusIcon, PlusIcon } from '../icons';

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

// ============================================================================
// Phase 7C: Grouping Demo Nodes
// ============================================================================

/**
 * A frame holding a small pipeline, a reroute bending one of its wires, and two notes that say
 * what to try. Laid out on the 240px node width: columns of 240 with 40px gutters, so no card
 * covers another's sockets. Every wire runs forward, left to right.
 */
const groupingDemoNodes: Entity[] = [
  {
    id: 'group-1',
    type: 'frame',
    position: { x: -3500, y: 0 },
    width: 880,
    height: 470,
    data: {
      label: 'Processing Pipeline',
      description: 'Image processing nodes',
    },
    color: 'violet',
  },
  {
    id: 'child-1',
    type: 'default',
    position: { x: -3460, y: 60 },
    parentId: 'group-1',
    data: { label: 'Input' },
    inputs: [],
    outputs: [{ id: 'child-1-out-0', name: 'Image', type: 'image' }],
    color: 'blue',
  },
  {
    id: 'child-2',
    type: 'default',
    position: { x: -3180, y: 60 },
    parentId: 'group-1',
    data: { label: 'Filter' },
    inputs: [{ id: 'child-2-in-0', name: 'In', type: 'image' }],
    outputs: [{ id: 'child-2-out-0', name: 'Out', type: 'image' }],
    color: 'green',
  },
  {
    id: 'child-3',
    type: 'default',
    position: { x: -2900, y: 60 },
    parentId: 'group-1',
    data: { label: 'Output' },
    inputs: [{ id: 'child-3-in-0', name: 'In', type: 'image' }],
    outputs: [],
    color: 'orange',
  },
  {
    id: 'child-4',
    type: 'default',
    position: { x: -2900, y: 290 },
    parentId: 'group-1',
    data: { label: 'Preview' },
    inputs: [{ id: 'child-4-in-0', name: 'In', type: 'image' }],
    outputs: [],
    color: 'pink',
  },

  // The waypoint the Input -> Preview wire bends through: down the gutter beside Input, under
  // Filter rather than across it.
  {
    id: 'reroute-1',
    type: 'reroute',
    position: { x: -3190, y: 430 },
    parentId: 'group-1',
    data: {},
  },

  // Sticky notes. No colours of their own: a note takes its tint from the theme, so these read in
  // light and dark alike. `color` picks the hue.
  {
    id: 'comment-1',
    type: 'comment',
    position: { x: -3500, y: 510 },
    width: 320,
    height: 96,
    data: {
      content: 'A frame groups nodes. Drag the frame and everything inside it moves too.',
    },
  },
  {
    id: 'comment-2',
    type: 'comment',
    position: { x: -3140, y: 510 },
    width: 340,
    height: 96,
    data: {
      content: 'The wire from Input to Preview bends through a reroute. Drag the dot to route it somewhere else.',
      color: 'violet',
    },
  },
];

// Edges for the grouping demo
const groupingDemoEdges: Edge[] = [
  {
    id: 'group-edge-1',
    source: 'child-1',
    target: 'child-2',
    sourceSocket: 'child-1-out-0',
    targetSocket: 'child-2-in-0',
  },
  {
    id: 'group-edge-2',
    source: 'child-2',
    target: 'child-3',
    sourceSocket: 'child-2-out-0',
    targetSocket: 'child-3-in-0',
  },
  // Two edges, not one: a wire into the reroute and a wire out of it. The dot is the joint, and
  // it names no socket on either side.
  {
    id: 'group-edge-3',
    source: 'child-1',
    target: 'reroute-1',
    sourceSocket: 'child-1-out-0',
  },
  {
    id: 'group-edge-4',
    source: 'reroute-1',
    target: 'child-4',
    targetSocket: 'child-4-in-0',
  },
];

// Widget demo nodes (positioned far left, away from complex nodes)
const widgetDemoNodes: Entity[] = [
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
    outputs: [{ id: 'ws-out-0', name: 'Image', type: 'image' }],
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
function generateEntities(count: number): Entity[] {
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 300;

  const gridEntities = Array.from({ length: count }, (_, i) => {
    const pattern = socketPatterns[i % socketPatterns.length];

    const entity: Entity = {
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
      entity.color = nodeColors[(i / 10) % nodeColors.length];
    }

    return entity;
  });

  return [...groupingDemoNodes, ...widgetDemoNodes, ...gridEntities];
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
  // Start with grouping demo edges
  const edges: Edge[] = [...groupingDemoEdges];
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

type ClipboardApi = {
  copy: () => void;
  cut: () => void;
  paste: () => void;
};

/**
 * The clipboard lives on the flow's store, so this has to sit inside `<KookieFlow>`; the buttons
 * that drive it sit in the band outside. It hands its actions out through a ref and reports how
 * many entities are held, and registers the shortcuts.
 */
function ClipboardBridge({
  apiRef,
  preserveExternal,
  onSize,
}: {
  apiRef: React.RefObject<ClipboardApi | null>;
  preserveExternal: boolean;
  onSize: (size: number) => void;
}) {
  const store = useFlowStoreApi();
  const { copy, paste, cut } = useClipboard();

  useEffect(
    () =>
      store.subscribe(
        (state) => state.internalClipboard,
        (clipboard) => onSize(clipboard?.entities.length ?? 0)
      ),
    [store, onSize]
  );

  const doPaste = useCallback(
    () => paste({ preserveExternalConnections: preserveExternal }),
    [paste, preserveExternal]
  );

  useEffect(() => {
    apiRef.current = { copy, cut, paste: doPaste };
  }, [apiRef, copy, cut, doPaste]);

  useKeyboardShortcuts({
    bindings: {
      'mod+c': copy,
      'mod+v': doPaste,
      'mod+x': cut,
      'mod+a': () => store.getState().selectAll(),
      delete: () => store.getState().deleteSelected(),
      escape: () => store.getState().deselectAll(),
    },
  });

  return null;
}

/** Written straight to the element on an interval: a pan would re-render the page at frame rate. */
function ViewportReadout({ flowRef }: { flowRef: React.RefObject<KookieFlowInstance | null> }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      const viewport = flowRef.current?.getViewport();
      if (!viewport || !ref.current) return;
      ref.current.textContent = `x ${viewport.x.toFixed(0)} · y ${viewport.y.toFixed(0)} · ${(viewport.zoom * 100).toFixed(0)}%`;
    }, 100);
    return () => clearInterval(interval);
  }, [flowRef]);
  return <Code ref={ref}>—</Code>;
}

export default function DemoPage() {
  const nodeCount = 1000;
  const initialEntities = useMemo(() => generateEntities(nodeCount), [nodeCount]);
  const initialEdges = useMemo(() => generateEdges(nodeCount), [nodeCount]);
  const flowRef = useRef<KookieFlowInstance>(null);
  const clipboardRef = useRef<ClipboardApi | null>(null);
  const widgetReadoutRef = useRef<HTMLElement>(null);
  const [clipboardSize, setClipboardSize] = useState(0);
  const [preserveExternal, setPreserveExternal] = useState(true);

  // Use ref to accumulate changes without triggering re-renders
  const pendingValuesRef = useRef<Record<string, Record<string, unknown>>>({});
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect, addEntity, addEdge } = useGraph({
    initialEntities,
    initialEdges,
  });

  // The latest graph, readable from inside a timeout without re-creating the handler.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  /**
   * A widget change is ECHOED INTO THE GRAPH, not only into the readout.
   *
   * The value a widget shows lives on the entity (`data.values[socketId]`), and the library
   * paints what the person set only until this echo arrives — after that the entity is the
   * truth. The GL widgets keep no state of their own, and a real consumer writes the value back;
   * this is a real consumer.
   *
   * Debounced, because `applyEntityChanges` rebuilds the derived indexes and a slider emits on
   * every pointermove. The library bridges the gap by showing the in-flight value meanwhile. The
   * readout is written to the element, so a scrub does not re-render a thousand-node page.
   */
  const handleWidgetChange = useCallback(
    (nodeId: string, socketId: string, value: unknown) => {
      if (widgetReadoutRef.current) {
        widgetReadoutRef.current.textContent = `${nodeId}.${socketId.split('-').pop()} = ${JSON.stringify(value)}`;
      }
      (pendingValuesRef.current[nodeId] ??= {})[socketId] = value;

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        const pending = pendingValuesRef.current;

        // The store merges `data` one level deep, so each entity's whole `values` object goes
        // back — the untouched sockets included — or they would be dropped.
        const changes = entitiesRef.current.flatMap((entity) => {
          const touched = pending[entity.id];
          if (!touched) return [];
          const current = (entity.data as { values?: Record<string, unknown> }).values ?? {};
          return [
            {
              type: 'data' as const,
              id: entity.id,
              data: { values: { ...current, ...touched } },
            },
          ];
        });
        if (changes.length > 0) onEntitiesChange(changes);
        // Cleared once flushed. Held, this map only ever grows: every entity ever touched in the
        // session gets rewritten on every later flush.
        pendingValuesRef.current = {};
        debounceTimeoutRef.current = null;
      }, 150);
    },
    [onEntitiesChange]
  );

  // A pending flush outlives the component otherwise, and writes into a dead closure — the last
  // 150ms of anything the person typed, dropped without a sign.
  useEffect(
    () => () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    },
    []
  );

  // Phase 7E: Add node on edge drop — when a connection drag ends on empty canvas,
  // create a new node at the drop position and connect it to the source socket.
  const handleConnectEnd = useCallback(
    (_event: PointerEvent, state: ConnectionEndState) => {
      if (state.isValid) return; // Connection succeeded, nothing to do

      const id = `drop-node-${Date.now()}`;
      const { isInput } = state.source;

      // Create a new node with a matching socket
      const newEntity: Entity = {
        id,
        type: 'default',
        position: state.position,
        data: { label: 'New Entity' },
        inputs: isInput ? [] : [{ id: `${id}-in-0`, name: 'Input', type: 'any' }],
        outputs: isInput ? [{ id: `${id}-out-0`, name: 'Output', type: 'any' }] : [],
        color: 'cyan',
      };

      // Build the edge from source to new entity (or vice versa)
      const newEdge: Edge = isInput
        ? {
            id: `${id}-edge`,
            source: id,
            sourceSocket: `${id}-out-0`,
            target: state.source.entityId,
            targetSocket: state.source.socketId,
          }
        : {
            id: `${id}-edge`,
            source: state.source.entityId,
            sourceSocket: state.source.socketId,
            target: id,
            targetSocket: `${id}-in-0`,
          };

      addEntity(newEntity);
      addEdge(newEdge);
    },
    [addEntity, addEdge]
  );

  const fitSelection = useCallback(() => {
    const selected = flowRef.current?.getSelectedEntities().map((n) => n.id);
    if (selected && selected.length > 0) flowRef.current?.fitView({ entities: selected, padding: 100 });
  }, []);

  return (
    <DemoFrame
      title="Playground"
      actions={
        <>
          <ToolbarGroup>
            <ToolbarButton onClick={() => clipboardRef.current?.copy()}>Copy</ToolbarButton>
            <ToolbarButton onClick={() => clipboardRef.current?.cut()}>Cut</ToolbarButton>
            <ToolbarButton disabled={clipboardSize === 0} onClick={() => clipboardRef.current?.paste()}>
              Paste{clipboardSize > 0 ? ` ${clipboardSize}` : ''}
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarGroup>
            <ToolbarButton iconOnly aria-label="Zoom out" onClick={() => flowRef.current?.zoomOut()}>
              <MinusIcon />
            </ToolbarButton>
            <ToolbarButton iconOnly aria-label="Zoom in" onClick={() => flowRef.current?.zoomIn()}>
              <PlusIcon />
            </ToolbarButton>
            <ToolbarButton onClick={() => flowRef.current?.fitView()}>Fit</ToolbarButton>
            <ToolbarButton onClick={fitSelection}>Fit selection</ToolbarButton>
          </ToolbarGroup>
        </>
      }
      footer={
        <>
          <Flex gap="4" align="center">
            <Text size="2" emphasis="medium">
              {entities.length.toLocaleString()} entities · {edges.length.toLocaleString()} edges
            </Text>
            <ViewportReadout flowRef={flowRef} />
            <Code ref={widgetReadoutRef}>Change a widget</Code>
          </Flex>
          <label style={switchLabelStyle}>
            <Switch checked={preserveExternal} onCheckedChange={(checked) => setPreserveExternal(checked)} />
            <Text size="2">Paste keeps external connections</Text>
          </label>
        </>
      }
    >
      <KookieFlow
        ref={flowRef}
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        showGrid
        showMinimap
        minimapProps={{ zoomable: false }}
        showSocketLabels
        showEdgeLabels
        size="2"
        // No variant: v2's Card is "one treatment and no variants"; the default surface treatment
        // is the node look, and it is what studio renders.
        radius="medium"
        header="outside"
        accentHeader
        onWidgetChange={handleWidgetChange}
        // Per-node accent color support for widgets
      >
        <ClipboardBridge apiRef={clipboardRef} preserveExternal={preserveExternal} onSize={setClipboardSize} />
      </KookieFlow>
    </DemoFrame>
  );
}

const switchLabelStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' };
