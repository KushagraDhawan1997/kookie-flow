import type { Node, Edge, XYPosition, Viewport, SocketHandle, EdgeType } from '../types';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_RADIUS,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
  SOCKET_HIT_TOLERANCE,
} from '../core/constants';
import type { ResolvedSocketLayout } from './style-resolver';

/**
 * Convert screen coordinates to world coordinates.
 */
export function screenToWorld(
  screenPos: XYPosition,
  viewport: Viewport
): XYPosition {
  return {
    x: (screenPos.x - viewport.x) / viewport.zoom,
    y: (screenPos.y - viewport.y) / viewport.zoom,
  };
}

/**
 * Convert world coordinates to screen coordinates.
 */
export function worldToScreen(
  worldPos: XYPosition,
  viewport: Viewport
): XYPosition {
  return {
    x: worldPos.x * viewport.zoom + viewport.x,
    y: worldPos.y * viewport.zoom + viewport.y,
  };
}

/**
 * Check if a point is inside a node's bounds.
 */
export function isPointInNode(
  point: XYPosition,
  node: Node
): boolean {
  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;

  return (
    point.x >= node.position.x &&
    point.x <= node.position.x + width &&
    point.y >= node.position.y &&
    point.y <= node.position.y + height
  );
}

/**
 * Find the topmost node at a given world position.
 * Returns null if no node is at that position.
 * Nodes later in the array are considered "on top".
 */
export function getNodeAtPosition(
  worldPos: XYPosition,
  nodes: Node[]
): Node | null {
  // Iterate in reverse to find topmost node first
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (isPointInNode(worldPos, nodes[i])) {
      return nodes[i];
    }
  }
  return null;
}

/**
 * Check if two axis-aligned bounding boxes intersect.
 */
export function boxesIntersect(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    box1.x < box2.x + box2.width &&
    box1.x + box1.width > box2.x &&
    box1.y < box2.y + box2.height &&
    box1.y + box1.height > box2.y
  );
}

/**
 * Get all nodes that intersect with a selection box.
 */
export function getNodesInBox(
  start: XYPosition,
  end: XYPosition,
  nodes: Node[]
): Node[] {
  // Normalize the box (handle any drag direction)
  const boxX = Math.min(start.x, end.x);
  const boxY = Math.min(start.y, end.y);
  const boxWidth = Math.abs(end.x - start.x);
  const boxHeight = Math.abs(end.y - start.y);

  const selectionBox = {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };

  return nodes.filter((node) => {
    const nodeBox = {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT,
    };
    return boxesIntersect(selectionBox, nodeBox);
  });
}

/**
 * Calculate world position of a socket on a node.
 * Inputs are on the left edge, outputs on the right edge.
 *
 * Layout order (when using ResolvedSocketLayout):
 *   Header (if inside) → Output rows → Input rows
 *
 * @param node - The node containing the socket
 * @param socketId - The ID of the socket to find
 * @param isInput - Whether this is an input socket (left side) or output (right side)
 * @param layout - Optional resolved socket layout for tokenized positioning.
 *                 When provided, uses rowHeight-based positioning.
 *                 When omitted, falls back to legacy SOCKET_SPACING constants.
 */
export function getSocketPosition(
  node: Node,
  socketId: string,
  isInput: boolean,
  layout?: ResolvedSocketLayout
): XYPosition | null {
  const sockets = isInput ? node.inputs : node.outputs;
  if (!sockets) return null;

  const index = sockets.findIndex((s) => s.id === socketId);
  if (index === -1) return null;

  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;

  // Use socket.position if defined (0-1 range), otherwise calculate from index
  const socket = sockets[index];
  let yOffset: number;

  if (socket.position !== undefined) {
    // Explicit position overrides layout calculation
    yOffset = socket.position * height;
  } else if (layout) {
    // New tokenized layout: outputs first, then inputs
    // Y = marginTop + (rowIndex * rowHeight) + (rowHeight / 2) for vertical centering
    const outputCount = node.outputs?.length ?? 0;
    const rowIndex = isInput ? outputCount + index : index;
    yOffset = layout.marginTop + rowIndex * layout.rowHeight + layout.rowHeight / 2;
  } else {
    // Legacy fallback for backward compatibility
    yOffset = SOCKET_MARGIN_TOP + index * SOCKET_SPACING;
  }

  return {
    x: isInput ? node.position.x : node.position.x + width,
    y: node.position.y + yOffset,
  };
}

