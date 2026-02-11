import { describe, it, expect } from 'vitest';
import type { Edge, Entity } from '../types';
import {
  buildAdjacencyIndex,
  getIncomers,
  getOutgoers,
  getEntityEdges,
  getInputEdges,
  getOutputEdges,
  getEdgesBetween,
  walkUpstream,
  walkDownstream,
  computeAnalysis,
  wouldCreateCycle,
  getAffectedEntities,
  getConnectedComponents,
  areConnected,
  getExecutionOrder,
  getReadyEntities,
  computeInsertOnEdge,
  computeBypass,
  validate,
  isGraphComplete,
  getCompatiblePorts,
  computeCollapseToSubgraph,
  computeExpandSubgraph,
} from './graph';

// ============================================================================
// Test Helpers
// ============================================================================

/** Minimal edge factory */
function edge(
  id: string,
  source: string,
  target: string,
  sourceSocket?: string,
  targetSocket?: string
): Edge {
  return { id, source, target, sourceSocket, targetSocket };
}

/** Minimal entity factory */
function entity(id: string, x = 0, y = 0): Entity {
  return { id, type: 'default', position: { x, y }, data: { label: id } };
}

// ============================================================================
// Fixtures: A linear chain A → B → C → D
// ============================================================================

const linearEdges: Edge[] = [
  edge('e1', 'A', 'B', 'out', 'in'),
  edge('e2', 'B', 'C', 'out', 'in'),
  edge('e3', 'C', 'D', 'out', 'in'),
];

// ============================================================================
// Fixtures: Diamond A → B, A → C, B → D, C → D
// ============================================================================

const diamondEdges: Edge[] = [
  edge('e1', 'A', 'B'),
  edge('e2', 'A', 'C'),
  edge('e3', 'B', 'D'),
  edge('e4', 'C', 'D'),
];

// ============================================================================
// Fixtures: Cycle A → B → C → A
// ============================================================================

const cycleEdges: Edge[] = [
  edge('e1', 'A', 'B'),
  edge('e2', 'B', 'C'),
  edge('e3', 'C', 'A'),
];

// ============================================================================
// buildAdjacencyIndex
// ============================================================================

describe('buildAdjacencyIndex', () => {
  it('builds outgoing map correctly', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(index.outgoing.get('A')?.get('out')).toHaveLength(1);
    expect(index.outgoing.get('B')?.get('out')).toHaveLength(1);
    expect(index.outgoing.get('C')?.get('out')).toHaveLength(1);
    expect(index.outgoing.has('D')).toBe(false);
  });

  it('builds incoming map correctly', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(index.incoming.has('A')).toBe(false);
    expect(index.incoming.get('B')?.get('in')).toHaveLength(1);
    expect(index.incoming.get('C')?.get('in')).toHaveLength(1);
    expect(index.incoming.get('D')?.get('in')).toHaveLength(1);
  });

  it('builds byNode map correctly', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(index.byEntity.get('A')).toHaveLength(1); // e1
    expect(index.byEntity.get('B')).toHaveLength(2); // e1 + e2
    expect(index.byEntity.get('C')).toHaveLength(2); // e2 + e3
    expect(index.byEntity.get('D')).toHaveLength(1); // e3
  });

  it('handles empty edges', () => {
    const index = buildAdjacencyIndex([]);
    expect(index.outgoing.size).toBe(0);
    expect(index.incoming.size).toBe(0);
    expect(index.byEntity.size).toBe(0);
  });

  it('uses __default__ for missing socket ids', () => {
    const edges = [edge('e1', 'A', 'B')]; // no socket ids
    const index = buildAdjacencyIndex(edges);
    expect(index.outgoing.get('A')?.get('__default__')).toHaveLength(1);
    expect(index.incoming.get('B')?.get('__default__')).toHaveLength(1);
  });

  it('handles self-loop without double-counting in byNode', () => {
    const edges = [edge('e1', 'A', 'A')];
    const index = buildAdjacencyIndex(edges);
    // Self-loop should only appear once in byNode
    expect(index.byEntity.get('A')).toHaveLength(1);
  });

  it('handles multiple edges between same nodes', () => {
    const edges = [
      edge('e1', 'A', 'B', 'out1', 'in1'),
      edge('e2', 'A', 'B', 'out2', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(index.byEntity.get('A')).toHaveLength(2);
    expect(index.byEntity.get('B')).toHaveLength(2);
    expect(index.outgoing.get('A')?.get('out1')).toHaveLength(1);
    expect(index.outgoing.get('A')?.get('out2')).toHaveLength(1);
  });
});

// ============================================================================
// Basic Queries
// ============================================================================

describe('getIncomers', () => {
  it('returns direct predecessors', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getIncomers(index, 'D').sort()).toEqual(['B', 'C']);
  });

  it('returns empty for root nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getIncomers(index, 'A')).toEqual([]);
  });

  it('returns empty for unknown node', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getIncomers(index, 'Z')).toEqual([]);
  });

  it('deduplicates when multiple edges from same source', () => {
    const edges = [
      edge('e1', 'A', 'B', 'out1', 'in1'),
      edge('e2', 'A', 'B', 'out2', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(getIncomers(index, 'B')).toEqual(['A']);
  });
});

describe('getOutgoers', () => {
  it('returns direct successors', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getOutgoers(index, 'A').sort()).toEqual(['B', 'C']);
  });

  it('returns empty for leaf nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getOutgoers(index, 'D')).toEqual([]);
  });

  it('returns empty for unknown node', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getOutgoers(index, 'Z')).toEqual([]);
  });

  it('deduplicates when multiple edges to same target', () => {
    const edges = [
      edge('e1', 'A', 'B', 'out1', 'in1'),
      edge('e2', 'A', 'B', 'out2', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(getOutgoers(index, 'A')).toEqual(['B']);
  });
});

describe('getEntityEdges', () => {
  it('returns all edges touching an entity', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getEntityEdges(index, 'A')).toHaveLength(2); // e1, e2
    expect(getEntityEdges(index, 'B')).toHaveLength(2); // e1, e3
    expect(getEntityEdges(index, 'D')).toHaveLength(2); // e3, e4
  });

  it('returns empty for unknown node', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getEntityEdges(index, 'Z')).toEqual([]);
  });

  it('returns self-loop edge once', () => {
    const edges = [edge('e1', 'A', 'A')];
    const index = buildAdjacencyIndex(edges);
    expect(getEntityEdges(index, 'A')).toHaveLength(1);
    expect(getEntityEdges(index, 'A')[0].id).toBe('e1');
  });
});

