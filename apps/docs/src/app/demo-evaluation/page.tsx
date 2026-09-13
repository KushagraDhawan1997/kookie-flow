'use client';

/**
 * The data core, end to end, on a five-node pipeline.
 *
 *   Number ──▶ Add ──▶ Multiply ──▶ Generate [manual] ──▶ Upscale
 *
 * Drag the slider and watch Add and Multiply re-run. Generate is a gate: it goes stale and waits
 * for Run. Run it and its outline sweeps for twenty seconds — the length of a real model call, so
 * the ring is worth watching and cancelling it is worth trying — then Upscale runs behind it. Move
 * the slider mid-run to see the run abandoned and started again. Tick "Generate fails" to see an
 * error land on the node with its message underneath, and the chain hold there rather than run
 * Upscale on stale output.
 *
 * The library never learns what any of these nodes compute. `onEvaluate` below is the whole of
 * the application's logic; everything else — what is stale, what runs, in what order, what is
 * cancelled, what is drawn — is the engine's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Theme } from '@kookie-ui/react';
import {
  KookieFlow,
  useGraph,
  type Entity,
  type Edge,
  type EntityTypeDefinition,
  type EvaluationStatus,
  type KookieFlowInstance,
  type OnEvaluate,
} from '@kushagradhawan/kookie-flow';

const X = [40, 340, 640, 940, 1240];
const Y = 140;

/**
 * Every node's shape, written once.
 *
 * The nodes below say what they are and where they sit; the sockets, the header text and the
 * width come from here. `evaluation: 'manual'` is the one decision about running: Generate waits
 * to be asked, everything else answers a change on its own.
 */
const entityTypes: Record<string, EntityTypeDefinition> = {
  number: {
    type: 'number',
    label: 'Number',
    defaultWidth: 240,
    inputs: [{ id: 'value', name: 'Value', type: 'float', min: 0, max: 10, step: 0.1 }],
    outputs: [{ id: 'out', name: 'Out', type: 'float' }],
  },
  'math/add': {
    type: 'math/add',
    label: 'Add',
    defaultWidth: 240,
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float', min: 0, max: 10, step: 0.1 },
    ],
    outputs: [{ id: 'sum', name: 'Sum', type: 'float' }],
  },
  'math/multiply': {
    type: 'math/multiply',
    label: 'Multiply',
    defaultWidth: 240,
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'by', name: 'By', type: 'float', min: 0, max: 10, step: 0.1 },
    ],
    outputs: [{ id: 'product', name: 'Product', type: 'float' }],
  },
  'ai/generate': {
    type: 'ai/generate',
    label: 'Generate',
    defaultWidth: 240,
    evaluation: 'manual',
    inputs: [{ id: 'seed', name: 'Seed', type: 'float' }],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    // The picture the run returns, drawn in the node's own body.
    preview: { socket: 'image', height: 150, fit: 'cover', position: 'top' },
  },
  'image/upscale': {
    type: 'image/upscale',
    label: 'Upscale',
    defaultWidth: 240,
    inputs: [{ id: 'image', name: 'Image', type: 'image' }],
    outputs: [{ id: 'image', name: 'Image', type: 'image' }],
    preview: { socket: 'image', height: 150, fit: 'cover', position: 'top' },
  },
};

function node(id: string, x: number, type: string, values?: Record<string, unknown>): Entity {
  return { id, type, position: { x, y: Y }, data: values ? { values } : {} };
}

const initialEntities: Entity[] = [
  node('number', X[0], 'number', { value: 2 }),
  node('add', X[1], 'math/add', { b: 3 }),
  node('multiply', X[2], 'math/multiply', { by: 2 }),
  node('generate', X[3], 'ai/generate'),
  node('upscale', X[4], 'image/upscale'),
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'number', sourceSocket: 'out', target: 'add', targetSocket: 'a' },
  { id: 'e2', source: 'add', sourceSocket: 'sum', target: 'multiply', targetSocket: 'a' },
  { id: 'e3', source: 'multiply', sourceSocket: 'product', target: 'generate', targetSocket: 'seed' },
  { id: 'e4', source: 'generate', sourceSocket: 'image', target: 'upscale', targetSocket: 'image' },
];

/** What a model call actually costs, so the demo shows the wait rather than skipping it. */
const GENERATE_MS = 20_000;
const GENERATE_TICKS = 200;

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });

type LogRow = { id: string; status: EvaluationStatus; message?: string; at: number };

