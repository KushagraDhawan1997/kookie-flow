'use client';

import { useCallback, useEffect, useRef } from 'react';
import { KookieFlow, useGraph, type Entity, type KookieFlowInstance } from '@kushagradhawan/kookie-flow';
import { Code, Text } from '@kushagradhawan/kookie-ui-react';

import { DemoFrame } from '../demo-frame';

/**
 * Every built-in widget, on nodes shaped like the ones a real graph has.
 *
 * Widget types come from the socket types where the default table has one (`vec3`, `seed`,
 * `float`, …) and are named on the socket where it does not (`switch`, `segmented`).
 */
const initialEntities: Entity[] = [
  {
    id: 'generate',
    type: 'image/generate',
    position: { x: 0, y: 0 },
    width: 340,
    data: {
      label: 'Generate image',
      values: { fit: 'Fill', size: [1024, 768], steps: 30, guidance: 0.45, seed: 42 },
    },
    inputs: [
      {
        id: 'prompt',
        name: 'Prompt',
        type: 'string',
        layout: 'stacked',
        widget: 'textarea',
        rows: 3,
        placeholder: 'A lighthouse in fog',
      },
      { id: 'fit', name: 'Fit', type: 'enum', widget: 'segmented', options: ['Fit', 'Fill', 'Crop'] },
      { id: 'size', name: 'Size', type: 'vec2', step: 1, min: 64, max: 4096 },
      { id: 'steps', name: 'Steps', type: 'int' },
      { id: 'guidance', name: 'Guidance', type: 'float' },
      { id: 'seed', name: 'Seed', type: 'seed', max: 999999 },
    ],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
  {
    id: 'transform',
    type: 'scene/transform',
    position: { x: 400, y: 0 },
    // Wider than its neighbours: four numbers in one field need the room.
    width: 420,
    data: {
      label: 'Transform',
      values: { position: [0, 1.5, -2], rotation: [0, 45, 0], scale: [1, 1, 1], pivot: [0.5, 0.5], tint: [1, 1, 1, 1] },
    },
    inputs: [
      { id: 'position', name: 'Position', type: 'vec3', step: 0.1 },
      { id: 'rotation', name: 'Rotation', type: 'vec3', step: 1, min: -360, max: 360 },
      { id: 'scale', name: 'Scale', type: 'vec3', step: 0.01, min: 0 },
      { id: 'pivot', name: 'Pivot', type: 'vec2', step: 0.01, min: 0, max: 1 },
      { id: 'tint', name: 'RGBA', type: 'vec4', step: 0.01, min: 0, max: 1 },
    ],
    outputs: [{ id: 'out', name: 'Mesh', type: 'mesh' }],
  },
  {
    // The same controls with `layout: 'stacked'`: each name on its own line, the control under it
    // at the body's full width — for narrow nodes, or vectors that need the room.
    id: 'transform-stacked',
    type: 'scene/transform',
    position: { x: 1320, y: 0 },
    width: 300,
    data: {
      label: 'Transform (stacked)',
      values: { position: [0, 1.5, -2], rotation: [0, 45, 0], scale: [1, 1, 1], pivot: [0.5, 0.5], blend: 'Add' },
    },
    inputs: [
      { id: 'position', name: 'Position', type: 'vec3', step: 0.1, layout: 'stacked' },
      { id: 'rotation', name: 'Rotation', type: 'vec3', step: 1, min: -360, max: 360, layout: 'stacked' },
      { id: 'scale', name: 'Scale', type: 'vec3', step: 0.01, min: 0, layout: 'stacked' },
      { id: 'pivot', name: 'Pivot', type: 'vec2', step: 0.01, min: 0, max: 1, layout: 'stacked' },
      {
        id: 'blend',
        name: 'Blend',
        type: 'enum',
        widget: 'segmented',
        options: ['Normal', 'Add', 'Multiply'],
        layout: 'stacked',
      },
    ],
    outputs: [{ id: 'out', name: 'Mesh', type: 'mesh' }],
  },
  {
    id: 'output',
    type: 'image/output',
    position: { x: 880, y: 0 },
    width: 340,
    data: {
      label: 'Output',
      values: { live: true, preview: false, blend: 'Normal', format: 'PNG', background: '#3e63dd', name: 'render-01' },
    },
    inputs: [
      { id: 'live', name: 'Live', type: 'boolean', widget: 'switch' },
      { id: 'preview', name: 'Preview', type: 'boolean' },
      { id: 'blend', name: 'Blend', type: 'enum', widget: 'segmented', options: ['Normal', 'Add', 'Multiply'] },
      { id: 'format', name: 'Format', type: 'enum', options: ['PNG', 'JPEG', 'WebP', 'AVIF'] },
      { id: 'background', name: 'Background', type: 'color' },
      { id: 'name', name: 'Name', type: 'string' },
    ],
    outputs: [{ id: 'file', name: 'File', type: 'any' }],
  },
];

export default function ControlsPage() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities });
  const flowRef = useRef<KookieFlowInstance>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    flowRef.current?.fitView({ padding: 80, maxZoom: 1 });
  }, []);

  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const pendingRef = useRef<Record<string, Record<string, unknown>>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  /**
   * Echoed into the graph, debounced, as /demo does: the value lives on the entity, and the
   * library shows the in-flight value until the echo lands. The readout is written straight to
   * the element — a vector scrub emits on every pointermove, and React state here would re-render
   * the canvas at that rate.
   */
  const handleWidgetChange = useCallback(
    (entityId: string, socketId: string, value: unknown) => {
      if (readoutRef.current) readoutRef.current.textContent = `${entityId}.${socketId} = ${JSON.stringify(value)}`;
      (pendingRef.current[entityId] ??= {})[socketId] = value;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = {};
        timeoutRef.current = null;
        const changes = entitiesRef.current.flatMap((entity) => {
          const touched = pending[entity.id];
          if (!touched) return [];
          const current = (entity.data as { values?: Record<string, unknown> }).values ?? {};
          return [{ type: 'data' as const, id: entity.id, data: { values: { ...current, ...touched } } }];
        });
        if (changes.length > 0) onEntitiesChange(changes);
      }, 150);
    },
    [onEntitiesChange]
  );

  return (
    <DemoFrame
      title="Controls"
      footer={
        <>
          <Text size="2" emphasis="medium">
            Drag a vector number to scrub it, or click to type. The die rolls a seed.
          </Text>
          <Code ref={readoutRef}>Change a control</Code>
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
        onWidgetChange={handleWidgetChange}
        showGrid
        size="2"
        radius="medium"
        header="inside"
        accentHeader
      />
    </DemoFrame>
  );
}