describe('getInputEdges', () => {
  it('returns incoming edges', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const inputs = getInputEdges(index, 'C');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].id).toBe('e2');
  });

  it('returns empty for root', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(getInputEdges(index, 'A')).toEqual([]);
  });

  it('returns multiple inputs from different sockets', () => {
    const edges = [
      edge('e1', 'A', 'C', 'out', 'in1'),
      edge('e2', 'B', 'C', 'out', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);
    const inputs = getInputEdges(index, 'C');
    expect(inputs).toHaveLength(2);
    expect(inputs.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('returns empty for unknown node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(getInputEdges(index, 'Z')).toEqual([]);
  });
});

describe('getOutputEdges', () => {
  it('returns outgoing edges', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const outputs = getOutputEdges(index, 'B');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].id).toBe('e2');
  });

  it('returns empty for leaf', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(getOutputEdges(index, 'D')).toEqual([]);
  });

  it('returns multiple outputs from different sockets', () => {
    const edges = [
      edge('e1', 'A', 'B', 'out1', 'in'),
      edge('e2', 'A', 'C', 'out2', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);
    const outputs = getOutputEdges(index, 'A');
    expect(outputs).toHaveLength(2);
    expect(outputs.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('returns empty for unknown node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(getOutputEdges(index, 'Z')).toEqual([]);
  });
});

describe('getEdgesBetween', () => {
  it('returns edges in both directions', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getEdgesBetween(index, 'A', 'B')).toHaveLength(1);
    expect(getEdgesBetween(index, 'B', 'A')).toHaveLength(1); // same edge, reversed query
  });

  it('returns empty for unconnected nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getEdgesBetween(index, 'B', 'C')).toEqual([]);
  });

  it('returns multiple edges between same pair', () => {
    const edges = [
      edge('e1', 'A', 'B', 'out1', 'in1'),
      edge('e2', 'A', 'B', 'out2', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(getEdgesBetween(index, 'A', 'B')).toHaveLength(2);
  });

  it('returns self-loop edge', () => {
    const edges = [edge('e1', 'A', 'A')];
    const index = buildAdjacencyIndex(edges);
    expect(getEdgesBetween(index, 'A', 'A')).toHaveLength(1);
    expect(getEdgesBetween(index, 'A', 'A')[0].id).toBe('e1');
  });

  it('returns empty for unknown nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    expect(getEdgesBetween(index, 'Z', 'Y')).toEqual([]);
  });
});

// ============================================================================
// Traversal
// ============================================================================

describe('walkUpstream', () => {
  it('yields all ancestors in linear chain', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const upstream = [...walkUpstream(index, 'D')];
    expect(upstream.sort()).toEqual(['A', 'B', 'C']);
  });

  it('yields all ancestors in diamond', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const upstream = [...walkUpstream(index, 'D')];
    expect(upstream.sort()).toEqual(['A', 'B', 'C']);
  });

  it('yields empty for root', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect([...walkUpstream(index, 'A')]).toEqual([]);
  });

  it('does not yield start node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const upstream = [...walkUpstream(index, 'C')];
    expect(upstream).not.toContain('C');
  });

  it('handles cycles without infinite loop', () => {
    const index = buildAdjacencyIndex(cycleEdges);
    const upstream = [...walkUpstream(index, 'A')];
    expect(upstream.sort()).toEqual(['B', 'C']);
  });

  it('yields empty for disconnected node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect([...walkUpstream(index, 'Z')]).toEqual([]);
  });
});

describe('walkDownstream', () => {
  it('yields all descendants in linear chain', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const downstream = [...walkDownstream(index, 'A')];
    expect(downstream.sort()).toEqual(['B', 'C', 'D']);
  });

  it('yields all descendants in diamond', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const downstream = [...walkDownstream(index, 'A')];
    expect(downstream.sort()).toEqual(['B', 'C', 'D']);
  });

  it('yields empty for leaf', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect([...walkDownstream(index, 'D')]).toEqual([]);
  });

  it('does not yield start node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const downstream = [...walkDownstream(index, 'B')];
    expect(downstream).not.toContain('B');
  });

  it('handles cycles without infinite loop', () => {
    const index = buildAdjacencyIndex(cycleEdges);
    const downstream = [...walkDownstream(index, 'A')];
    expect(downstream.sort()).toEqual(['B', 'C']);
  });

  it('yields empty for disconnected node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect([...walkDownstream(index, 'Z')]).toEqual([]);
  });
});

// ============================================================================
// computeAnalysis (Topo Sort + Execution Levels)
// ============================================================================

