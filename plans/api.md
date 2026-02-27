# API Design

> Back to [PLAN.md](./PLAN.md)

---

## Defining Entity Types

Entity types are defined as plain objects conforming to `EntityTypeDefinition`:

```typescript
// Standard node — sockets with widgets, Kookie Flow renders everything
const entityTypes = {
  'math/add': {
    type: 'math/add',
    label: 'Add',
    inputs: [
      { name: 'a', type: 'float' },
      { name: 'b', type: 'float' },
    ],
    outputs: [
      { name: 'result', type: 'float' },
    ],
  },

  // Full escape hatch — consumer owns entire interior
  'custom/wild': {
    type: 'custom/wild',
    inputs: [{ name: 'In', type: 'any' }],
    outputs: [{ name: 'Out', type: 'any' }],
    component: ({ id, data, selected, onChange }) => (
      <div className="my-wild-layout">
        <MyEntirelyCustomThing data={data} onChange={onChange} />
      </div>
    ),
  },
};
```

> **Note:** `defineNode()` and `Input.*()` / `Output.*()` builder helpers are planned but not yet implemented. Currently, entity types and sockets are defined as plain objects.

---

## Socket Type System

```typescript
const socketTypes = {
  float: {
    color: '#6bcfff',
    validate: (value: unknown) => typeof value === 'number',
  },
  int: {
    color: '#6bcfff',
    validate: (value: unknown) => Number.isInteger(value),
  },
  image: {
    color: '#c7a0dc',
    compatibleWith: ['mask'],
  },
  mask: {
    color: '#ffffff',
  },
  any: {
    color: '#808080',
    compatibleWith: '*',
  },
};

<KookieFlow socketTypes={socketTypes} />
```

---

## Using the Graph

```typescript
import { KookieFlow, useGraph } from '@kushagradhawan/kookie-flow';

function App() {
  const {
    entities,
    edges,
    setEntities,
    setEdges,
    onEntitiesChange,
    onEdgesChange,
    onConnect,
    addEntity,
    removeEntity,
    getEntity,
    addEdge,
    removeEdge,
    getEdge,
    getConnectedEdges,
  } = useGraph({
    initialEntities: [...],
    initialEdges: [...],
  });

  const handleAddEntity = () => {
    addEntity({
      id: crypto.randomUUID(),
      type: 'math/add',
      position: { x: 100, y: 100 },
      data: {},
    });
  };

  return (
    <KookieFlow
      entities={entities}
      edges={edges}
      entityTypes={entityTypes}
      onEntitiesChange={onEntitiesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
    >
      <Panel position="top-left">
        <button onClick={handleAddEntity}>Add Node</button>
      </Panel>
    </KookieFlow>
  );
}
```

---

## Imperative API (Ref)

```typescript
const flowRef = useRef<KookieFlowInstance>(null);

// Viewport
flowRef.current.fitView({ padding: 50 });
flowRef.current.setCenter(0, 0, { zoom: 1 });
flowRef.current.zoomIn();
flowRef.current.zoomOut();
flowRef.current.getViewport();
flowRef.current.setViewport({ x: 0, y: 0, zoom: 1 });

// Data
flowRef.current.getEntities();
flowRef.current.getEdges();
flowRef.current.getSelectedEntities();
flowRef.current.getSelectedEdges();

// Groups
flowRef.current.getGroupChildren('group-1');
flowRef.current.getGroupDescendants('group-1');
flowRef.current.toggleGroupCollapse('group-1');
flowRef.current.expandGroup('group-1');
flowRef.current.collapseGroup('group-1');
flowRef.current.isGroupCollapsed('group-1');
flowRef.current.getGroupBounds('group-1');

<KookieFlow ref={flowRef} ... />
```
