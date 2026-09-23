import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@kookie-ui/react';
import { KookieFlow } from '../../src/components/kookie-flow';
import { useFlowStoreApi } from '../../src/components/context';
import type { Entity, Edge, KookieFlowInstance } from '../../src/types';
let currentStore: ReturnType<typeof useFlowStoreApi>;
function Probe() {
  currentStore = useFlowStoreApi();
  return null;
}
const edges: Edge[] = [
  { id: 'ab', source: 'a', target: 'b', sourceSocket: 'out', targetSocket: 'in' },
];
const initial: Entity[] = [
  {
    id: 'a',
    type: 'default',
    data: { label: 'Source' },
    position: { x: 50, y: 350 },
    outputs: [{ id: 'out', name: 'Out', type: 'number' }],
  },
  {
    id: 'b',
    type: 'default',
    data: { label: 'Target' },
    position: { x: 350, y: 350 },
    inputs: [{ id: 'in', name: 'In', type: 'number' }],
  },
];
function App() {
  const ref = useRef<KookieFlowInstance>(null);
  const [entities, setEntities] = useState(initial);
  const [result, setResult] = useState('Ready');
  const report = () =>
    setResult(
      JSON.stringify(
        {
          inputType: currentStore.getState().entityMap.get('b')?.inputs?.[0].type,
          edges: ref.current?.getEdges(),
          viewport: ref.current?.getViewport(),
        },
        null,
        2
      )
    );
  return (
    <Theme>
      <div style={{ position: 'fixed', inset: 0 }}>
        <KookieFlow
          ref={ref}
          entities={entities}
          edges={edges}
          minZoom={0.5}
          maxZoom={1}
          showMinimap={false}
        >
          <Probe />
        </KookieFlow>
      </div>
      <section
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          zIndex: 10000,
          background: 'white',
          color: 'black',
          padding: 12,
        }}
      >
        <button onClick={report}>Read state</button>
        <button
          onClick={() =>
            setEntities((prev) =>
              prev.map((e) =>
                e.id === 'b' ? { ...e, inputs: [{ id: 'in', name: 'In', type: 'string' }] } : e
              )
            )
          }
        >
          Change target to string
        </button>
        <button
          onClick={() => {
            ref.current?.zoomIn(5);
            report();
          }}
        >
          Zoom in past maximum
        </button>
        <button
          onClick={() => {
            ref.current?.zoomOut(5);
            report();
          }}
        >
          Zoom out past minimum
        </button>
        <pre id="props-result">{result}</pre>
      </section>
    </Theme>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