describe('computeAnalysis', () => {
  it('computes correct topological order for linear graph', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const result = computeAnalysis(['A', 'B', 'C', 'D'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.topologicalOrder).toEqual(['A', 'B', 'C', 'D']);
    expect(result.cycleEntityIds).toEqual([]);
  });

  it('computes correct execution levels for diamond', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const result = computeAnalysis(['A', 'B', 'C', 'D'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.executionLevels).toHaveLength(3);
    expect(result.executionLevels![0]).toEqual(['A']);
    expect(result.executionLevels![1].sort()).toEqual(['B', 'C']);
    expect(result.executionLevels![2]).toEqual(['D']);
  });

  it('detects cycles', () => {
    const index = buildAdjacencyIndex(cycleEdges);
    const result = computeAnalysis(['A', 'B', 'C'], index);

    expect(result.hasCycles).toBe(true);
    expect(result.topologicalOrder).toBeNull();
    expect(result.executionLevels).toBeNull();
    expect(result.cycleEntityIds.sort()).toEqual(['A', 'B', 'C']);
  });

  it('identifies roots and leaves', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const result = computeAnalysis(['A', 'B', 'C', 'D'], index);

    expect(result.roots).toEqual(['A']);
    expect(result.leaves).toEqual(['D']);
  });

  it('handles disconnected nodes as separate roots/leaves', () => {
    const edges = [edge('e1', 'A', 'B')];
    const index = buildAdjacencyIndex(edges);
    const result = computeAnalysis(['A', 'B', 'C'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.roots.sort()).toEqual(['A', 'C']);
    expect(result.leaves.sort()).toEqual(['B', 'C']);
  });

  it('handles empty graph', () => {
    const index = buildAdjacencyIndex([]);
    const result = computeAnalysis([], index);

    expect(result.hasCycles).toBe(false);
    expect(result.topologicalOrder).toEqual([]);
    expect(result.executionLevels).toEqual([]);
    expect(result.roots).toEqual([]);
    expect(result.leaves).toEqual([]);
  });

  it('respects muted nodes — excludes them from execution levels', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const muted = new Set(['B']);
    const result = computeAnalysis(['A', 'B', 'C', 'D'], index, muted);

    expect(result.hasCycles).toBe(false);
    // Topo order includes B (it's still in the graph)
    expect(result.topologicalOrder).toContain('B');
    // But execution levels should not include B
    for (const level of result.executionLevels!) {
      expect(level).not.toContain('B');
    }
  });

  it('handles single node graph', () => {
    const index = buildAdjacencyIndex([]);
    const result = computeAnalysis(['A'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.topologicalOrder).toEqual(['A']);
    expect(result.executionLevels).toEqual([['A']]);
    expect(result.roots).toEqual(['A']);
    expect(result.leaves).toEqual(['A']);
  });

  it('handles all isolated nodes (no edges)', () => {
    const index = buildAdjacencyIndex([]);
    const result = computeAnalysis(['A', 'B', 'C'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.topologicalOrder).toHaveLength(3);
    expect(result.roots.sort()).toEqual(['A', 'B', 'C']);
    expect(result.leaves.sort()).toEqual(['A', 'B', 'C']);
    // All nodes at same level
    expect(result.executionLevels).toHaveLength(1);
    expect(result.executionLevels![0].sort()).toEqual(['A', 'B', 'C']);
  });

  it('handles wide fan-out graph', () => {
    // A → B, A → C, A → D, A → E
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'A', 'C'),
      edge('e3', 'A', 'D'),
      edge('e4', 'A', 'E'),
    ];
    const index = buildAdjacencyIndex(edges);
    const result = computeAnalysis(['A', 'B', 'C', 'D', 'E'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.executionLevels).toHaveLength(2);
    expect(result.executionLevels![0]).toEqual(['A']);
    expect(result.executionLevels![1].sort()).toEqual(['B', 'C', 'D', 'E']);
    expect(result.roots).toEqual(['A']);
    expect(result.leaves.sort()).toEqual(['B', 'C', 'D', 'E']);
  });

  it('handles wide fan-in graph', () => {
    // B → A, C → A, D → A
    const edges = [
      edge('e1', 'B', 'A'),
      edge('e2', 'C', 'A'),
      edge('e3', 'D', 'A'),
    ];
    const index = buildAdjacencyIndex(edges);
    const result = computeAnalysis(['A', 'B', 'C', 'D'], index);

    expect(result.hasCycles).toBe(false);
    expect(result.executionLevels).toHaveLength(2);
    expect(result.executionLevels![0].sort()).toEqual(['B', 'C', 'D']);
    expect(result.executionLevels![1]).toEqual(['A']);
    expect(result.roots.sort()).toEqual(['B', 'C', 'D']);
    expect(result.leaves).toEqual(['A']);
  });

  it('handles partial cycle (some nodes cyclic, some not)', () => {
    //  X → A → B → C → A  (A,B,C in cycle; X is root)
    const edges = [
      edge('e0', 'X', 'A'),
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C'),
      edge('e3', 'C', 'A'),
    ];
    const index = buildAdjacencyIndex(edges);
    const result = computeAnalysis(['X', 'A', 'B', 'C'], index);

    expect(result.hasCycles).toBe(true);
    expect(result.cycleEntityIds.sort()).toEqual(['A', 'B', 'C']);
    // X is still processable
    expect(result.cycleEntityIds).not.toContain('X');
  });
});

// ============================================================================
// wouldCreateCycle
// ============================================================================

describe('wouldCreateCycle', () => {
  it('detects self-loop', () => {
    const index = buildAdjacencyIndex([]);
    expect(wouldCreateCycle(index, 'A', 'A')).toBe(true);
  });

  it('detects direct back-edge', () => {
    // A → B already exists, adding B → A would create cycle
    const index = buildAdjacencyIndex([edge('e1', 'A', 'B')]);
    expect(wouldCreateCycle(index, 'B', 'A')).toBe(true);
  });

  it('detects indirect cycle', () => {
    // A → B → C exists, adding C → A would create cycle
    const index = buildAdjacencyIndex([
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C'),
    ]);
    expect(wouldCreateCycle(index, 'C', 'A')).toBe(true);
  });

  it('allows valid connection', () => {
    // A → B exists, A → C is fine
    const index = buildAdjacencyIndex([edge('e1', 'A', 'B')]);
    expect(wouldCreateCycle(index, 'A', 'C')).toBe(false);
  });

  it('allows connection in DAG', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    // Adding A → D is redundant but not cyclic
    expect(wouldCreateCycle(index, 'A', 'D')).toBe(false);
  });

  it('detects long-distance cycle', () => {
    // A → B → C → D → E, adding E → A
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C'),
      edge('e3', 'C', 'D'),
      edge('e4', 'D', 'E'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(wouldCreateCycle(index, 'E', 'A')).toBe(true);
  });

  it('does not false-positive on disconnected graph', () => {
    // A → B, C → D are separate. C → A is fine.
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'C', 'D'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(wouldCreateCycle(index, 'C', 'A')).toBe(false);
  });

  it('allows connection between unknown nodes', () => {
    const index = buildAdjacencyIndex([]);
    expect(wouldCreateCycle(index, 'X', 'Y')).toBe(false);
  });

  it('detects cycle in already-cyclic graph', () => {
    // A → B → C → A already exists, adding any edge within should still be detected
    const index = buildAdjacencyIndex(cycleEdges);
    expect(wouldCreateCycle(index, 'A', 'B')).toBe(true); // B can already reach A
  });
});

// ============================================================================
// getAffectedEntities (Dirty Propagation)
// ============================================================================

describe('getAffectedEntities', () => {
  it('returns downstream nodes from a single change', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const affected = getAffectedEntities('B', index);
    expect(affected.sort()).toEqual(['C', 'D']);
  });

  it('returns empty for leaf change', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(getAffectedEntities('D', index)).toEqual([]);
  });

  it('accepts array of changed nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const affected = getAffectedEntities(['B', 'C'], index);
    expect(affected).toEqual(['D']);
  });

  it('returns in topo order when cachedOrder provided', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const order = ['A', 'B', 'C', 'D'];
    const affected = getAffectedEntities('A', index, order);
    expect(affected).toEqual(['B', 'C', 'D']); // topo order
  });

  it('handles string input (single changed node)', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const affected = getAffectedEntities('A', index);
    expect(affected.sort()).toEqual(['B', 'C', 'D']);
  });

  it('propagates through muted entities', () => {
    // A → B → C → D, B is muted — propagation should still pass through B
    const index = buildAdjacencyIndex(linearEdges);
    const muted = new Set(['B']);
    const affected = getAffectedEntities('A', index, null, muted);
    // Muted entities are still in the affected set (they're downstream)
    expect(affected.sort()).toEqual(['B', 'C', 'D']);
  });

  it('handles multiple disconnected changed nodes', () => {
    // A → B, C → D — change A and C
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'C', 'D'),
    ];
    const index = buildAdjacencyIndex(edges);
    const affected = getAffectedEntities(['A', 'C'], index);
    expect(affected.sort()).toEqual(['B', 'D']);
  });

  it('handles unknown changed node gracefully', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const affected = getAffectedEntities('Z', index);
    expect(affected).toEqual([]);
  });
});

