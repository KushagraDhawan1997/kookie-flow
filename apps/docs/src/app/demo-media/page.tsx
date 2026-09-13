'use client';

/**
 * Media, and the controls it carries, on one full-screen board.
 *
 *   Row 1 — media entities:  Image · Video · Model · Video with `controls: false`
 *   Row 2 — media in nodes:  Generate [manual] · Clip · Model · Photo
 *
 * Hover any picture, clip or model. Every one shows the glass expand button in its top-right corner;
 * a clip also shows its play bar, and a model shows its grip. Drag a model to turn it — on an entity
 * the grip moves it, in a node the rest of the card does. The expand button opens the viewer.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Theme } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type Entity,
  type EntityTypeDefinition,
  type KookieFlowInstance,
  type OnEvaluate,
} from '@kushagradhawan/kookie-flow';

const ROW_MEDIA = 0;
const ROW_NODES = 360;

const entityTypes: Record<string, EntityTypeDefinition> = {
  'ai/generate': {
    type: 'ai/generate',
    label: 'Generate image',
    defaultWidth: 300,
    evaluation: 'manual',
    inputs: [{ id: 'prompt', name: 'Prompt', type: 'string' }],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    preview: { socket: 'image', height: 180, fit: 'cover', position: 'top' },
  },
  'media/clip': {
    type: 'media/clip',
    label: 'Clip',
    defaultWidth: 300,
    outputs: [{ id: 'video', name: 'Video', type: 'video' }],
    preview: { socket: 'video', height: 180, fit: 'cover', position: 'top' },
  },
  'media/model': {
    type: 'media/model',
    label: 'Model',
    defaultWidth: 300,
    outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
    preview: { socket: 'mesh', height: 220, fit: 'contain', position: 'top' },
  },
  'media/photo': {
    type: 'media/photo',
    label: 'Photo',
    defaultWidth: 300,
    inputs: [{ id: 'in', name: 'Image', type: 'image' }],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    preview: { socket: 'image', height: 180, fit: 'cover', position: 'top' },
  },
};

const socketTypes = {
  video: { name: 'Video', color: '--purple-10' },
};

const initialEntities: Entity[] = [
  {
    id: 'image', type: 'image', position: { x: 0, y: ROW_MEDIA }, width: 320, height: 214,
    data: { src: '/image-1.jpg', objectFit: 'cover' },
  },
  {
    id: 'video', type: 'video', position: { x: 360, y: ROW_MEDIA }, width: 400, height: 225,
    data: { src: '/video.mp4', autoplay: true, objectFit: 'cover' },
  },
  {
    id: 'model', type: 'mesh', position: { x: 800, y: ROW_MEDIA }, width: 280, height: 280,
    data: { src: '/model.glb' },
  },
  {
    id: 'decoration', type: 'video', position: { x: 1120, y: ROW_MEDIA }, width: 320, height: 180,
    data: { src: '/video.mp4', autoplay: true, objectFit: 'cover', controls: false },
  },
  { id: 'generate', type: 'ai/generate', position: { x: 0, y: ROW_NODES }, data: {} },
  { id: 'clip', type: 'media/clip', position: { x: 360, y: ROW_NODES }, data: {} },
  { id: 'mesh-node', type: 'media/model', position: { x: 720, y: ROW_NODES }, data: {} },
  { id: 'photo', type: 'media/photo', position: { x: 1080, y: ROW_NODES }, data: {} },
];

const initialEdges: Edge[] = [
  { id: 'generate-photo', source: 'generate', sourceSocket: 'image', target: 'photo', targetSocket: 'in' },
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });

/** Generate waits and reports progress, then answers with a picture; Photo passes it on. */
const onEvaluate: OnEvaluate = async (_id, type, inputs, ctx) => {
  if (type === 'ai/generate') {
    for (let step = 1; step <= 20; step++) {
      await sleep(90, ctx.signal);
      ctx.progress(step / 20);
    }
    return { image: '/preview-render.jpg' };
  }
  if (type === 'media/photo') return { image: inputs.in ?? '/image-3.jpg' };
  return undefined;
};

export default function MediaDemoPage() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges,
  });
  const flowRef = useRef<KookieFlowInstance>(null);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    // Values placed straight on the sockets: these nodes never evaluate.
    flow.setSocketValue('clip', 'video', '/video.mp4');
    flow.setSocketValue('mesh-node', 'mesh', '/model.glb');
    flow.setSocketValue('generate', 'image', '/image-2.jpg');
    flow.evaluate('photo');
    flow.fitView({ padding: 80 });
  }, []);

  const generate = useCallback(() => flowRef.current?.evaluate('generate'), []);

  return (
    <Theme>
      <main style={{ width: '100%', height: '100vh', position: 'relative' }}>
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
          showSocketLabels
          showGrid
          header="inside"
        />

        <div style={panelStyle}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Media controls</div>
          <div style={{ opacity: 0.8, lineHeight: 1.5, marginBottom: 10 }}>
            Hover a picture, clip or model. The corner button opens the viewer. Clips have a play
            bar. Drag a model to turn it. The last clip on the top row has its controls turned off.
          </div>
          <button style={buttonStyle} onClick={generate}>Run Generate</button>
        </div>
      </main>
    </Theme>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 16,
  zIndex: 10,
  maxWidth: 320,
  padding: 14,
  borderRadius: 12,
  background: 'rgba(0,0,0,0.85)',
  color: '#fff',
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  cursor: 'pointer',
};