/**
 * Find socket at a world position.
 * Uses brute force with viewport culling - performant for typical socket counts.
 *
 * @param worldPos - World position to test
 * @param nodes - All nodes to check
 * @param viewport - Current viewport for culling
 * @param canvasSize - Canvas dimensions for culling
 * @param layout - Optional resolved socket layout for tokenized positioning
 */
export function getSocketAtPosition(
  worldPos: XYPosition,
  nodes: Node[],
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  layout?: ResolvedSocketLayout
): SocketHandle | null {
  const socketSize = layout?.socketSize ?? SOCKET_RADIUS;
  const hitRadius = socketSize + SOCKET_HIT_TOLERANCE;
  const hitRadiusSq = hitRadius * hitRadius;

  // Viewport bounds for culling
  const invZoom = 1 / viewport.zoom;
  const viewLeft = -viewport.x * invZoom;
  const viewRight = (canvasSize.width - viewport.x) * invZoom;
  const viewTop = -viewport.y * invZoom;
  const viewBottom = (canvasSize.height - viewport.y) * invZoom;
  const padding = 50;

  // Iterate in reverse for z-ordering (topmost node first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const width = node.width ?? DEFAULT_NODE_WIDTH;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;

    // Skip nodes outside viewport
    if (
      node.position.x + width < viewLeft - padding ||
      node.position.x > viewRight + padding ||
      node.position.y + height < viewTop - padding ||
      node.position.y > viewBottom + padding
    ) {
      continue;
    }

    // Check input sockets
    if (node.inputs) {
      for (const socket of node.inputs) {
        const pos = getSocketPosition(node, socket.id, true, layout);
        if (!pos) continue;

        const dx = worldPos.x - pos.x;
        const dy = worldPos.y - pos.y;
        if (dx * dx + dy * dy < hitRadiusSq) {
          return { nodeId: node.id, socketId: socket.id, isInput: true };
        }
      }
    }

    // Check output sockets
    if (node.outputs) {
      for (const socket of node.outputs) {
        const pos = getSocketPosition(node, socket.id, false, layout);
        if (!pos) continue;

        const dx = worldPos.x - pos.x;
        const dy = worldPos.y - pos.y;
        if (dx * dx + dy * dy < hitRadiusSq) {
          return { nodeId: node.id, socketId: socket.id, isInput: false };
        }
      }
    }
  }

  return null;
}

/** Hit tolerance for edge selection (pixels in world space) */
const EDGE_HIT_TOLERANCE = 8;

/** Number of samples for bezier hit testing */
const EDGE_HIT_SAMPLES = 32;

/**
 * Calculate bezier control points for an edge.
 * Matches the edge rendering logic in edges.tsx.
 */
function getEdgeBezierPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  edgeType: EdgeType
): { cx1: number; cy1: number; cx2: number; cy2: number } {
  const dx = x1 - x0;
  const absDx = Math.abs(dx);

  if (edgeType === 'straight') {
    return { cx1: x0, cy1: y0, cx2: x1, cy2: y1 };
  } else if (edgeType === 'smoothstep') {
    const offset = Math.min(absDx * 0.5, 100);
    return { cx1: x0 + offset, cy1: y0, cx2: x1 - offset, cy2: y1 };
  } else {
    // Bezier: adaptive offset based on distance
    const distance = Math.sqrt(dx * dx + (y1 - y0) ** 2);
    const baseOffset = Math.min(absDx * 0.5, distance * 0.4);
    const offset = Math.max(baseOffset, Math.min(absDx * 0.25, 20));
    return { cx1: x0 + offset, cy1: y0, cx2: x1 - offset, cy2: y1 };
  }
}

