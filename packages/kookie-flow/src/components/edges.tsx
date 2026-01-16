import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { EDGE_COLORS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';
import type { Node, EdgeType } from '../types';

// Buffer sizing
const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_EDGE_CAPACITY = 512;

// Tessellation settings
const SEGMENTS_PER_EDGE = 64;
// Each segment = 1 quad = 2 triangles = 6 vertices
const VERTICES_PER_EDGE = SEGMENTS_PER_EDGE * 6;

// Edge visual settings
const EDGE_WIDTH = 2.5; // pixels in world space
const AA_SMOOTHNESS = 3.0; // anti-aliasing edge softness (higher = softer edges)

interface EdgesProps {
  defaultEdgeType?: EdgeType;
}

// Vertex shader - passes position and UV to fragment
const vertexShader = /* glsl */ `
  attribute vec2 uv2;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vUv = uv2;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader - applies color with anti-aliased edges
const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;

  uniform float uAASmooth;

  void main() {
    // vUv.y goes from -1 to 1 across the width
    // Anti-alias based on distance from center
    float dist = abs(vUv.y);
    float alpha = 1.0 - smoothstep(1.0 - uAASmooth, 1.0, dist);

    gl_FragColor = vec4(vColor, alpha * 0.9);
  }
`;

/**
 * High-performance mesh-based edge renderer.
 *
 * Uses triangle strips (ribbons) with custom ShaderMaterial for:
 * - Configurable line width
 * - Anti-aliased edges via SDF
 * - Future effects: glow, animation, gradients, dashes
 *
 * Key optimizations:
 * - Pre-allocated, reusable buffers (no GC pressure)
 * - Single draw call (all edges batched)
 * - Dirty flag to skip unnecessary updates
 */
export function Edges({ defaultEdgeType = 'bezier' }: EdgesProps) {
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.Mesh>(null);

  // Pre-allocated buffers
  const buffersRef = useRef<{
    capacity: number;
    positions: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    positionAttr: THREE.BufferAttribute | null;
    uvAttr: THREE.BufferAttribute | null;
    colorAttr: THREE.BufferAttribute | null;
    lastVertexCount: number;
  }>({
    capacity: INITIAL_EDGE_CAPACITY,
    positions: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    uvs: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 2),
    colors: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    positionAttr: null,
    uvAttr: null,
    colorAttr: null,
    lastVertexCount: 0,
  });

  // Node map for O(1) lookups
  const nodeMapRef = useRef<Map<string, Node>>(new Map());

  // Dirty flag
  const dirtyRef = useRef(true);

  // Pre-computed colors
  const defaultColor = useMemo(() => new THREE.Color(EDGE_COLORS.default), []);
  const selectedColor = useMemo(() => new THREE.Color(EDGE_COLORS.selected), []);

  // Shader material
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAASmooth: { value: AA_SMOOTHNESS / 10 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }, []);

  // Ensure buffer capacity
  const ensureCapacity = (neededEdges: number, mesh: THREE.Mesh): boolean => {
    const buffers = buffersRef.current;
    if (neededEdges <= buffers.capacity) return false;

    const newCapacity = Math.ceil(neededEdges * BUFFER_GROWTH_FACTOR);
    const vertexCount = newCapacity * VERTICES_PER_EDGE;

    // Allocate new buffers
    const newPositions = new Float32Array(vertexCount * 3);
    const newUvs = new Float32Array(vertexCount * 2);
    const newColors = new Float32Array(vertexCount * 3);

    // Copy existing data
    const existingVerts = buffers.lastVertexCount;
    if (existingVerts > 0) {
      newPositions.set(buffers.positions.subarray(0, existingVerts * 3));
      newUvs.set(buffers.uvs.subarray(0, existingVerts * 2));
      newColors.set(buffers.colors.subarray(0, existingVerts * 3));
    }

    buffers.positions = newPositions;
    buffers.uvs = newUvs;
    buffers.colors = newColors;
    buffers.capacity = newCapacity;

    // Recreate attributes with new buffers
    buffers.positionAttr = new THREE.BufferAttribute(newPositions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.uvAttr = new THREE.BufferAttribute(newUvs, 2);
    buffers.uvAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(newColors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('position', buffers.positionAttr);
    mesh.geometry.setAttribute('uv2', buffers.uvAttr);
    mesh.geometry.setAttribute('aColor', buffers.colorAttr);

    return true;
  };

  // Initialize and subscribe
  useEffect(() => {
    if (!meshRef.current) return;

    const buffers = buffersRef.current;
    const mesh = meshRef.current;

    // Create initial attributes
    buffers.positionAttr = new THREE.BufferAttribute(buffers.positions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.uvAttr = new THREE.BufferAttribute(buffers.uvs, 2);
    buffers.uvAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(buffers.colors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('position', buffers.positionAttr);
    mesh.geometry.setAttribute('uv2', buffers.uvAttr);
    mesh.geometry.setAttribute('aColor', buffers.colorAttr);

    // Subscribe to changes
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (nodes) => {
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
      material.dispose();
    };
  }, [store, material]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    if (!meshRef.current || !dirtyRef.current) return;

    const { edges, viewport, selectedEdgeIds } = store.getState();
    const nodeMap = nodeMapRef.current;
    const buffers = buffersRef.current;
    const mesh = meshRef.current;

    if (edges.length === 0 || nodeMap.size === 0) {
      mesh.geometry.setDrawRange(0, 0);
      dirtyRef.current = false;
      return;
    }

    // Ensure capacity
    ensureCapacity(edges.length, mesh);

    // Viewport bounds for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    // Padding must scale with zoom to represent consistent screen-space buffer
    // Also account for Bezier curve bulge (curves can extend beyond endpoint bounds)
    const cullPadding = 500 / viewport.zoom;

    // Half-width for ribbon (scaled by zoom for consistent screen-space width)
    const halfWidth = (EDGE_WIDTH / 2) / viewport.zoom;

    let vertexIndex = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) continue;

      const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;
      const sourceHeight = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
      const targetHeight = targetNode.height ?? DEFAULT_NODE_HEIGHT;

      // Edge endpoints
      const x0 = sourceNode.position.x + sourceWidth;
      const y0 = sourceNode.position.y + sourceHeight / 2;
      const x1 = targetNode.position.x;
      const y1 = targetNode.position.y + targetHeight / 2;

      // Frustum culling
      const edgeMinX = Math.min(x0, x1);
      const edgeMaxX = Math.max(x0, x1);
      const edgeMinY = Math.min(y0, y1);
      const edgeMaxY = Math.max(y0, y1);

      if (
        edgeMaxX < viewLeft - cullPadding ||
        edgeMinX > viewRight + cullPadding ||
        edgeMaxY < viewTop - cullPadding ||
        edgeMinY > viewBottom + cullPadding
      ) {
        continue;
      }

      // Get edge type and color
      const edgeType = edge.type ?? defaultEdgeType;
      const color = selectedEdgeIds.has(edge.id) ? selectedColor : defaultColor;
      const cr = color.r, cg = color.g, cb = color.b;

      // Calculate bezier control points
      const dx = x1 - x0;
      const dy = y1 - y0;
      const absDx = Math.abs(dx);

      let cx1: number, cy1: number, cx2: number, cy2: number;

      if (edgeType === 'straight') {
        cx1 = x0; cy1 = y0;
        cx2 = x1; cy2 = y1;
      } else if (edgeType === 'step') {
        // For step, we'll handle it differently below
        cx1 = x0; cy1 = y0;
        cx2 = x1; cy2 = y1;
      } else if (edgeType === 'smoothstep') {
        // Smoothstep: constrained curve, scales with distance
        const offset = Math.min(absDx * 0.5, 100);
        cx1 = x0 + offset; cy1 = y0;
        cx2 = x1 - offset; cy2 = y1;
      } else {
        // Bezier: adaptive offset based on distance
        // - For close nodes, use minimal offset for direct connection
        // - For far nodes, use proportional offset for nice curve
        // - Consider vertical distance too
        const distance = Math.sqrt(dx * dx + dy * dy);
        const baseOffset = Math.min(absDx * 0.5, distance * 0.4);
        const offset = Math.max(baseOffset, Math.min(absDx * 0.25, 20));
        cx1 = x0 + offset; cy1 = y0;
        cx2 = x1 - offset; cy2 = y1;
      }

      // Generate curve points
      const points: { x: number; y: number }[] = [];

      if (edgeType === 'step') {
        // Step: horizontal → vertical → horizontal
        const midX = x0 + dx / 2;
        points.push({ x: x0, y: y0 });
        points.push({ x: midX, y: y0 });
        points.push({ x: midX, y: y1 });
        points.push({ x: x1, y: y1 });
      } else if (edgeType === 'straight') {
        points.push({ x: x0, y: y0 });
        points.push({ x: x1, y: y1 });
      } else {
        // Bezier/smoothstep - sample the curve
        for (let s = 0; s <= SEGMENTS_PER_EDGE; s++) {
          const t = s / SEGMENTS_PER_EDGE;
          const mt = 1 - t;
          const mt2 = mt * mt;
          const mt3 = mt2 * mt;
          const t2 = t * t;
          const t3 = t2 * t;

          const px = mt3 * x0 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * x1;
          const py = mt3 * y0 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * y1;
          points.push({ x: px, y: py });
        }
      }

      // Generate ribbon geometry from points
      for (let p = 0; p < points.length - 1; p++) {
        const p0 = points[p];
        const p1 = points[p + 1];

        // Direction vector
        const dirX = p1.x - p0.x;
        const dirY = p1.y - p0.y;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);

        if (len < 0.001) continue; // Skip degenerate segments

        // Perpendicular (normal) vector
        const normX = -dirY / len;
        const normY = dirX / len;

        // Four corners of the quad
        const p0_top_x = p0.x + normX * halfWidth;
        const p0_top_y = p0.y + normY * halfWidth;
        const p0_bot_x = p0.x - normX * halfWidth;
        const p0_bot_y = p0.y - normY * halfWidth;
        const p1_top_x = p1.x + normX * halfWidth;
        const p1_top_y = p1.y + normY * halfWidth;
        const p1_bot_x = p1.x - normX * halfWidth;
        const p1_bot_y = p1.y - normY * halfWidth;

        // UV coordinates (u = progress, v = -1 to 1 across width)
        const u0 = p / (points.length - 1);
        const u1 = (p + 1) / (points.length - 1);

        // Z position (above grid)
        const z = 1;

        // Triangle 1: p0_top, p0_bot, p1_top
        let posIdx = vertexIndex * 3;
        let uvIdx = vertexIndex * 2;
        let colIdx = vertexIndex * 3;

        buffers.positions[posIdx] = p0_top_x;
        buffers.positions[posIdx + 1] = -p0_top_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        buffers.positions[posIdx] = p0_bot_x;
        buffers.positions[posIdx + 1] = -p0_bot_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        buffers.positions[posIdx] = p1_top_x;
        buffers.positions[posIdx + 1] = -p1_top_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;

        // Triangle 2: p1_top, p0_bot, p1_bot
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        buffers.positions[posIdx] = p1_top_x;
        buffers.positions[posIdx + 1] = -p1_top_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        buffers.positions[posIdx] = p0_bot_x;
        buffers.positions[posIdx + 1] = -p0_bot_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        buffers.positions[posIdx] = p1_bot_x;
        buffers.positions[posIdx + 1] = -p1_bot_y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        vertexIndex++;
      }
    }

    // Update attributes
    if (buffers.positionAttr && buffers.uvAttr && buffers.colorAttr) {
      buffers.positionAttr.needsUpdate = true;
      buffers.uvAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
    }

    // Set draw range
    mesh.geometry.setDrawRange(0, vertexIndex);
    buffers.lastVertexCount = vertexIndex;
    dirtyRef.current = false;
  });

  return (
    <mesh ref={meshRef} material={material}>
      <bufferGeometry />
    </mesh>
  );
}
