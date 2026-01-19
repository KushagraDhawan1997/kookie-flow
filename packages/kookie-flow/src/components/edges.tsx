import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import {
  EDGE_COLORS,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_MARGIN_TOP,
  SOCKET_SPACING,
} from '../core/constants';
import type { Node, EdgeType, SocketType, EdgeMarker, EdgeMarkerType } from '../types';
import { DEFAULT_SOCKET_TYPES } from '../core/constants';

// Buffer sizing
const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_EDGE_CAPACITY = 512;

// Tessellation settings
const SEGMENTS_PER_EDGE = 64;
// Each segment = 1 quad = 2 triangles = 6 vertices
// Plus up to 2 arrows (3 vertices each) = 6 extra vertices
const VERTICES_PER_EDGE = SEGMENTS_PER_EDGE * 6 + 6;

// Max points per edge (bezier has SEGMENTS+1, step has 4, straight has 2)
const MAX_POINTS_PER_EDGE = SEGMENTS_PER_EDGE + 1;

// Edge visual settings
const EDGE_WIDTH = 1.5; // pixels in world space
const AA_SMOOTHNESS = 3.0; // anti-aliasing edge softness (higher = softer edges)

// Arrow marker settings
const ARROW_WIDTH = 12; // width of arrow base in pixels
const ARROW_HEIGHT = 12; // length of arrow in pixels

interface EdgesProps {
  defaultEdgeType?: EdgeType;
  socketTypes?: Record<string, SocketType>;
}

/** Normalize marker config to full object */
function normalizeMarker(marker: EdgeMarkerType | EdgeMarker | undefined): EdgeMarker | null {
  if (!marker) return null;
  if (typeof marker === 'string') {
    return { type: marker };
  }
  return marker;
}