// ============================================================================
// getConnectedComponents
// ============================================================================

describe('getConnectedComponents', () => {
  it('returns single component for connected graph', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const components = getConnectedComponents(['A', 'B', 'C', 'D'], index);
    expect(components.size).toBe(1);
    const group = [...components.values()][0];
    expect(group.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('returns separate components for disconnected subgraphs', () => {
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'C', 'D'),
    ];
    const index = buildAdjacencyIndex(edges);
    const components = getConnectedComponents(['A', 'B', 'C', 'D'], index);
    expect(components.size).toBe(2);
  });

  it('isolates nodes with no edges', () => {
    const index = buildAdjacencyIndex([]);
    const components = getConnectedComponents(['A', 'B', 'C'], index);
    expect(components.size).toBe(3);
  });

  it('handles empty graph', () => {
    const index = buildAdjacencyIndex([]);
    const components = getConnectedComponents([], index);
    expect(components.size).toBe(0);
  });
});

// ============================================================================
// areConnected
// ============================================================================

describe('areConnected', () => {
  it('returns true for directly connected nodes', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(areConnected(index, 'A', 'B')).toBe(true);
  });

  it('returns true for transitively connected nodes', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(areConnected(index, 'A', 'D')).toBe(true);
  });

  it('returns false for disconnected nodes', () => {
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'C', 'D'),
    ];
    const index = buildAdjacencyIndex(edges);
    expect(areConnected(index, 'A', 'C')).toBe(false);
  });

  it('returns true for same node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(areConnected(index, 'A', 'A')).toBe(true);
  });

  it('is symmetric', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(areConnected(index, 'A', 'D')).toBe(true);
    expect(areConnected(index, 'D', 'A')).toBe(true);
  });

  it('returns false for unknown node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    expect(areConnected(index, 'A', 'Z')).toBe(false);
  });

  it('handles cyclic graphs', () => {
    const index = buildAdjacencyIndex(cycleEdges);
    expect(areConnected(index, 'A', 'C')).toBe(true);
  });
});

// ============================================================================
// getExecutionOrder
// ============================================================================

describe('getExecutionOrder', () => {
  it('returns just the needed subgraph', () => {
    // A → B → C → D, execution order for C only needs A, B, C
    const index = buildAdjacencyIndex(linearEdges);
    const order = getExecutionOrder(index, 'C');
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('returns single node for root', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const order = getExecutionOrder(index, 'A');
    expect(order).toEqual(['A']);
  });

  it('returns full chain for leaf', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const order = getExecutionOrder(index, 'D');
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles diamond merge correctly', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const order = getExecutionOrder(index, 'D');
    expect(order).toHaveLength(4);
    // A must come before B and C, B and C must come before D
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('falls back to entity list on cycle', () => {
    // A → B → C → A — cycle, so topo sort fails
    const index = buildAdjacencyIndex(cycleEdges);
    const order = getExecutionOrder(index, 'A');
    // Should return all upstream + self, fallback since cycle exists
    expect(order).toHaveLength(3);
    expect(order.sort()).toEqual(['A', 'B', 'C']);
  });

  it('handles node with no connections', () => {
    const index = buildAdjacencyIndex([]);
    const order = getExecutionOrder(index, 'A');
    expect(order).toEqual(['A']);
  });
});

// ============================================================================
// getReadyEntities
// ============================================================================

describe('getReadyEntities', () => {
  it('returns roots when nothing is completed', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const ready = getReadyEntities(['A', 'B', 'C', 'D'], index, new Set());
    expect(ready).toEqual(['A']);
  });

  it('returns next level after completing root', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const ready = getReadyEntities(['A', 'B', 'C', 'D'], index, new Set(['A']));
    expect(ready.sort()).toEqual(['B', 'C']);
  });

  it('returns leaf when all predecessors completed', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const ready = getReadyEntities(
      ['A', 'B', 'C', 'D'],
      index,
      new Set(['A', 'B', 'C'])
    );
    expect(ready).toEqual(['D']);
  });

  it('does not return already-completed nodes', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    const ready = getReadyEntities(
      ['A', 'B', 'C', 'D'],
      index,
      new Set(['A', 'B', 'C', 'D'])
    );
    expect(ready).toEqual([]);
  });

  it('handles partial completion in diamond', () => {
    const index = buildAdjacencyIndex(diamondEdges);
    // Only B completed (not C), so D is not ready
    const ready = getReadyEntities(
      ['A', 'B', 'C', 'D'],
      index,
      new Set(['A', 'B'])
    );
    expect(ready).toEqual(['C']);
    expect(ready).not.toContain('D');
  });

  it('handles disconnected nodes as immediately ready', () => {
    const index = buildAdjacencyIndex([]);
    const ready = getReadyEntities(['A', 'B', 'C'], index, new Set());
    expect(ready.sort()).toEqual(['A', 'B', 'C']);
  });

  it('handles empty entity list', () => {
    const index = buildAdjacencyIndex([]);
    const ready = getReadyEntities([], index, new Set());
    expect(ready).toEqual([]);
  });
});

// ============================================================================
// computeInsertOnEdge
// ============================================================================