/**
 * Sample a cubic bezier curve at parameter t.
 */
function sampleBezier(
  x0: number, y0: number,
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  x1: number, y1: number,
  t: number
): XYPosition {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * x0 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * x1,
    y: mt3 * y0 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * y1,
  };
}

/**
 * Calculate minimum distance from a point to a bezier curve (sampled).
 */
function pointToBezierDistance(
  point: XYPosition,
  x0: number, y0: number,
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  x1: number, y1: number
): number {
  let minDistSq = Infinity;

  for (let i = 0; i <= EDGE_HIT_SAMPLES; i++) {
    const t = i / EDGE_HIT_SAMPLES;
    const sample = sampleBezier(x0, y0, cx1, cy1, cx2, cy2, x1, y1, t);
    const dx = point.x - sample.x;
    const dy = point.y - sample.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
    }
  }

  return Math.sqrt(minDistSq);
}

/**
 * Calculate minimum distance from a point to a step edge.
 * Inlined to avoid array allocation in hot path.
 */
function pointToStepDistance(
  point: XYPosition,
  x0: number, y0: number,
  x1: number, y1: number
): number {
  const midX = x0 + (x1 - x0) / 2;

  // Three line segments: (x0,y0)->(midX,y0), (midX,y0)->(midX,y1), (midX,y1)->(x1,y1)
  // Inline distance calculations to avoid array allocation
  const d1 = pointToSegmentDistanceSq(point, x0, y0, midX, y0);
  const d2 = pointToSegmentDistanceSq(point, midX, y0, midX, y1);
  const d3 = pointToSegmentDistanceSq(point, midX, y1, x1, y1);

  return Math.sqrt(Math.min(d1, d2, d3));
}

/**
 * Calculate squared distance from a point to a line segment.
 */
function pointToSegmentDistanceSq(
  point: XYPosition,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point
    const pdx = point.x - ax;
    const pdy = point.y - ay;
    return pdx * pdx + pdy * pdy;
  }

  // Project point onto line, clamped to segment
  const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;

  const pdx = point.x - projX;
  const pdy = point.y - projY;
  return pdx * pdx + pdy * pdy;
}

/** Socket info for O(1) lookup */
export type SocketIndexMap = Map<string, { index: number; socket: { id: string; type: string; position?: number } }>;

/**
 * Calculate socket Y offset for edge positioning.
 * Supports both legacy constants and new tokenized layout.
 *
 * @param node - The node containing the socket
 * @param socketId - The socket ID to find
 * @param isInput - Whether this is an input socket
 * @param socketIndexMap - Optional map for O(1) lookups
 * @param layout - Optional resolved socket layout for tokenized positioning
 * @returns Y offset from node top, or nodeHeight/2 as fallback
 */
function calculateSocketYOffset(
  node: Node,
  socketId: string | undefined,
  isInput: boolean,
  socketIndexMap?: SocketIndexMap,
  layout?: ResolvedSocketLayout
): number {
  const nodeHeight = node.height ?? DEFAULT_NODE_HEIGHT;

  if (!socketId) {
    return nodeHeight / 2;
  }

  const sockets = isInput ? node.inputs : node.outputs;

  // Try socketIndexMap first (O(1))
  if (socketIndexMap) {
    const key = `${node.id}:${socketId}:${isInput ? 'input' : 'output'}`;
    const socketInfo = socketIndexMap.get(key);
    if (socketInfo) {
      if (socketInfo.socket.position !== undefined) {
        return socketInfo.socket.position * nodeHeight;
      }
      if (layout) {
        // New tokenized layout: outputs first, then inputs
        const outputCount = node.outputs?.length ?? 0;
        const rowIndex = isInput ? outputCount + socketInfo.index : socketInfo.index;
        return layout.marginTop + rowIndex * layout.rowHeight + layout.rowHeight / 2;
      }
      // Legacy fallback
      return SOCKET_MARGIN_TOP + socketInfo.index * SOCKET_SPACING;
    }
  }

  // Fallback to O(k) findIndex
  if (sockets) {
    const socketIndex = sockets.findIndex(s => s.id === socketId);
    if (socketIndex !== -1) {
      const socket = sockets[socketIndex];
      if (socket.position !== undefined) {
        return socket.position * nodeHeight;
      }
      if (layout) {
        const outputCount = node.outputs?.length ?? 0;
        const rowIndex = isInput ? outputCount + socketIndex : socketIndex;
        return layout.marginTop + rowIndex * layout.rowHeight + layout.rowHeight / 2;
      }
      // Legacy fallback
      return SOCKET_MARGIN_TOP + socketIndex * SOCKET_SPACING;
    }
  }

  return nodeHeight / 2;
}

