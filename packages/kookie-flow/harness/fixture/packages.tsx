import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@kushagradhawan/kookie-ui-react';
import { KookieFlow, useGraph, useTheme, type Entity } from '@kushagradhawan/kookie-flow-react';

function notes(count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 'note-' + i,
    type: 'comment',
    position: { x: 35 + (i % 10) * 210, y: 50 + Math.floor(i / 10) * 145 },
    width: 180,
    height: 110,
    data: { content: 'GPU note ' + i, color: i % 2 ? 'green' : 'yellow' },
  }));
}
function ReadTheme({ name }: { name: string }) {
  const tokens = useTheme();
  return (
    <output
      style={{
        position: 'absolute',
        top: 8,
        left: 12,
        color: tokens.appearance === 'dark' ? '#fff' : '#111',
      }}
    >
      {name}: {tokens.appearance}
    </output>
  );
}
function Editor({ name }: { name: string }) {
  const graph = useGraph({ initialEntities: notes(2), initialEdges: [] });
  return (
    <section style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button onClick={() => graph.setEntities(notes(10000))}>{name}: 10,000 notes</button>
        <button onClick={() => graph.setEntities(notes(2))}>{name}: reset</button>
        <button
          onClick={() =>
            graph.setEntities((es) =>
              es.map((e) =>
                e.id === 'note-0'
                  ? { ...e, data: { content: 'Edited on the GPU', color: 'blue', fontSize: 22 } }
                  : e
              )
            )
          }
        >
          {name}: edit note
        </button>
        <output>
          {name} nodes: {graph.entities.length}
        </output>
      </nav>
      <div style={{ flex: 1, minHeight: 0 }}>
        <KookieFlow
          entities={graph.entities}
          edges={graph.edges}
          onEntitiesChange={graph.onEntitiesChange}
          onEdgesChange={graph.onEdgesChange}
          ariaLabel={name + ' graph'}
        >
          <ReadTheme name={name} />
        </KookieFlow>
      </div>
    </section>
  );
}
function App() {
  const [dark, setDark] = useState(false);
  return (
    <div
      data-appearance={dark ? 'dark' : 'light'}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <header style={{ padding: 12, background: '#eee', color: '#111' }}>
        <button onClick={() => setDark((d) => !d)}>Toggle inherited appearance</button>
        <span style={{ marginLeft: 12 }}>
          Left inherits the parent. Right stays dark. All notes are WebGL.
        </span>
      </header>
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, minHeight: 0 }}>
        <Theme appearance="inherit" style={{ minHeight: 0 }}>
          <Editor name="Left" />
        </Theme>
        <Theme appearance="dark" style={{ minHeight: 0 }}>
          <Editor name="Right" />
        </Theme>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
