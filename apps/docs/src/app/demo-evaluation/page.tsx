'use client';

/**
 * The data core, end to end, on a five-node pipeline.
 *
 *   Number ──▶ Add ──▶ Multiply ──▶ Generate [manual] ──▶ Upscale
 *
 * Drag the slider and watch Add and Multiply re-run. Generate is a gate: it goes stale and waits
 * for Run. Run it and it reports progress along its bottom edge for a second, then Upscale runs
 * behind it. Tick "Generate fails" to see an error land on the node with its message underneath,
 * and the chain hold there rather than run Upscale on stale output.
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

function node(id: string, x: number, label: string, type: string, inputs: Entity['inputs'], outputs: Entity['outputs'], values?: Record<string, unknown>): Entity {
  return {
    id,
    type,
    position: { x, y: Y },
    width: 240,
    data: values ? { label, values } : { label },
    inputs,
    outputs,
  };
}

const initialEntities: Entity[] = [
  node('number', X[0], 'Number', 'number', [{ id: 'value', name: 'Value', type: 'float', min: 0, max: 10, step: 0.1 }], [{ id: 'out', name: 'Out', type: 'float' }], { value: 2 }),
  node('add', X[1], 'Add', 'math/add', [{ id: 'a', name: 'A', type: 'float' }, { id: 'b', name: 'B', type: 'float', min: 0, max: 10, step: 0.1 }], [{ id: 'sum', name: 'Sum', type: 'float' }], { b: 3 }),
  node('multiply', X[2], 'Multiply', 'math/multiply', [{ id: 'a', name: 'A', type: 'float' }, { id: 'by', name: 'By', type: 'float', min: 0, max: 10, step: 0.1 }], [{ id: 'product', name: 'Product', type: 'float' }], { by: 2 }),
  node('generate', X[3], 'Generate', 'ai/generate', [{ id: 'seed', name: 'Seed', type: 'float' }], [{ id: 'image', name: 'Image', type: 'image' }]),
  node('upscale', X[4], 'Upscale', 'image/upscale', [{ id: 'image', name: 'Image', type: 'image' }], [{ id: 'image', name: 'Image', type: 'image' }]),
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'number', sourceSocket: 'out', target: 'add', targetSocket: 'a' },
  { id: 'e2', source: 'add', sourceSocket: 'sum', target: 'multiply', targetSocket: 'a' },
  { id: 'e3', source: 'multiply', sourceSocket: 'product', target: 'generate', targetSocket: 'seed' },
  { id: 'e4', source: 'generate', sourceSocket: 'image', target: 'upscale', targetSocket: 'image' },
];

/** The one decision the app makes about evaluation: which types wait to be asked. */
const entityTypes: Record<string, EntityTypeDefinition> = {
  'ai/generate': { type: 'ai/generate', evaluation: 'manual' },
};

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
        // A pretend model: a second of work, progress reported in tenths, honouring the signal.
        for (let i = 1; i <= 10; i++) {
          await sleep(100, ctx.signal);
          ctx.progress(i / 10);
        }
        if (failRef.current) throw new Error(`seed ${num(inputs.seed)} was refused by the model`);
        return { image: `image(seed=${num(inputs.seed)})` };
      }
      case 'image/upscale':
        await sleep(300, ctx.signal);
        return { image: `${String(inputs.image)} @2x` };
      default:
        throw new Error(`no evaluator for ${type} (${id})`);
    }
  }, []);

  const onStatusChange = useCallback((id: string, status: EvaluationStatus, message?: string) => {
    setLog((prev) => [{ id, status, message, at: Date.now() }, ...prev].slice(0, 12));
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
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Evaluation</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button style={buttonStyle} onClick={() => flowRef.current?.evaluate('generate')}>Run Generate</button>
            <button style={buttonStyle} onClick={() => flowRef.current?.evaluateDirty()}>Run all stale</button>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={failGenerate} onChange={(e) => setFailGenerate(e.target.checked)} />
            Generate fails
          </label>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }}>
            {Object.entries(values).map(([k, v]) => (
              <div key={k}><span style={{ opacity: 0.6 }}>{k}</span> = {v === undefined ? '—' : String(v)}</div>
            ))}
          </div>
          <div style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>
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
  // Bottom right: the pipeline is one row across the top after fitView, and a panel at either
  // top corner sat on an end of it.
  bottom: 16,
  right: 16,
  zIndex: 10,
  width: 320,
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