/**
 * Find edge at a world position.
 * Returns the edge closest to the point if within hit tolerance.
 *
 * @param socketIndexMap - Optional pre-built map for O(1) socket lookups.
 *                         Key format: "${nodeId}:${socketId}:input|output"
 *                         If not provided, falls back to O(k) findIndex per edge.
 * @param layout - Optional resolved socket layout for tokenized positioning
 */
export function getEdgeAtPosition(
  worldPos: XYPosition,
  edges: Edge[],
  nodeMap: Map<string, Node>,
  defaultEdgeType: EdgeType = 'bezier',
  viewport: Viewport,
  socketIndexMap?: SocketIndexMap,
  layout?: ResolvedSocketLayout
): Edge | null {
  // Scale hit tolerance with zoom for consistent screen-space feel
  const hitTolerance = EDGE_HIT_TOLERANCE / viewport.zoom;
  let closestEdge: Edge | null = null;
  let closestDist = hitTolerance;

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;

    // Calculate socket Y offsets using helper function
    const sourceYOffset = calculateSocketYOffset(sourceNode, edge.sourceSocket, false, socketIndexMap, layout);
    const targetYOffset = calculateSocketYOffset(targetNode, edge.targetSocket, true, socketIndexMap, layout);

    const x0 = sourceNode.position.x + sourceWidth;
    const y0 = sourceNode.position.y + sourceYOffset;
    const x1 = targetNode.position.x;
    const y1 = targetNode.position.y + targetYOffset;

    // Quick bounding box check
    const minX = Math.min(x0, x1) - hitTolerance;
    const maxX = Math.max(x0, x1) + hitTolerance;
    const minY = Math.min(y0, y1) - hitTolerance;
    const maxY = Math.max(y0, y1) + hitTolerance;

    if (worldPos.x < minX || worldPos.x > maxX || worldPos.y < minY || worldPos.y > maxY) {
      continue;
    }

    const edgeType = edge.type ?? defaultEdgeType;
    let dist: number;

    if (edgeType === 'step') {
      dist = pointToStepDistance(worldPos, x0, y0, x1, y1);
    } else if (edgeType === 'straight') {
      dist = Math.sqrt(pointToSegmentDistanceSq(worldPos, x0, y0, x1, y1));
    } else {
      const { cx1, cy1, cx2, cy2 } = getEdgeBezierPoints(x0, y0, x1, y1, edgeType);
      dist = pointToBezierDistance(worldPos, x0, y0, cx1, cy1, cx2, cy2, x1, y1);
    }

    if (dist < closestDist) {
      closestDist = dist;
      closestEdge = edge;
    }
  }

  return closestEdge;
}

/** Result of edge point calculation */
export interface EdgePointResult {
  /** Position on the edge */
  position: XYPosition;
  /** Tangent direction (unit vector) at that point */
  tangent: XYPosition;
  /** Angle in radians (atan2 of tangent) */
  angle: number;
}

/**
 * Calculate the derivative (tangent) of a cubic bezier at parameter t.
 */
function bezierTangent(
  x0: number, y0: number,
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  x1: number, y1: number,
  t: number
): XYPosition {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  // Derivative of cubic bezier: 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
  const dx = 3 * mt2 * (cx1 - x0) + 6 * mt * t * (cx2 - cx1) + 3 * t2 * (x1 - cx2);
  const dy = 3 * mt2 * (cy1 - y0) + 6 * mt * t * (cy2 - cy1) + 3 * t2 * (y1 - cy2);

  return { x: dx, y: dy };
}

