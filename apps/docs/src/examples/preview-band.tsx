'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button, Flex, Stack, Text } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Entity,
  type EntityTypeDefinition,
  type KookieFlowInstance,
  type OnEvaluate,
} from '@kushagradhawan/kookie-flow';

/**
 * Three nodes, three kinds of band. Each names one of its own output sockets, and the canvas
 * draws whatever value is sitting on it: a picture, a clip, or a model.
 */
const entityTypes: Record<string, EntityTypeDefinition> = {
  'ai/generate': {
    type: 'ai/generate',
    label: 'Generate',
    defaultWidth: 260,
    // Manual: it waits to be asked rather than running when its inputs change.
    evaluation: 'manual',
    inputs: [{ id: 'prompt', name: 'Prompt', type: 'string' }],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    preview: { socket: 'image', height: 150, fit: 'cover' },
  },
  'media/clip': {
    type: 'media/clip',
    label: 'Clip',
    defaultWidth: 260,
    outputs: [{ id: 'video', name: 'Video', type: 'video' }],
    preview: { socket: 'video', height: 150, fit: 'cover' },
  },
  'media/model': {
    type: 'media/model',
    label: 'Model',
    defaultWidth: 260,
    outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
    preview: { socket: 'mesh', height: 150, fit: 'contain' },
  },
};

/**
 * `video` is not one of the built-in socket types, so without this the Clip node's socket would
 * draw in the grey of `any`. Your entries are merged over the defaults.
 */
const socketTypes = {
  video: { name: 'Video', color: '--purple-10' },
};

const initialEntities: Entity[] = [
  { id: 'generate', type: 'ai/generate', position: { x: 0, y: 0 }, data: {} },
  { id: 'clip', type: 'media/clip', position: { x: 300, y: 0 }, data: {} },
  { id: 'model', type: 'media/model', position: { x: 600, y: 0 }, data: {} },
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });

/**
 * The application's logic. A real image model would be a fetch; this waits, reports progress, and
 * answers with a URL — which is all the band ever needs.
 */
const onEvaluate: OnEvaluate = async (id, type, inputs, ctx) => {
  if (type !== 'ai/generate') return;
  for (let step = 1; step <= 20; step++) {
    await sleep(90, ctx.signal);
    ctx.progress(step / 20);
  }
  return { image: '/preview-render.jpg' };
};

export default function PreviewBandExample() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities });
  const flowRef = useRef<KookieFlowInstance>(null);

  const generate = useCallback(() => flowRef.current?.evaluate('generate'), []);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    // The clip and the model never evaluate: a value put on the socket fills the band just as a
    // computed one does.
    flow.setSocketValue('clip', 'video', '/video.mp4');
    flow.setSocketValue('model', 'mesh', '/model.glb');
    flow.fitView({ padding: 40, maxZoom: 1 });
  }, []);

  return (
    <Stack gap="3">
      <Flex gap="3" align="center">
        <Button size="2" emphasis="loud" onClick={generate}>Generate</Button>
        <Text size="2">The picture lands in the node's own band when the run finishes.</Text>
      </Flex>
      <div style={{ width: '100%', height: 400 }}>
        <KookieFlow
          ref={flowRef}
          entities={entities}
          edges={edges}
          entityTypes={entityTypes}
          socketTypes={socketTypes}
          onEntitiesChange={onEntitiesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEvaluate={onEvaluate}
        />
      </div>
    </Stack>
  );
}