describe('computeInsertOnEdge', () => {
  it('splits edge and positions entity at midpoint', () => {
    const e = edge('e1', 'A', 'B', 'out', 'in');
    const newEntity = {
      id: 'X',
      type: 'default',
      inputs: [{ id: 'x-in' }],
      outputs: [{ id: 'x-out' }],
    };
    const srcEntity = entity('A', 0, 0);
    const tgtEntity = entity('B', 100, 200);

    const result = computeInsertOnEdge(e, newEntity, srcEntity, tgtEntity);

    expect(result.removeEdgeId).toBe('e1');
    expect(result.entityPosition).toEqual({ x: 50, y: 100 });
    expect(result.newEdges).toHaveLength(2);

    // First edge: A → X
    const [edgeA, edgeB] = result.newEdges;
    expect(edgeA.source).toBe('A');
    expect(edgeA.sourceSocket).toBe('out');
    expect(edgeA.target).toBe('X');
    expect(edgeA.targetSocket).toBe('x-in');

    // Second edge: X → B
    expect(edgeB.source).toBe('X');
    expect(edgeB.sourceSocket).toBe('x-out');
    expect(edgeB.target).toBe('B');
    expect(edgeB.targetSocket).toBe('in');
  });

  it('handles missing source/target entities (positions at 0,0)', () => {
    const e = edge('e1', 'A', 'B');
    const newEntity = { id: 'X', type: 'default' };

    const result = computeInsertOnEdge(e, newEntity, undefined, undefined);
    expect(result.entityPosition).toEqual({ x: 0, y: 0 });
  });

  it('handles entity with no inputs/outputs', () => {
    const e = edge('e1', 'A', 'B', 'out', 'in');
    const newEntity = { id: 'X', type: 'default' };

    const result = computeInsertOnEdge(e, newEntity, entity('A'), entity('B'));
    expect(result.newEdges[0].targetSocket).toBeUndefined();
    expect(result.newEdges[1].sourceSocket).toBeUndefined();
  });

  it('generates unique edge IDs based on original edge', () => {
    const e = edge('e1', 'A', 'B', 'out', 'in');
    const newEntity = { id: 'X', type: 'default', inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] };
    const result = computeInsertOnEdge(e, newEntity, entity('A'), entity('B'));

    expect(result.newEdges[0].id).toBe('e1-a');
    expect(result.newEdges[1].id).toBe('e1-b');
    expect(result.removeEdgeId).toBe('e1');
  });

  it('preserves original edge sockets', () => {
    const e = edge('e1', 'A', 'B', 'custom-out', 'custom-in');
    const newEntity = { id: 'X', type: 'default', inputs: [{ id: 'x-in' }], outputs: [{ id: 'x-out' }] };
    const result = computeInsertOnEdge(e, newEntity, entity('A'), entity('B'));

    expect(result.newEdges[0].sourceSocket).toBe('custom-out');
    expect(result.newEdges[1].targetSocket).toBe('custom-in');
  });
});

// ============================================================================
// computeBypass
// ============================================================================

describe('computeBypass', () => {
  it('reconnects through bypassed node', () => {
    // A → B → C, bypass B → A → C
    const index = buildAdjacencyIndex(linearEdges);
    const result = computeBypass('B', index);

    expect(result.removeEntityId).toBe('B');
    expect(result.removeEdgeIds.sort()).toEqual(['e1', 'e2']);
    expect(result.newEdges).toHaveLength(1);
    expect(result.newEdges[0].source).toBe('A');
    expect(result.newEdges[0].target).toBe('C');
    expect(result.newEdges[0].sourceSocket).toBe('out');
    expect(result.newEdges[0].targetSocket).toBe('in');
  });

  it('handles node with no connections', () => {
    const index = buildAdjacencyIndex([]);
    const result = computeBypass('A', index);

    expect(result.removeEntityId).toBe('A');
    expect(result.removeEdgeIds).toEqual([]);
    expect(result.newEdges).toEqual([]);
  });

  it('handles node with only inputs (leaf)', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const result = computeBypass('D', index);

    expect(result.removeEntityId).toBe('D');
    expect(result.removeEdgeIds).toEqual(['e3']);
    expect(result.newEdges).toEqual([]); // no outputs to reconnect
  });

  it('handles node with only outputs (root)', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const result = computeBypass('A', index);

    expect(result.removeEntityId).toBe('A');
    expect(result.removeEdgeIds).toEqual(['e1']);
    expect(result.newEdges).toEqual([]); // no inputs to reconnect
  });

  it('handles diamond merge node with multiple inputs and one output', () => {
    // A → D and C → D → E: bypass D, only pairs first input→first output
    const edges = [
      edge('e1', 'A', 'D', 'out', 'in1'),
      edge('e2', 'C', 'D', 'out', 'in2'),
      edge('e3', 'D', 'E', 'out', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);
    const result = computeBypass('D', index);

    expect(result.removeEdgeIds.sort()).toEqual(['e1', 'e2', 'e3']);
    // min(2 inputs, 1 output) = 1 new edge
    expect(result.newEdges).toHaveLength(1);
  });

  it('handles node with equal number of inputs and outputs', () => {
    // A → B (in1), C → B (in2), B → D (out1), B → E (out2)
    const edges = [
      edge('e1', 'A', 'B', 'out', 'in1'),
      edge('e2', 'C', 'B', 'out', 'in2'),
      edge('e3', 'B', 'D', 'out1', 'in'),
      edge('e4', 'B', 'E', 'out2', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);
    const result = computeBypass('B', index);

    expect(result.removeEdgeIds.sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    // min(2, 2) = 2 new edges
    expect(result.newEdges).toHaveLength(2);
    expect(result.newEdges[0].source).toBe('A');
    expect(result.newEdges[0].target).toBe('D');
    expect(result.newEdges[1].source).toBe('C');
    expect(result.newEdges[1].target).toBe('E');
  });

  it('handles unknown node', () => {
    const index = buildAdjacencyIndex(linearEdges);
    const result = computeBypass('Z', index);

    expect(result.removeEntityId).toBe('Z');
    expect(result.removeEdgeIds).toEqual([]);
    expect(result.newEdges).toEqual([]);
  });
});

// ============================================================================
// validate
// ============================================================================

describe('validate', () => {
  it('returns empty array for valid acyclic graph', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);

    const issues = validate(nodes, edges, index);
    expect(issues).toEqual([]);
  });

  it('detects cycles', () => {
    const entities = [entity('A'), entity('B')];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')];
    const index = buildAdjacencyIndex(edges);

    const issues = validate(entities, edges, index);
    const cycleIssues = issues.filter((i) => i.type === 'cycle');
    expect(cycleIssues).toHaveLength(1);
    expect(cycleIssues[0].type === 'cycle' && cycleIssues[0].entityIds.sort()).toEqual(['A', 'B']);
  });

  it('detects unconnected required inputs (no default value)', () => {
    const nodes = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const index = buildAdjacencyIndex([]);

    const issues = validate(nodes, [], index);
    const unconnected = issues.filter((i) => i.type === 'unconnected-required');
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0]).toMatchObject({
      type: 'unconnected-required',
      entityId: 'A',
      portId: 'in',
      portName: 'In',
    });
  });

  it('skips inputs with defaultValue', () => {
    const nodes = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float', defaultValue: 0 }] },
    ];
    const index = buildAdjacencyIndex([]);

    const issues = validate(nodes, [], index);
    const unconnected = issues.filter((i) => i.type === 'unconnected-required');
    expect(unconnected).toHaveLength(0);
  });

  it('detects type mismatches when socketTypes provided', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'image' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = {
      float: {},
      image: {},
    };

    const issues = validate(nodes, edges, index, socketTypes);
    const mismatches = issues.filter((i) => i.type === 'type-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      type: 'type-mismatch',
      edgeId: 'e1',
      sourceType: 'float',
      targetType: 'image',
    });
  });

  it('allows compatible types (same type)', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = { float: {} };

    const issues = validate(nodes, edges, index, socketTypes);
    const mismatches = issues.filter((i) => i.type === 'type-mismatch');
    expect(mismatches).toHaveLength(0);
  });

  it('allows "any" type connections', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'any' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = { float: {}, any: {} };

    const issues = validate(nodes, edges, index, socketTypes);
    const mismatches = issues.filter((i) => i.type === 'type-mismatch');
    expect(mismatches).toHaveLength(0);
  });

  it('uses custom isTypeCompatible function', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'int' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);

    // Custom: float and int are compatible
    const compatible = validate(nodes, edges, index, undefined, () => true);
    expect(compatible.filter((i) => i.type === 'type-mismatch')).toHaveLength(0);

    // Custom: nothing is compatible
    const incompatible = validate(nodes, edges, index, undefined, () => false);
    expect(incompatible.filter((i) => i.type === 'type-mismatch')).toHaveLength(1);
  });

  it('handles edges referencing nonexistent entity sockets gracefully', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    // Edge references socket that doesn't exist on the entity
    const edges = [edge('e1', 'A', 'B', 'nonexistent-out', 'nonexistent-in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = { float: {} };

    // Should not throw, and should skip type check for missing sockets
    const issues = validate(nodes, edges, index, socketTypes);
    expect(issues.filter((i) => i.type === 'type-mismatch')).toHaveLength(0);
  });

  it('detects multiple issues simultaneously', () => {
    // A → B (cycle), C has unconnected required input
    const nodes = [
      entity('A'),
      entity('B'),
      { ...entity('C'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')];
    const index = buildAdjacencyIndex(edges);

    const issues = validate(nodes, edges, index);
    expect(issues.filter((i) => i.type === 'cycle')).toHaveLength(1);
    expect(issues.filter((i) => i.type === 'unconnected-required')).toHaveLength(1);
  });

  it('handles entity with no inputs/outputs defined', () => {
    const nodes = [entity('A'), entity('B')];
    const edges = [edge('e1', 'A', 'B')];
    const index = buildAdjacencyIndex(edges);

    const issues = validate(nodes, edges, index);
    expect(issues).toEqual([]);
  });

  it('handles empty graph validation', () => {
    const issues = validate([], [], buildAdjacencyIndex([]));
    expect(issues).toEqual([]);
  });

  it('allows compatibleWith list types', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'int' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = {
      int: { compatibleWith: ['float'] as string[] },
      float: {},
    };

    const issues = validate(nodes, edges, index, socketTypes);
    expect(issues.filter((i) => i.type === 'type-mismatch')).toHaveLength(0);
  });

  it('allows wildcard compatibleWith', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'wildcard' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'image' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const socketTypes = {
      wildcard: { compatibleWith: '*' as const },
      image: {},
    };

    const issues = validate(nodes, edges, index, socketTypes);
    expect(issues.filter((i) => i.type === 'type-mismatch')).toHaveLength(0);
  });
});