/**
 * Get a point and tangent along an edge at parameter t (0 = start, 1 = end).
 * Works with all edge types (bezier, smoothstep, step, straight).
 *
 * @param layout - Optional resolved socket layout for tokenized positioning
 */
export function getEdgePointAtT(
  edge: Edge,
  nodeMap: Map<string, Node>,
  t: number,
  defaultEdgeType: EdgeType = 'bezier',
  socketIndexMap?: SocketIndexMap,
  layout?: ResolvedSocketLayout
): EdgePointResult | null {
  const sourceNode = nodeMap.get(edge.source);
  const targetNode = nodeMap.get(edge.target);
  if (!sourceNode || !targetNode) return null;

  const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;

  // Calculate socket Y offsets using helper function
  const sourceYOffset = calculateSocketYOffset(sourceNode, edge.sourceSocket, false, socketIndexMap, layout);
  const targetYOffset = calculateSocketYOffset(targetNode, edge.targetSocket, true, socketIndexMap, layout);

  const x0 = sourceNode.position.x + sourceWidth;
  const y0 = sourceNode.position.y + sourceYOffset;
  const x1 = targetNode.position.x;
  const y1 = targetNode.position.y + targetYOffset;

  const edgeType = edge.type ?? defaultEdgeType;

  let position: XYPosition;
  let tangent: XYPosition;

  if (edgeType === 'straight') {
    // Linear interpolation
    position = {
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t,
    };
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    tangent = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
  } else if (edgeType === 'step') {
    // Step edge: 3 segments
    const midX = x0 + (x1 - x0) / 2;

    if (t < 1/3) {
      // First horizontal segment
      const segT = t * 3;
      position = { x: x0 + (midX - x0) * segT, y: y0 };
      tangent = { x: 1, y: 0 };
    } else if (t < 2/3) {
      // Vertical segment
      const segT = (t - 1/3) * 3;
      position = { x: midX, y: y0 + (y1 - y0) * segT };
      tangent = { x: 0, y: y1 > y0 ? 1 : -1 };
    } else {
      // Second horizontal segment
      const segT = (t - 2/3) * 3;
      position = { x: midX + (x1 - midX) * segT, y: y1 };
      tangent = { x: 1, y: 0 };
    }
  } else {
    // Bezier or smoothstep
    const { cx1, cy1, cx2, cy2 } = getEdgeBezierPoints(x0, y0, x1, y1, edgeType);
    position = sampleBezier(x0, y0, cx1, cy1, cx2, cy2, x1, y1, t);
    const rawTangent = bezierTangent(x0, y0, cx1, cy1, cx2, cy2, x1, y1, t);
    const len = Math.sqrt(rawTangent.x * rawTangent.x + rawTangent.y * rawTangent.y);
    tangent = len > 0 ? { x: rawTangent.x / len, y: rawTangent.y / len } : { x: 1, y: 0 };
  }

  const angle = Math.atan2(tangent.y, tangent.x);

  return { position, tangent, angle };
}

/**
 * Get edge endpoint positions and tangents for marker rendering.
 * Returns start (t=0) and end (t=1) points with tangent directions.
 *
 * @param layout - Optional resolved socket layout for tokenized positioning
 */
export function getEdgeEndpoints(
  edge: Edge,
  nodeMap: Map<string, Node>,
  defaultEdgeType: EdgeType = 'bezier',
  socketIndexMap?: SocketIndexMap,
  layout?: ResolvedSocketLayout
): { start: EdgePointResult; end: EdgePointResult } | null {
  const start = getEdgePointAtT(edge, nodeMap, 0, defaultEdgeType, socketIndexMap, layout);
  const end = getEdgePointAtT(edge, nodeMap, 1, defaultEdgeType, socketIndexMap, layout);

  if (!start || !end) return null;

  return { start, end };
}
