import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { EDGE_COLORS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';
import type { Node } from '../types';

// Buffer growth factor
const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_EDGE_CAPACITY = 512;

/**
 * High-performance edge renderer using BufferGeometry.
 * Key optimizations:
 * - Pre-allocated, reusable buffers (no GC pressure)
 * - Direct GPU buffer updates (bypasses React)
 * - Viewport frustum culling for edges
 * - Dirty flag to skip unnecessary updates
 */
export function Edges() {
  const store = useFlowStoreApi();
  const lineRef = useRef<THREE.LineSegments>(null);

  // Pre-allocated buffers
  const buffersRef = useRef<{
    capacity: number;
    positions: Float32Array;
    colors: Float32Array;
    positionAttr: THREE.BufferAttribute | null;
    colorAttr: THREE.BufferAttribute | null;
    lastEdgeCount: number;
  }>({
    capacity: INITIAL_EDGE_CAPACITY,
    positions: new Float32Array(INITIAL_EDGE_CAPACITY * 6), // 2 vertices * 3 components per edge
    colors: new Float32Array(INITIAL_EDGE_CAPACITY * 6),    // 2 vertices * 3 components per edge
    positionAttr: null,
    colorAttr: null,
    lastEdgeCount: 0,
  });

  // Node map for O(1) lookups - updated via subscription
  const nodeMapRef = useRef<Map<string, Node>>(new Map());

  // Dirty flag
  const dirtyRef = useRef(true);

  // Pre-computed colors
  const defaultColor = useMemo(() => new THREE.Color(EDGE_COLORS.default), []);
  const selectedColor = useMemo(() => new THREE.Color(EDGE_COLORS.selected), []);

  // Ensure buffer capacity - returns true if buffers were resized
  const ensureCapacity = (needed: number, line: THREE.LineSegments): boolean => {
    const buffers = buffersRef.current;
    if (needed <= buffers.capacity) return false;

    const newCapacity = Math.ceil(needed * BUFFER_GROWTH_FACTOR);

    // Allocate new buffers
    const newPositions = new Float32Array(newCapacity * 6);
    const newColors = new Float32Array(newCapacity * 6);

    // Copy existing data
    if (buffers.lastEdgeCount > 0) {
      newPositions.set(buffers.positions.subarray(0, buffers.lastEdgeCount * 6));
      newColors.set(buffers.colors.subarray(0, buffers.lastEdgeCount * 6));
    }

    buffers.positions = newPositions;
    buffers.colors = newColors;
    buffers.capacity = newCapacity;

    // Recreate attributes with new buffers AND attach to geometry
    buffers.positionAttr = new THREE.BufferAttribute(newPositions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(newColors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);

    line.geometry.setAttribute('position', buffers.positionAttr);
    line.geometry.setAttribute('color', buffers.colorAttr);

    return true;
  };

  // Initialize and subscribe
  useEffect(() => {
    if (!lineRef.current) return;

    const buffers = buffersRef.current;
    const line = lineRef.current;

    // Create initial attributes
    buffers.positionAttr = new THREE.BufferAttribute(buffers.positions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(buffers.colors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);

    line.geometry.setAttribute('position', buffers.positionAttr);
    line.geometry.setAttribute('color', buffers.colorAttr);

    // Subscribe to changes
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (nodes) => {
        // Update node map
        nodeMapRef.current.clear();
        nodes.forEach((n) => nodeMapRef.current.set(n.id, n));
        dirtyRef.current = true;
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      () => { dirtyRef.current = true; }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
    const unsubSelection = store.subscribe(
      (state) => state.selectedEdgeIds,
      () => { dirtyRef.current = true; }
    );

    // Initialize node map
    const { nodes } = store.getState();
    nodes.forEach((n) => nodeMapRef.current.set(n.id, n));

    return () => {
      unsubNodes();
      unsubEdges();
      unsubViewport();
      unsubSelection();
    };
  }, [store]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    if (!lineRef.current || !dirtyRef.current) return;

    const { edges, viewport, selectedEdgeIds } = store.getState();
    const nodeMap = nodeMapRef.current;
    const buffers = buffersRef.current;
    const line = lineRef.current;

    if (edges.length === 0 || nodeMap.size === 0) {
      line.geometry.setDrawRange(0, 0);
      dirtyRef.current = false;
      return;
    }

    // Ensure capacity (pass line to attach new attributes if resized)
    ensureCapacity(edges.length, line);

    // Viewport bounds for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 300;

    let visibleCount = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) continue;

      const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;
      const sourceHeight = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
      const targetWidth = targetNode.width ?? DEFAULT_NODE_WIDTH;
      const targetHeight = targetNode.height ?? DEFAULT_NODE_HEIGHT;

      // Edge endpoints in world space
      const sourceX = sourceNode.position.x + sourceWidth;
      const sourceY = sourceNode.position.y + sourceHeight / 2;
      const targetX = targetNode.position.x;
      const targetY = targetNode.position.y + targetHeight / 2;

      // Frustum culling - check if edge bounding box intersects viewport
      const edgeMinX = Math.min(sourceX, targetX);
      const edgeMaxX = Math.max(sourceX, targetX);
      const edgeMinY = Math.min(sourceY, targetY);
      const edgeMaxY = Math.max(sourceY, targetY);

      if (
        edgeMaxX < viewLeft - cullPadding ||
        edgeMinX > viewRight + cullPadding ||
        edgeMaxY < viewTop - cullPadding ||
        edgeMinY > viewBottom + cullPadding
      ) {
        continue; // Skip - not visible
      }

      // Write position data (z=1 to render above grid which is at z=0)
      const posOffset = visibleCount * 6;
      buffers.positions[posOffset] = sourceX;
      buffers.positions[posOffset + 1] = -sourceY; // Flip Y
      buffers.positions[posOffset + 2] = 1; // Above grid
      buffers.positions[posOffset + 3] = targetX;
      buffers.positions[posOffset + 4] = -targetY; // Flip Y
      buffers.positions[posOffset + 5] = 1; // Above grid

      // Write color data - query selection Set for O(1) lookup
      const color = selectedEdgeIds.has(edge.id) ? selectedColor : defaultColor;
      buffers.colors[posOffset] = color.r;
      buffers.colors[posOffset + 1] = color.g;
      buffers.colors[posOffset + 2] = color.b;
      buffers.colors[posOffset + 3] = color.r;
      buffers.colors[posOffset + 4] = color.g;
      buffers.colors[posOffset + 5] = color.b;

      visibleCount++;
    }

    // Update attributes
    if (buffers.positionAttr && buffers.colorAttr) {
      buffers.positionAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
    }

    // Set draw range instead of recreating geometry
    line.geometry.setDrawRange(0, visibleCount * 2);
    buffers.lastEdgeCount = visibleCount;
    dirtyRef.current = false;
  });

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry />
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.8}
        depthWrite={false}
        depthTest={false}
      />
    </lineSegments>
  );
}