// ============================================================================
// isGraphComplete
// ============================================================================

describe('isGraphComplete', () => {
  it('returns true when all inputs are connected', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);

    expect(isGraphComplete(nodes, index)).toBe(true);
  });

  it('returns false when an input without default is unconnected', () => {
    const nodes = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const index = buildAdjacencyIndex([]);

    expect(isGraphComplete(nodes, index)).toBe(false);
  });

  it('returns true when unconnected input has defaultValue', () => {
    const nodes = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float', defaultValue: 0 }] },
    ];
    const index = buildAdjacencyIndex([]);

    expect(isGraphComplete(nodes, index)).toBe(true);
  });

  it('returns true for graph with no inputs', () => {
    const entities = [entity('A'), entity('B')];
    const index = buildAdjacencyIndex([]);

    expect(isGraphComplete(entities, index)).toBe(true);
  });

  it('returns true for empty graph', () => {
    const index = buildAdjacencyIndex([]);
    expect(isGraphComplete([], index)).toBe(true);
  });

  it('handles entity with multiple inputs (all connected)', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      {
        ...entity('C'),
        inputs: [
          { id: 'in1', name: 'In1', type: 'float' },
          { id: 'in2', name: 'In2', type: 'float' },
        ],
      },
    ];
    const edges = [
      edge('e1', 'A', 'C', 'out', 'in1'),
      edge('e2', 'B', 'C', 'out', 'in2'),
    ];
    const index = buildAdjacencyIndex(edges);

    expect(isGraphComplete(nodes, index)).toBe(true);
  });

  it('returns false when one of multiple inputs is unconnected', () => {
    const nodes = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      {
        ...entity('C'),
        inputs: [
          { id: 'in1', name: 'In1', type: 'float' },
          { id: 'in2', name: 'In2', type: 'float' },
        ],
      },
    ];
    const edges = [edge('e1', 'A', 'C', 'out', 'in1')]; // in2 unconnected
    const index = buildAdjacencyIndex(edges);

    expect(isGraphComplete(nodes, index)).toBe(false);
  });
});

// ============================================================================
// getCompatiblePorts
// ============================================================================

