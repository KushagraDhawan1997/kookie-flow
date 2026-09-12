'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button, Flex, Stack, Text } from '@kookie-ui/react';
import { KookieFlow, useGraph, type Edge, type Entity, type EntityTypeDefinition, type KookieFlowInstance, type OnEvaluate } from '@kushagradhawan/kookie-flow';

const float = (id: string, name: string) => ({ id, name, type: 'float', min: 0, max: 10, step: 1 });

const entityTypes: Record<string, EntityTypeDefinition> = {
  number: { type: 'number', label: 'Number', inputs: [float('value', 'Value')], outputs: [float('out', 'Out')] },
  add: { type: 'add', label: 'Add', inputs: [float('a', 'A'), float('b', 'B')], outputs: [float('sum', 'Sum')] },
  // Manual: a change upstream marks it stale, and it waits to be run.
  render: { type: 'render', label: 'Render', evaluation: 'manual', inputs: [float('in', 'In')], outputs: [float('out', 'Out')] },
};

const node = (id: string, type: string, x: number, y: number, value?: number): Entity =>
  ({ id, type, position: { x, y }, data: value === undefined ? {} : { values: { value } } });
const wire = (source: string, sourceSocket: string, target: string, targetSocket: string): Edge =>
  ({ id: `${source}-${target}`, source, sourceSocket, target, targetSocket });

const wait = (ms: number, signal: AbortSignal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
});

const onEvaluate: OnEvaluate = async (id, type, inputs, ctx) => {
  const n = (key: string) => Number(inputs[key] ?? 0);
  if (type === 'number') return { out: n('value') };
  if (type === 'add') return { sum: n('a') + n('b') };
  if (type === 'render') {
    for (let step = 1; step <= 20; step++) {
      await wait(100, ctx.signal); // a changed input rejects here, and the run is dropped
      ctx.progress(step / 20);
    }
    return { out: n('in') * 10 };
  }
};

export default function EvaluationExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities: [node('a', 'number', 0, 0, 2), node('b', 'number', 0, 160, 3), node('add', 'add', 300, 80), node('render', 'render', 600, 80)],
    initialEdges: [wire('a', 'out', 'add', 'a'), wire('b', 'out', 'add', 'b'), wire('add', 'sum', 'render', 'in')],
  });
  const flowRef = useRef<KookieFlowInstance>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef(0);

  // Once a frame, into the DOM rather than into state, so dragging a slider re-renders nothing here.
  const onStatusChange = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const flow = flowRef.current;
      if (!flow || !readoutRef.current) return;
      const [sum, out] = [flow.getSocketValue('add', 'sum'), flow.getSocketValue('render', 'out')];
      readoutRef.current.textContent = `Sum ${sum ?? '–'} · Render ${out ?? '–'} (${flow.getEvaluationStatus('render')})`;
    });
  }, []);

  useEffect(() => {
    flowRef.current?.fitView({ padding: 40, maxZoom: 1 });
    // Nothing runs on mount. Run the two inputs once: Add follows them, Render waits.
    flowRef.current?.evaluate('a');
    flowRef.current?.evaluate('b');
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <Stack gap="3">
      <Flex gap="3" align="center">
        <Button size="2" emphasis="loud" onClick={() => flowRef.current?.evaluate('render')}>Run Render</Button>
        <Text size="2" ref={readoutRef}>Sum – · Render –</Text>
      </Flex>
      <div style={{ width: '100%', height: 360 }}>
        <KookieFlow
          ref={flowRef}
          entities={entities}
          edges={edges}
          entityTypes={entityTypes}
          onEntitiesChange={onEntitiesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEvaluate={onEvaluate}
          onStatusChange={onStatusChange}
        />
      </div>
    </Stack>
  );
}
