'use client';

import { useEffect, useRef } from 'react';
import {
  KookieFlow,
  useGraph,
  type Edge,
  type Entity,
  type KookieFlowInstance,
} from '@kushagradhawan/kookie-flow-react';
import { skin } from '@kushagradhawan/kookie-flow-skin';

// The front page's hero: a Generate node with most of the built-in widgets, wired into the
// picture it made. The picture is an image entity with an input socket and no node around it.
// The same figure is on kushagradhawan.com's Kookie Flow page.
const initialEntities: Entity[] = [
  {
    id: 'generate',
    type: 'ai/generate',
    position: { x: 0, y: 0 },
    width: 320,
    data: {
      label: 'Generate',
      values: {
        prompt:
          'Thick strokes of lavender, cream and pale gold acrylic paint, laid on with a palette knife. Soft daylight, raised ridges and texture, pastel colours, a close crop of the canvas.',
        model: 'Flux 1.1 Pro',
        aspect: '4:3',
        steps: 28,
        guidance: 0.65,
        upscale: true,
        tint: '#b8a9e3',
        seed: 4182,
      },
    },
    inputs: [
      { id: 'prompt', name: 'Prompt', type: 'string', layout: 'stacked', widget: 'textarea', rows: 3 },
      { id: 'model', name: 'Model', type: 'enum', options: ['Flux 1.1 Pro', 'Imagen 4', 'Ideogram 3'] },
      { id: 'aspect', name: 'Aspect', type: 'enum', widget: 'segmented', options: ['1:1', '4:3', '16:9'] },
      { id: 'steps', name: 'Steps', type: 'int' },
      { id: 'guidance', name: 'Guidance', type: 'float' },
      { id: 'upscale', name: 'Upscale', type: 'boolean', widget: 'switch' },
      { id: 'tint', name: 'Tint', type: 'color' },
      { id: 'seed', name: 'Seed', type: 'seed' },
    ],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
  },
  {
    id: 'painting',
    type: 'image',
    position: { x: 480, y: 87 },
    width: 440,
    height: 307,
    data: { src: '/hero-painting.jpg', objectFit: 'cover', controls: false },
    // No name: a label would sit on the picture.
    inputs: [{ id: 'in', name: '', type: 'image', position: 0.5 }],
  },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'generate', sourceSocket: 'image', target: 'painting', targetSocket: 'in' },
];

export function Hero() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
    initialEdges,
  });
  const flowRef = useRef<KookieFlowInstance>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Frame the graph on the next frame, once the canvas has its size. A wide canvas fits the
  // pair, with padding that clears the floating header. A narrow one would shrink the node until
  // Flow hides its widget values, so it zooms in on Generate and lets the picture run off the
  // right edge (Kushagra, 2026-10-21).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const flow = flowRef.current;
      const box = boxRef.current;
      if (!flow || !box) return;
      const { clientWidth: width, clientHeight: height } = box;
      // Generate's top-left corner lands 40px in from the left, so its input sockets clear the
      // edge and line up with the text below, and 72px down, under the header.
      if (width < 640) flow.setCenter((width / 2 - 40) / 0.9, (height / 2 - 72) / 0.9, { zoom: 0.9 });
      else flow.fitView({ padding: 72, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={boxRef} style={{ width: '100%', height: 'clamp(440px, 45vw, 560px)' }}>
      <KookieFlow
        skin={skin}
        ref={flowRef}
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        showWidgets
        showSocketLabels
        header="inside"
        size="2"
      />
    </div>
  );
}