describe('getCompatiblePorts', () => {
  const socketTypes = {
    float: {},
    int: { compatibleWith: ['float'] as string[] },
    image: {},
    any: { compatibleWith: '*' as const },
  };

  const testEntities: Entity[] = [
    { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
    { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    { ...entity('C'), inputs: [{ id: 'in', name: 'In', type: 'image' }] },
    { ...entity('D'), inputs: [{ id: 'in', name: 'In', type: 'int' }] },
    { ...entity('E'), inputs: [{ id: 'in', name: 'In', type: 'any' }] },
  ];

  it('returns compatible input ports for an output socket', () => {
    const result = getCompatiblePorts('A', 'out', false, testEntities, socketTypes);
    const targetIds = result.map((p) => p.entityId);
    expect(targetIds).toContain('B'); // float → float
    expect(targetIds).toContain('D'); // float → int (int compatibleWith float)
    expect(targetIds).toContain('E'); // float → any
    expect(targetIds).not.toContain('C'); // float ✗ image
    expect(targetIds).not.toContain('A'); // no self-connection
  });

  it('filters cycle-creating connections when allowCycles=false', () => {
    // A → B exists, so B → A would create a cycle
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const entitiesWithOutputOnB: Entity[] = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float' }], outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }], outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
    ];

    const withCycles = getCompatiblePorts('B', 'out', false, entitiesWithOutputOnB, socketTypes, index, true);
    expect(withCycles.map((p) => p.entityId)).toContain('A');

    const withoutCycles = getCompatiblePorts('B', 'out', false, entitiesWithOutputOnB, socketTypes, index, false);
    expect(withoutCycles.map((p) => p.entityId)).not.toContain('A');
  });

  it('returns empty for unknown source socket', () => {
    const result = getCompatiblePorts('A', 'nonexistent', false, testEntities, socketTypes);
    expect(result).toEqual([]);
  });

  it('returns compatible output ports for an input socket (isSourceInput=true)', () => {
    // B has input 'in' of type 'float' — find compatible outputs
    const result = getCompatiblePorts('B', 'in', true, testEntities, socketTypes);
    const targetIds = result.map((p) => p.entityId);
    expect(targetIds).toContain('A'); // float output → float input
    expect(targetIds).not.toContain('B'); // no self-connection
  });

  it('returns empty when no entities exist', () => {
    const result = getCompatiblePorts('A', 'out', false, [], socketTypes);
    expect(result).toEqual([]);
  });

  it('returns empty for unknown source entity', () => {
    const result = getCompatiblePorts('UNKNOWN', 'out', false, testEntities, socketTypes);
    expect(result).toEqual([]);
  });

  it('skips entities with no target sockets', () => {
    // Entity F has no inputs
    const entitiesWithNoInputs: Entity[] = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('F'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] }, // no inputs
    ];
    const result = getCompatiblePorts('A', 'out', false, entitiesWithNoInputs, socketTypes);
    expect(result).toEqual([]);
  });

  it('handles allowCycles=true to permit cycle-creating connections', () => {
    const edges = [edge('e1', 'A', 'B', 'out', 'in')];
    const index = buildAdjacencyIndex(edges);
    const entitiesForCycle: Entity[] = [
      { ...entity('A'), inputs: [{ id: 'in', name: 'In', type: 'float' }], outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B'), inputs: [{ id: 'in', name: 'In', type: 'float' }], outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
    ];

    const result = getCompatiblePorts('B', 'out', false, entitiesForCycle, socketTypes, index, true);
    expect(result.map((p) => p.entityId)).toContain('A');
  });
});

// ============================================================================
// computeCollapseToSubgraph
// ============================================================================