// Vertex shader - computes ribbon offset from center position + perpendicular
const vertexShader = /* glsl */ `
  attribute vec2 uv2;
  attribute vec3 aColor;
  attribute vec2 aPerpendicular;

  uniform float uHalfWidth;
  uniform float uZoom;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vUv = uv2;
    vColor = aColor;

    // Compute ribbon offset: center + perpendicular * width * side
    // uv2.y is ±1 indicating which side of the ribbon
    // For arrow vertices (perpendicular = 0,0), no offset is applied
    float scaledWidth = uHalfWidth / uZoom;
    vec3 offset = vec3(aPerpendicular * scaledWidth * uv2.y, 0.0);
    vec3 finalPosition = position + offset;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPosition, 1.0);
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
export function Edges({
  defaultEdgeType = 'bezier',
  socketTypes = DEFAULT_SOCKET_TYPES,
}: EdgesProps) {
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.Mesh>(null);

  // Pre-allocated buffers
  const buffersRef = useRef<{
    capacity: number;
    positions: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    perpendiculars: Float32Array;
    positionAttr: THREE.BufferAttribute | null;
    uvAttr: THREE.BufferAttribute | null;
    colorAttr: THREE.BufferAttribute | null;
    perpAttr: THREE.BufferAttribute | null;
    lastVertexCount: number;
    // Pre-allocated points buffer for curve tessellation (avoids GC in hot path)
    points: Float32Array;
  }>({
    capacity: INITIAL_EDGE_CAPACITY,
    positions: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    uvs: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 2),
    colors: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    perpendiculars: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 2),
    positionAttr: null,
    uvAttr: null,
    colorAttr: null,
    perpAttr: null,
    lastVertexCount: 0,
    points: new Float32Array(MAX_POINTS_PER_EDGE * 2),
  });

  // Node map for O(1) lookups
  const nodeMapRef = useRef<Map<string, Node>>(new Map());

  // Socket index map for O(1) lookups: "${nodeId}:${socketId}:input|output" -> { index, socket }
  // Rebuilt when nodes change, not per frame
  const socketIndexMapRef = useRef<
    Map<string, { index: number; socket: { id: string; type: string; position?: number } }>
  >(new Map());

  // Dirty flag
  const dirtyRef = useRef(true);

  // Pre-computed colors
  const defaultColor = useMemo(() => new THREE.Color(EDGE_COLORS.default), []);
  const selectedColor = useMemo(() => new THREE.Color(EDGE_COLORS.selected), []);
  const invalidColor = useMemo(() => new THREE.Color(EDGE_COLORS.invalid), []);
  // Temp color for socket type lookups (avoids GC in hot path)
  const tempColor = useMemo(() => new THREE.Color(), []);

  // Shader material
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAASmooth: { value: AA_SMOOTHNESS / 10 },
        uHalfWidth: { value: EDGE_WIDTH / 2 },
        uZoom: { value: 1 },
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
    const newPerpendiculars = new Float32Array(vertexCount * 2);

    // Copy existing data
    const existingVerts = buffers.lastVertexCount;
    if (existingVerts > 0) {
      newPositions.set(buffers.positions.subarray(0, existingVerts * 3));
      newUvs.set(buffers.uvs.subarray(0, existingVerts * 2));
      newColors.set(buffers.colors.subarray(0, existingVerts * 3));
      newPerpendiculars.set(buffers.perpendiculars.subarray(0, existingVerts * 2));
    }

    buffers.positions = newPositions;
    buffers.uvs = newUvs;
    buffers.colors = newColors;
    buffers.perpendiculars = newPerpendiculars;
    buffers.capacity = newCapacity;

    // Recreate attributes with new buffers
    buffers.positionAttr = new THREE.BufferAttribute(newPositions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.uvAttr = new THREE.BufferAttribute(newUvs, 2);
    buffers.uvAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(newColors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.perpAttr = new THREE.BufferAttribute(newPerpendiculars, 2);
    buffers.perpAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('position', buffers.positionAttr);
    mesh.geometry.setAttribute('uv2', buffers.uvAttr);
    mesh.geometry.setAttribute('aColor', buffers.colorAttr);
    mesh.geometry.setAttribute('aPerpendicular', buffers.perpAttr);

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
    buffers.perpAttr = new THREE.BufferAttribute(buffers.perpendiculars, 2);
    buffers.perpAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('position', buffers.positionAttr);
    mesh.geometry.setAttribute('uv2', buffers.uvAttr);
    mesh.geometry.setAttribute('aColor', buffers.colorAttr);
    mesh.geometry.setAttribute('aPerpendicular', buffers.perpAttr);

    // Subscribe to changes
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (nodes) => {
        nodeMapRef.current.clear();
        socketIndexMapRef.current.clear();
        for (const n of nodes) {
          nodeMapRef.current.set(n.id, n);
          // Build socket index map for O(1) lookups
          if (n.inputs) {
            for (let i = 0; i < n.inputs.length; i++) {
              const s = n.inputs[i];
              socketIndexMapRef.current.set(`${n.id}:${s.id}:input`, { index: i, socket: s });
            }
          }
          if (n.outputs) {
            for (let i = 0; i < n.outputs.length; i++) {
              const s = n.outputs[i];
              socketIndexMapRef.current.set(`${n.id}:${s.id}:output`, { index: i, socket: s });
            }
          }
        }
        dirtyRef.current = true;
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      () => {
        dirtyRef.current = true;
      }
    );
    // Note: viewport changes no longer trigger dirty - zoom is handled via shader uniform
    const unsubSelection = store.subscribe(
      (state) => state.selectedEdgeIds,
      () => {
        dirtyRef.current = true;
      }
    );

    // Initialize node map and socket index map
    const { nodes } = store.getState();
    for (const n of nodes) {
      nodeMapRef.current.set(n.id, n);
      if (n.inputs) {
        for (let i = 0; i < n.inputs.length; i++) {
          const s = n.inputs[i];
          socketIndexMapRef.current.set(`${n.id}:${s.id}:input`, { index: i, socket: s });
        }
      }
      if (n.outputs) {
        for (let i = 0; i < n.outputs.length; i++) {
          const s = n.outputs[i];
          socketIndexMapRef.current.set(`${n.id}:${s.id}:output`, { index: i, socket: s });
        }
      }
    }

    return () => {
      unsubNodes();
      unsubEdges();
      unsubSelection();
      material.dispose();
    };
  }, [store, material]);

  // RAF-synchronized updates
  useFrame(() => {
    if (!meshRef.current) return;

    const { edges, viewport, selectedEdgeIds } = store.getState();

    // Always update zoom uniform (cheap operation)
    material.uniforms.uZoom.value = viewport.zoom;

    // Skip geometry rebuild if not dirty
    if (!dirtyRef.current) return;
    const nodeMap = nodeMapRef.current;
    const socketIndexMap = socketIndexMapRef.current;
    const buffers = buffersRef.current;
    const mesh = meshRef.current;

    if (edges.length === 0 || nodeMap.size === 0) {
      mesh.geometry.setDrawRange(0, 0);
      dirtyRef.current = false;
      return;
    }

    // Ensure capacity
    ensureCapacity(edges.length, mesh);

    // Note: CPU-side frustum culling removed - GPU handles clipping efficiently
    // This allows zoom/pan without geometry rebuilds

    let vertexIndex = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) continue;

      const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;
      const sourceHeight = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
      const targetHeight = targetNode.height ?? DEFAULT_NODE_HEIGHT;

      // Calculate source socket position - O(1) lookup via socketIndexMap
      let sourceYOffset = sourceHeight / 2; // fallback to center
      if (edge.sourceSocket) {
        const socketInfo = socketIndexMap.get(`${edge.source}:${edge.sourceSocket}:output`);
        if (socketInfo) {
          sourceYOffset =
            socketInfo.socket.position !== undefined
              ? socketInfo.socket.position * sourceHeight
              : SOCKET_MARGIN_TOP + socketInfo.index * SOCKET_SPACING;
        }
      }

      // Calculate target socket position - O(1) lookup via socketIndexMap
      let targetYOffset = targetHeight / 2; // fallback to center
      if (edge.targetSocket) {
        const socketInfo = socketIndexMap.get(`${edge.target}:${edge.targetSocket}:input`);
        if (socketInfo) {
          targetYOffset =
            socketInfo.socket.position !== undefined
              ? socketInfo.socket.position * targetHeight
              : SOCKET_MARGIN_TOP + socketInfo.index * SOCKET_SPACING;
        }
      }

      // Edge endpoints at actual socket positions
      const x0 = sourceNode.position.x + sourceWidth;
      const y0 = sourceNode.position.y + sourceYOffset;
      const x1 = targetNode.position.x;
      const y1 = targetNode.position.y + targetYOffset;

      // Get edge type early - needed for control point calculation before culling
      const edgeType = edge.type ?? defaultEdgeType;

      // Calculate bezier control points BEFORE culling to get accurate bounding box
      // Control points can extend beyond endpoints (especially when source is right of target)
      const dx = x1 - x0;
      const dy = y1 - y0;
      const absDx = Math.abs(dx);

      let cx1: number, cy1: number, cx2: number, cy2: number;

      if (edgeType === 'straight') {
        cx1 = x0;
        cy1 = y0;
        cx2 = x1;
        cy2 = y1;
      } else if (edgeType === 'step') {
        // For step edges, the midpoint extends the bounds
        const midX = x0 + dx / 2;
        cx1 = midX;
        cy1 = y0;
        cx2 = midX;
        cy2 = y1;
      } else if (edgeType === 'smoothstep') {
        // Smoothstep: constrained curve, scales with distance
        const offset = Math.min(absDx * 0.5, 100);
        cx1 = x0 + offset;
        cy1 = y0;
        cx2 = x1 - offset;
        cy2 = y1;
      } else {
        // Bezier: adaptive offset based on distance
        // - For close nodes, use minimal offset for direct connection
        // - For far nodes, use proportional offset for nice curve
        // - Consider vertical distance too
        const distance = Math.sqrt(dx * dx + dy * dy);
        const baseOffset = Math.min(absDx * 0.5, distance * 0.4);
        const offset = Math.max(baseOffset, Math.min(absDx * 0.25, 20));
        cx1 = x0 + offset;
        cy1 = y0;
        cx2 = x1 - offset;
        cy2 = y1;
      }

      // Determine edge color: selected → blue, invalid → red, otherwise → source socket type color
      // Note: edge.invalid is set when edges are created via UI (no runtime type checking for performance)
      let cr: number, cg: number, cb: number;
      if (selectedEdgeIds.has(edge.id)) {
        cr = selectedColor.r;
        cg = selectedColor.g;
        cb = selectedColor.b;
      } else if (edge.invalid) {
        // Invalid connection (incompatible types in loose mode)
        cr = invalidColor.r;
        cg = invalidColor.g;
        cb = invalidColor.b;
      } else {
        // Get source socket type color - O(1) via socketIndexMap
        let foundColor = false;
        if (edge.sourceSocket) {
          const socketInfo = socketIndexMap.get(`${edge.source}:${edge.sourceSocket}:output`);
          if (socketInfo) {
            const typeConfig = socketTypes[socketInfo.socket.type] ?? socketTypes.any;
            if (typeConfig) {
              tempColor.set(typeConfig.color);
              foundColor = true;
            }
          }
        }
        if (!foundColor) {
          cr = defaultColor.r;
          cg = defaultColor.g;
          cb = defaultColor.b;
        } else {
          cr = tempColor.r;
          cg = tempColor.g;
          cb = tempColor.b;
        }
      }

      // Generate curve points into pre-allocated buffer (avoids GC)
      // points buffer stores [x0, y0, x1, y1, ...] as flat array
      const points = buffers.points;
      let pointsCount = 0;

      if (edgeType === 'step') {
        // Step: horizontal → vertical → horizontal
        const midX = x0 + dx / 2;
        points[0] = x0;
        points[1] = y0;
        points[2] = midX;
        points[3] = y0;
        points[4] = midX;
        points[5] = y1;
        points[6] = x1;
        points[7] = y1;
        pointsCount = 4;
      } else if (edgeType === 'straight') {
        points[0] = x0;
        points[1] = y0;
        points[2] = x1;
        points[3] = y1;
        pointsCount = 2;
      } else {
        // Bezier/smoothstep - sample the curve
        for (let s = 0; s <= SEGMENTS_PER_EDGE; s++) {
          const t = s / SEGMENTS_PER_EDGE;
          const mt = 1 - t;
          const mt2 = mt * mt;
          const mt3 = mt2 * mt;
          const t2 = t * t;
          const t3 = t2 * t;

          const idx = s * 2;
          points[idx] = mt3 * x0 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * x1;
          points[idx + 1] = mt3 * y0 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * y1;
        }
        pointsCount = SEGMENTS_PER_EDGE + 1;
      }

      // Generate ribbon geometry from points
      // Now stores CENTER positions + perpendicular vectors; shader computes final offset
      for (let p = 0; p < pointsCount - 1; p++) {
        const p0x = points[p * 2];
        const p0y = points[p * 2 + 1];
        const p1x = points[(p + 1) * 2];
        const p1y = points[(p + 1) * 2 + 1];

        // Direction vector
        const dirX = p1x - p0x;
        const dirY = p1y - p0y;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);

        if (len < 0.001) continue; // Skip degenerate segments

        // Perpendicular (normal) vector - Y negated to match Three.js coordinate system
        const normX = -dirY / len;
        const normY = -dirX / len; // Negated for Y-up coordinate system

        // UV coordinates (u = progress, v = -1 to 1 across width)
        const u0 = p / (pointsCount - 1);
        const u1 = (p + 1) / (pointsCount - 1);

        // Z position (above grid)
        const z = 1;

        // Triangle 1: p0_top, p0_bot, p1_top
        // Vertex 1: p0, top side (uv.y = 1)
        let posIdx = vertexIndex * 3;
        let uvIdx = vertexIndex * 2;
        let colIdx = vertexIndex * 3;
        let perpIdx = vertexIndex * 2;

        buffers.positions[posIdx] = p0x;
        buffers.positions[posIdx + 1] = -p0y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;

        // Vertex 2: p0, bottom side (uv.y = -1)
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = p0x;
        buffers.positions[posIdx + 1] = -p0y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;

        // Vertex 3: p1, top side (uv.y = 1)
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = p1x;
        buffers.positions[posIdx + 1] = -p1y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;

        // Triangle 2: p1_top, p0_bot, p1_bot
        // Vertex 4: p1, top side (uv.y = 1)
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = p1x;
        buffers.positions[posIdx + 1] = -p1y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = 1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;

        // Vertex 5: p0, bottom side (uv.y = -1)
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = p0x;
        buffers.positions[posIdx + 1] = -p0y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u0;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;

        // Vertex 6: p1, bottom side (uv.y = -1)
        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = p1x;
        buffers.positions[posIdx + 1] = -p1y;
        buffers.positions[posIdx + 2] = z;
        buffers.uvs[uvIdx] = u1;
        buffers.uvs[uvIdx + 1] = -1;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = normX;
        buffers.perpendiculars[perpIdx + 1] = normY;
        vertexIndex++;
      }

      // Add arrow markers if defined
      const markerStart = normalizeMarker(edge.markerStart);
      const markerEnd = normalizeMarker(edge.markerEnd);

      // Arrow dimensions in world space (scales with zoom like nodes)
      const arrowWidth = (markerEnd?.width ?? ARROW_WIDTH) / 2;
      const arrowHeight = markerEnd?.height ?? ARROW_HEIGHT;

      // Z position for arrows (slightly above edges)
      const arrowZ = 1.5;

      // markerEnd: arrow at target (pointing into target)
      if (markerEnd) {
        // Get last segment direction for arrow orientation
        const lastIdx = (pointsCount - 1) * 2;
        const prevIdx = (pointsCount - 2) * 2;
        const tipX = points[lastIdx];
        const tipY = points[lastIdx + 1];
        const prevX = points[prevIdx];
        const prevY = points[prevIdx + 1];

        // Direction vector (from prev to tip)
        const dirX = tipX - prevX;
        const dirY = tipY - prevY;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        const normDirX = len > 0 ? dirX / len : 1;
        const normDirY = len > 0 ? dirY / len : 0;

        // Perpendicular vector
        const perpX = -normDirY;
        const perpY = normDirX;

        // Arrow tip at edge endpoint
        const arrowTipX = tipX;
        const arrowTipY = tipY;

        // Arrow base (behind tip)
        const baseX = tipX - normDirX * arrowHeight;
        const baseY = tipY - normDirY * arrowHeight;

        // Arrow corners
        const corner1X = baseX + perpX * arrowWidth;
        const corner1Y = baseY + perpY * arrowWidth;
        const corner2X = baseX - perpX * arrowWidth;
        const corner2Y = baseY - perpY * arrowWidth;

        // Add triangle vertices (tip, corner1, corner2)
        // Arrows use perpendicular = (0,0) since they don't need ribbon expansion
        let posIdx = vertexIndex * 3;
        let uvIdx = vertexIndex * 2;
        let colIdx = vertexIndex * 3;
        let perpIdx = vertexIndex * 2;

        buffers.positions[posIdx] = arrowTipX;
        buffers.positions[posIdx + 1] = -arrowTipY;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 0.5;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = corner1X;
        buffers.positions[posIdx + 1] = -corner1Y;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 0;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = corner2X;
        buffers.positions[posIdx + 1] = -corner2Y;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 1;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;
      }

      // markerStart: arrow at source (pointing away from source)
      if (markerStart) {
        const startArrowWidth = (markerStart.width ?? ARROW_WIDTH) / 2;
        const startArrowHeight = markerStart.height ?? ARROW_HEIGHT;

        // Get first segment direction for arrow orientation
        const tipX = points[0];
        const tipY = points[1];
        const nextX = points[2];
        const nextY = points[3];

        // Direction vector (from tip to next, then reversed for arrow pointing away)
        const dirX = tipX - nextX;
        const dirY = tipY - nextY;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        const normDirX = len > 0 ? dirX / len : -1;
        const normDirY = len > 0 ? dirY / len : 0;

        // Perpendicular vector
        const perpX = -normDirY;
        const perpY = normDirX;

        // Arrow tip at edge start
        const arrowTipX = tipX;
        const arrowTipY = tipY;

        // Arrow base (behind tip, in direction of arrow)
        const baseX = tipX - normDirX * startArrowHeight;
        const baseY = tipY - normDirY * startArrowHeight;

        // Arrow corners
        const corner1X = baseX + perpX * startArrowWidth;
        const corner1Y = baseY + perpY * startArrowWidth;
        const corner2X = baseX - perpX * startArrowWidth;
        const corner2Y = baseY - perpY * startArrowWidth;

        // Add triangle vertices
        // Arrows use perpendicular = (0,0) since they don't need ribbon expansion
        let posIdx = vertexIndex * 3;
        let uvIdx = vertexIndex * 2;
        let colIdx = vertexIndex * 3;
        let perpIdx = vertexIndex * 2;

        buffers.positions[posIdx] = arrowTipX;
        buffers.positions[posIdx + 1] = -arrowTipY;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 0.5;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = corner1X;
        buffers.positions[posIdx + 1] = -corner1Y;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 0;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;

        posIdx = vertexIndex * 3;
        uvIdx = vertexIndex * 2;
        colIdx = vertexIndex * 3;
        perpIdx = vertexIndex * 2;
        buffers.positions[posIdx] = corner2X;
        buffers.positions[posIdx + 1] = -corner2Y;
        buffers.positions[posIdx + 2] = arrowZ;
        buffers.uvs[uvIdx] = 1;
        buffers.uvs[uvIdx + 1] = 0;
        buffers.colors[colIdx] = cr;
        buffers.colors[colIdx + 1] = cg;
        buffers.colors[colIdx + 2] = cb;
        buffers.perpendiculars[perpIdx] = 0;
        buffers.perpendiculars[perpIdx + 1] = 0;
        vertexIndex++;
      }
    }

    // Update attributes
    if (buffers.positionAttr && buffers.uvAttr && buffers.colorAttr && buffers.perpAttr) {
      buffers.positionAttr.needsUpdate = true;
      buffers.uvAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.perpAttr.needsUpdate = true;
    }

    // Set draw range
    mesh.geometry.setDrawRange(0, vertexIndex);
    buffers.lastVertexCount = vertexIndex;
    dirtyRef.current = false;
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false}>
      <bufferGeometry />
    </mesh>
  );
}