export default function DemoEvaluationPage() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({ initialEntities, initialEdges });
  const flowRef = useRef<KookieFlowInstance>(null);
  const [failGenerate, setFailGenerate] = useState(false);
  const failRef = useRef(false);
  failRef.current = failGenerate;
  const [log, setLog] = useState<LogRow[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});

  /**
   * The application's logic, all of it. Stable across renders on purpose: the engine keeps its
   * records across handler changes, but a new function per render is a new dependency for the
   * effect that hands it over, and there is no reason to hand it over sixty times a second.
   */
  const onEvaluate = useCallback<OnEvaluate>(async (id, type, inputs, ctx) => {
    switch (type) {
      case 'number':
        return { out: num(inputs.value) };
      case 'math/add':
        return { sum: num(inputs.a) + num(inputs.b) };
      case 'math/multiply':
        return { product: num(inputs.a) * num(inputs.by) };
      case 'ai/generate': {
        // A pretend model at the length of a real one: twenty seconds, reported every tenth of a
        // second, honouring the signal so a changed input abandons the run rather than finishing it.
        for (let i = 1; i <= GENERATE_TICKS; i++) {
          await sleep(GENERATE_MS / GENERATE_TICKS, ctx.signal);
          ctx.progress(i / GENERATE_TICKS);
        }
        if (failRef.current) throw new Error(`seed ${num(inputs.seed)} was refused by the model`);
        // A URL, which is what the band draws. A real model call returns one of these too.
        return { image: '/preview-render.jpg' };
      }
      case 'image/upscale':
        await sleep(300, ctx.signal);
        // Standing in for the upscaled copy: a second picture, so the two bands differ.
        return { image: '/preview-source.jpg' };
      default:
        throw new Error(`no evaluator for ${type} (${id})`);
    }
  }, []);

  const onStatusChange = useCallback((id: string, status: EvaluationStatus, message?: string) => {
    setLog((prev) => [{ id, status, message, at: Date.now() }, ...prev].slice(0, 6));
    if (status === 'success' || status === 'idle') {
      const flow = flowRef.current;
      if (!flow) return;
      setValues({
        'add.sum': flow.getSocketValue('add', 'sum'),
        'multiply.product': flow.getSocketValue('multiply', 'product'),
        'generate.image': flow.getSocketValue('generate', 'image'),
        'upscale.image': flow.getSocketValue('upscale', 'image'),
      });
    }
  }, []);

  // Fit the pipeline to whatever width the page has, then run the reactive part once so the
  // board opens with values rather than stale rings.
  useEffect(() => {
    flowRef.current?.fitView();
    flowRef.current?.evaluateAll();
  }, []);

  return (
    <Theme>
      <main style={{ width: '100%', height: '100vh', position: 'relative' }}>
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
          onWidgetChange={(entityId, socketId, value) => {
            onEntitiesChange([
              {
                type: 'data',
                id: entityId,
                data: (() => {
                  const e = entities.find((x) => x.id === entityId);
                  const prev = (e?.data as { values?: Record<string, unknown> } | undefined)?.values ?? {};
                  return { ...(e?.data ?? {}), values: { ...prev, [socketId]: value } };
                })(),
              },
            ]);
          }}
          showWidgets
          showSocketLabels
          showGrid
          header="inside"
          size="2"
        />

        <div style={panelStyle}>
          <div style={{ minWidth: 180 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Evaluation</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button style={buttonStyle} onClick={() => flowRef.current?.evaluate('generate')}>Run Generate</button>
              <button style={buttonStyle} onClick={() => flowRef.current?.evaluateDirty()}>Run all stale</button>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={failGenerate} onChange={(e) => setFailGenerate(e.target.checked)} />
              Generate fails
            </label>
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5, minWidth: 260 }}>
            {Object.entries(values).map(([k, v]) => (
              <div key={k}><span style={{ opacity: 0.6 }}>{k}</span> = {v === undefined ? '—' : String(v)}</div>
            ))}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12, lineHeight: 1.5, flex: 1 }}>
            {log.map((r) => (
              <div key={r.at + r.id + r.status}>
                {r.id} → <b>{r.status}</b>{r.message ? `: ${r.message}` : ''}
              </div>
            ))}
          </div>
        </div>
      </main>
    </Theme>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  // A strip along the bottom: the pipeline is one row across the middle after fitView, and a
  // panel in any corner tall enough to hold the log sat on an end of it.
  left: 16,
  right: 16,
  bottom: 16,
  zIndex: 10,
  display: 'flex',
  gap: 24,
  alignItems: 'flex-start',
  background: 'rgba(0,0,0,0.85)',
  color: '#fff',
  padding: '12px 16px',
  borderRadius: 8,
  fontSize: 13,
  pointerEvents: 'auto',
};

const buttonStyle: React.CSSProperties = {
  background: '#3b5bdb',
  color: '#fff',
  border: 0,
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 13,
};