describe('computeCollapseToSubgraph', () => {
  it('collapses a linear subchain', () => {
    // A → B → C → D: collapse B and C
    const entities = [entity('A', 0, 0), entity('B', 100, 0), entity('C', 200, 0), entity('D', 300, 0)];
    entities[0].outputs = [{ id: 'out', name: 'Out', type: 'float' }];
    entities[1].inputs = [{ id: 'in', name: 'In', type: 'float' }];
    entities[1].outputs = [{ id: 'out', name: 'Out', type: 'float' }];
    entities[2].inputs = [{ id: 'in', name: 'In', type: 'float' }];
    entities[2].outputs = [{ id: 'out', name: 'Out', type: 'float' }];
    entities[3].inputs = [{ id: 'in', name: 'In', type: 'float' }];

    const edges = [
      edge('e1', 'A', 'B', 'out', 'in'),
      edge('e2', 'B', 'C', 'out', 'in'),
      edge('e3', 'C', 'D', 'out', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeCollapseToSubgraph(['B', 'C'], 'frame-1', entities, index);

    // Internal edge (B→C) removed
    expect(result.removeEdgeIds).toContain('e2');
    // Boundary edges (A→B, C→D) removed
    expect(result.removeEdgeIds).toContain('e1');
    expect(result.removeEdgeIds).toContain('e3');

    // Frame gets 1 input port (from B's input) and 1 output port (from C's output)
    expect(result.frameInputs).toHaveLength(1);
    expect(result.frameOutputs).toHaveLength(1);

    // New edges reconnect A→frame and frame→D
    expect(result.newEdges).toHaveLength(2);
    const sourceIds = result.newEdges.map((e) => e.source);
    const targetIds = result.newEdges.map((e) => e.target);
    expect(sourceIds).toContain('A');
    expect(targetIds).toContain('D');
    expect(sourceIds).toContain('frame-1');
    expect(targetIds).toContain('frame-1');
  });

  it('handles isolated subgraph with no boundary edges', () => {
    // B → C (no connections to outside)
    const entities = [entity('A'), entity('B', 100, 0), entity('C', 200, 0)];
    const edges = [edge('e1', 'B', 'C')];
    const index = buildAdjacencyIndex(edges);

    const result = computeCollapseToSubgraph(['B', 'C'], 'frame-1', entities, index);

    expect(result.removeEdgeIds).toEqual(['e1']); // internal only
    expect(result.frameInputs).toHaveLength(0);
    expect(result.frameOutputs).toHaveLength(0);
    expect(result.newEdges).toHaveLength(0);
  });

  it('calculates frame position from child bounds', () => {
    const entities = [
      { ...entity('B', 100, 50), width: 200, height: 100 },
      { ...entity('C', 200, 100), width: 200, height: 100 },
    ];
    const index = buildAdjacencyIndex([]);

    const result = computeCollapseToSubgraph(['B', 'C'], 'frame-1', entities, index);

    // Position should be min(100,200)-padding, min(50,100)-padding
    expect(result.frameEntity.position.x).toBe(100 - 40);
    expect(result.frameEntity.position.y).toBe(50 - 40);
    // Width should be max(100+200, 200+200) - min(100,200) + 2*padding
    expect(result.frameEntity.width).toBe(400 - 100 + 80);
    expect(result.frameEntity.height).toBe(200 - 50 + 80);
  });

  it('collapses a single entity', () => {
    const entities = [entity('A'), entity('B', 100, 0), entity('C', 200, 0)];
    entities[0].outputs = [{ id: 'out', name: 'Out', type: 'float' }];
    entities[1].inputs = [{ id: 'in', name: 'In', type: 'float' }];
    entities[1].outputs = [{ id: 'out', name: 'Out', type: 'float' }];
    entities[2].inputs = [{ id: 'in', name: 'In', type: 'float' }];

    const edges = [
      edge('e1', 'A', 'B', 'out', 'in'),
      edge('e2', 'B', 'C', 'out', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeCollapseToSubgraph(['B'], 'frame-1', entities, index);

    expect(result.removeEdgeIds.sort()).toEqual(['e1', 'e2']);
    expect(result.frameInputs).toHaveLength(1);
    expect(result.frameOutputs).toHaveLength(1);
    expect(result.newEdges).toHaveLength(2);
    expect(result.frameEntity.childIds).toEqual(['B']);
  });

  it('deduplicates boundary edges to same internal socket', () => {
    // A → B and C → B (same internal socket), then B → D
    const entities = [
      { ...entity('A'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('B', 100, 0), inputs: [{ id: 'in', name: 'In', type: 'float' }], outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('C'), outputs: [{ id: 'out', name: 'Out', type: 'float' }] },
      { ...entity('D', 200, 0), inputs: [{ id: 'in', name: 'In', type: 'float' }] },
    ];
    const edges = [
      edge('e1', 'A', 'B', 'out', 'in'),
      edge('e2', 'C', 'B', 'out', 'in'),
      edge('e3', 'B', 'D', 'out', 'in'),
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeCollapseToSubgraph(['B'], 'frame-1', entities, index);

    // Two incoming boundary edges to same socket → 1 frame input port (deduped)
    expect(result.frameInputs).toHaveLength(1);
    // But 2 new edges (A→frame, C→frame) both targeting same frame port
    expect(result.newEdges.filter((e) => e.target === 'frame-1')).toHaveLength(2);
  });

  it('stores childIds correctly', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const index = buildAdjacencyIndex([]);

    const result = computeCollapseToSubgraph(['A', 'B', 'C'], 'frame-1', entities, index);
    expect(result.frameEntity.childIds.sort()).toEqual(['A', 'B', 'C']);
  });
});

// ============================================================================
// computeExpandSubgraph
// ============================================================================

describe('computeExpandSubgraph', () => {
  it('expands a frame entity back to its children', () => {
    // Current state: A → frame-1 → D (frame contains B, C)
    const edges = [
      edge('e-in', 'A', 'frame-1', 'out', 'gin-0'),
      edge('e-out', 'frame-1', 'D', 'gout-0', 'in'),
    ];
    const entities = [
      entity('A'),
      { ...entity('frame-1'), type: 'frame' },
      entity('D'),
    ];
    const index = buildAdjacencyIndex(edges);

    const childEntities = [entity('B'), entity('C')];
    const internalEdges = [edge('e2', 'B', 'C', 'out', 'in')];
    const portMapping = {
      inputs: [{ framePortId: 'gin-0', originalEntityId: 'B', originalSocketId: 'in' }],
      outputs: [{ framePortId: 'gout-0', originalEntityId: 'C', originalSocketId: 'out' }],
    };

    const result = computeExpandSubgraph('frame-1', childEntities, internalEdges, entities, index, portMapping);

    expect(result.removeEntityId).toBe('frame-1');
    expect(result.removeEdgeIds.sort()).toEqual(['e-in', 'e-out']);
    expect(result.restoreEntities).toEqual(childEntities);
    expect(result.restoreEdges).toEqual(internalEdges);

    // Reconnected edges: A→B and C→D
    expect(result.reconnectEdges).toHaveLength(2);
    const reconnectSources = result.reconnectEdges.map((e) => e.source);
    const reconnectTargets = result.reconnectEdges.map((e) => e.target);
    expect(reconnectSources).toContain('A');
    expect(reconnectSources).toContain('C');
    expect(reconnectTargets).toContain('B');
    expect(reconnectTargets).toContain('D');
  });

  it('handles frame with no external connections', () => {
    const entities = [{ ...entity('frame-1'), type: 'frame' }];
    const index = buildAdjacencyIndex([]);

    const result = computeExpandSubgraph(
      'frame-1',
      [entity('B'), entity('C')],
      [edge('e1', 'B', 'C')],
      entities,
      index,
      { inputs: [], outputs: [] }
    );

    expect(result.removeEntityId).toBe('frame-1');
    expect(result.removeEdgeIds).toEqual([]);
    expect(result.reconnectEdges).toEqual([]);
    expect(result.restoreEntities).toHaveLength(2);
    expect(result.restoreEdges).toHaveLength(1);
  });

  it('handles frame with only input connections', () => {
    const edges = [edge('e-in', 'A', 'frame-1', 'out', 'gin-0')];
    const entities = [
      entity('A'),
      { ...entity('frame-1'), type: 'frame' },
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeExpandSubgraph(
      'frame-1',
      [entity('B')],
      [],
      entities,
      index,
      {
        inputs: [{ framePortId: 'gin-0', originalEntityId: 'B', originalSocketId: 'in' }],
        outputs: [],
      }
    );

    expect(result.removeEdgeIds).toEqual(['e-in']);
    expect(result.reconnectEdges).toHaveLength(1);
    expect(result.reconnectEdges[0].source).toBe('A');
    expect(result.reconnectEdges[0].target).toBe('B');
    expect(result.reconnectEdges[0].targetSocket).toBe('in');
  });

  it('handles frame with only output connections', () => {
    const edges = [edge('e-out', 'frame-1', 'D', 'gout-0', 'in')];
    const entities = [
      { ...entity('frame-1'), type: 'frame' },
      entity('D'),
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeExpandSubgraph(
      'frame-1',
      [entity('C')],
      [],
      entities,
      index,
      {
        inputs: [],
        outputs: [{ framePortId: 'gout-0', originalEntityId: 'C', originalSocketId: 'out' }],
      }
    );

    expect(result.removeEdgeIds).toEqual(['e-out']);
    expect(result.reconnectEdges).toHaveLength(1);
    expect(result.reconnectEdges[0].source).toBe('C');
    expect(result.reconnectEdges[0].sourceSocket).toBe('out');
    expect(result.reconnectEdges[0].target).toBe('D');
  });

  it('handles missing port mapping gracefully', () => {
    // Edge connects to frame port not in the mapping
    const edges = [edge('e-in', 'A', 'frame-1', 'out', 'unmapped-port')];
    const entities = [
      entity('A'),
      { ...entity('frame-1'), type: 'frame' },
    ];
    const index = buildAdjacencyIndex(edges);

    const result = computeExpandSubgraph(
      'frame-1',
      [entity('B')],
      [],
      entities,
      index,
      { inputs: [], outputs: [] } // no mapping for 'unmapped-port'
    );

    expect(result.removeEdgeIds).toEqual(['e-in']);
    // No reconnect because port has no mapping
    expect(result.reconnectEdges).toEqual([]);
  });

  it('restores multiple children with internal edges', () => {
    const entities = [{ ...entity('frame-1'), type: 'frame' }];
    const index = buildAdjacencyIndex([]);

    const children = [entity('B'), entity('C'), entity('D')];
    const internalEdges = [
      edge('e1', 'B', 'C', 'out', 'in'),
      edge('e2', 'C', 'D', 'out', 'in'),
    ];

    const result = computeExpandSubgraph(
      'frame-1',
      children,
      internalEdges,
      entities,
      index,
      { inputs: [], outputs: [] }
    );

    expect(result.restoreEntities).toHaveLength(3);
    expect(result.restoreEdges).toHaveLength(2);
  });
});
