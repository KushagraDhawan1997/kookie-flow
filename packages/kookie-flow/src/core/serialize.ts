/**
 * The graph as data you can save.
 *
 * A board is a live thing — something is selected, something is being dragged, a group is
 * collapsed because of what someone did a second ago. Almost none of that belongs in a file. This
 * decides what survives being written down, and the rule is: state that a person's next click
 * would change is not saved; state that describes the graph is.
 *
 * What comes out here is what `<KookieFlow entities edges>` takes back in, so a round trip is a
 * round trip and not a shape the library merely tolerates.
 */

import type { Edge, Entity, Viewport } from '../types';

/** A whole graph, ready to be written to a file or a server. */
export interface FlowObject {
  entities: Entity[];
  edges: Edge[];
  viewport: Viewport;
}

/**
 * `selected` and `dragging` mirror what the pointer is doing this instant. Saving them means a
 * reload comes back with three nodes highlighted and one that believes it is mid-drag.
 */
function withoutViewState(entity: Entity): Entity {
  if (entity.selected === undefined && entity.dragging === undefined) return entity;
  const { selected: _selected, dragging: _dragging, ...rest } = entity;
  return rest;
}

function edgeWithoutViewState(edge: Edge): Edge {
  if (edge.selected === undefined) return edge;
  const { selected: _selected, ...rest } = edge;
  return rest;
}

/**
 * Everything needed to restore this graph, and nothing that describes the moment.
 *
 * Entity objects are reused where there was nothing to strip, so saving a large board allocates
 * only for the entities that were actually being interacted with.
 */
export function toFlowObject(
  entities: readonly Entity[],
  edges: readonly Edge[],
  viewport: Viewport
): FlowObject {
  return {
    entities: entities.map(withoutViewState),
    edges: edges.map(edgeWithoutViewState),
    // Copied: the store's viewport object is live and would keep moving under a saved snapshot.
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
}
