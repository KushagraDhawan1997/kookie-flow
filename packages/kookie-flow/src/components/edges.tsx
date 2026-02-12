import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { getMovedEntityIds } from '../core/store';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_ENTITY_WIDTH, DEFAULT_SOCKET_TYPES, SOCKET_OFFSET } from '../core/constants';
import { calculateMinEntityHeight } from '../utils/style-resolver';
import { THEME_COLORS } from '../core/theme-colors';
import type { Entity, EdgeType, SocketType, EdgeMarker, EdgeMarkerType } from '../types';

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
// aLayer + uMeshLayer: per-vertex layer attribute for bg/fg visibility without buffer reordering
const vertexShader = /* glsl */ `
  attribute vec2 uv2;
  attribute vec3 aColor;
  attribute vec2 aPerpendicular;
  attribute float aLayer;

  uniform float uHalfWidth;
  uniform float uZoom;
  uniform float uMeshLayer;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    // Discard vertices not belonging to this mesh's layer
    if (abs(aLayer - uMeshLayer) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

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
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const bgMeshRef = useRef<THREE.Mesh>(null);
  const fgMeshRef = useRef<THREE.Mesh>(null);

  // Render order constants for z-index layering across components
  const RENDER_ORDER_BG = 0; // Non-selected edges
  const RENDER_ORDER_FG = 3; // Selected edges (above non-selected entities)

  // Pre-allocated buffers (shared between bg/fg meshes — same GPU buffer, shader handles visibility)
  const buffersRef = useRef<{
    capacity: number;
    positions: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    perpendiculars: Float32Array;
    layers: Float32Array; // per-vertex layer: 0=bg, 1=fg (shader discards non-matching)
    // Attributes (shared between bg/fg geometries)
    positionAttr: THREE.BufferAttribute | null;
    uvAttr: THREE.BufferAttribute | null;
    colorAttr: THREE.BufferAttribute | null;
    perpAttr: THREE.BufferAttribute | null;
    layerAttr: THREE.BufferAttribute | null;
    lastVertexCount: number;
    // Pre-allocated points buffer for curve tessellation (avoids GC in hot path)
    points: Float32Array;
  }>({
    capacity: INITIAL_EDGE_CAPACITY,
    positions: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    uvs: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 2),
    colors: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 3),
    perpendiculars: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE * 2),
    layers: new Float32Array(INITIAL_EDGE_CAPACITY * VERTICES_PER_EDGE),
    positionAttr: null,
    uvAttr: null,
    colorAttr: null,
    perpAttr: null,
    layerAttr: null,
    lastVertexCount: 0,
    points: new Float32Array(MAX_POINTS_PER_EDGE * 2),
  });

  // Edge position cache for dirty tracking
  // Key: edgeId, Value: hash of endpoint positions (x0,y0,x1,y1 packed)
  const edgePositionCacheRef = useRef<Map<string, number>>(new Map());

  // Track which edges need re-tessellation (empty = all dirty or first render)
  const dirtyEdgesRef = useRef<Set<string> | null>(null);

  // Track last selection state for per-edge color updates
  const lastSelectedEdgesRef = useRef<Set<string>>(new Set());

  // Entity map for O(1) lookups (synced with store, avoids getState() overhead in useFrame)
  const entityMapRef = useRef<Map<string, Entity>>(new Map());

  // Socket index map for O(1) lookups: "${entityId}:${socketId}:input|output" -> { index, socket }
  // Rebuilt only when entities are added/removed (not on position changes)
  const socketIndexMapRef = useRef<
    Map<string, { index: number; socket: { id: string; type: string; position?: number } }>
  >(new Map());

  // Dirty flags - separate geometry vs color-only vs layer-only updates
  const geometryDirtyRef = useRef(true);
  const colorDirtyRef = useRef(true);
  const layerDirtyRef = useRef(false); // entity selection changed (edges move between bg/fg layers)

  // Track last position version to detect actual position changes
  const lastPositionVersionRef = useRef(-1);

  // Per-edge vertex layout in buffer: parallel arrays for start offset and vertex count
  const edgeVertexStartsRef = useRef<Int32Array>(new Int32Array(0));
  const edgeVertexCountsRef = useRef<Int32Array>(new Int32Array(0));

  // Cached endpoint positions for dirty detection: flat [x0, y0, x1, y1] per edge
  const endpointCacheRef = useRef<Float64Array>(new Float64Array(0));

  // Per-edge layer cache: 0=bg, 1=fg (for detecting layer changes on selection)
  const edgeLayersRef = useRef<Uint8Array>(new Uint8Array(0));

  // Position-only dirty flag (enables partial update path, avoids full rebuild)
  const positionDirtyRef = useRef(false);

  // Reverse index: entityId → edge array indices (for O(K) partial updates)
  const entityToEdgeIndicesRef = useRef<Map<string, number[]>>(new Map());

  // Track canvas size for resize detection
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // Pre-computed colors from semantic theme config
  const defaultColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.default];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);
  const selectedColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.selected];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);
  const invalidColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.invalid];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);
  // Temp color for socket type lookups (avoids GC in hot path)
  const tempColor = useMemo(() => new THREE.Color(), []);

  // Mark color dirty when theme colors change
  useEffect(() => {
    colorDirtyRef.current = true;
  }, [tokens]);

  // Shader materials — separate instances for bg/fg with different uMeshLayer uniform
  const bgMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAASmooth: { value: AA_SMOOTHNESS / 10 },
        uHalfWidth: { value: EDGE_WIDTH / 2 },
        uZoom: { value: 1 },
        uMeshLayer: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }, []);
  const fgMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAASmooth: { value: AA_SMOOTHNESS / 10 },
        uHalfWidth: { value: EDGE_WIDTH / 2 },
        uZoom: { value: 1 },
        uMeshLayer: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }, []);

  // Ensure buffer capacity
  const ensureCapacity = (neededEdges: number): boolean => {
    const buffers = buffersRef.current;
    if (neededEdges <= buffers.capacity) return false;

    const newCapacity = Math.ceil(neededEdges * BUFFER_GROWTH_FACTOR);
    const vertexCount = newCapacity * VERTICES_PER_EDGE;

    // Allocate new buffers
    const newPositions = new Float32Array(vertexCount * 3);
    const newUvs = new Float32Array(vertexCount * 2);
    const newColors = new Float32Array(vertexCount * 3);
    const newPerpendiculars = new Float32Array(vertexCount * 2);
    const newLayers = new Float32Array(vertexCount);

    // Copy existing data
    const existingVerts = buffers.lastVertexCount;
    if (existingVerts > 0) {
      newPositions.set(buffers.positions.subarray(0, existingVerts * 3));
      newUvs.set(buffers.uvs.subarray(0, existingVerts * 2));
      newColors.set(buffers.colors.subarray(0, existingVerts * 3));
      newPerpendiculars.set(buffers.perpendiculars.subarray(0, existingVerts * 2));
      newLayers.set(buffers.layers.subarray(0, existingVerts));
    }

    buffers.positions = newPositions;
    buffers.uvs = newUvs;
    buffers.colors = newColors;
    buffers.perpendiculars = newPerpendiculars;
    buffers.layers = newLayers;
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
    buffers.layerAttr = new THREE.BufferAttribute(newLayers, 1);
    buffers.layerAttr.setUsage(THREE.DynamicDrawUsage);

    // Set shared attributes on both geometries
    for (const ref of [bgMeshRef, fgMeshRef]) {
      if (ref.current) {
        ref.current.geometry.setAttribute('position', buffers.positionAttr);
        ref.current.geometry.setAttribute('uv2', buffers.uvAttr);
        ref.current.geometry.setAttribute('aColor', buffers.colorAttr);
        ref.current.geometry.setAttribute('aPerpendicular', buffers.perpAttr);
        ref.current.geometry.setAttribute('aLayer', buffers.layerAttr);
      }
    }

    return true;
  };

  // Initialize and subscribe
  useEffect(() => {
    if (!bgMeshRef.current || !fgMeshRef.current) return;

    const buffers = buffersRef.current;

    // Create initial attributes
    buffers.positionAttr = new THREE.BufferAttribute(buffers.positions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.uvAttr = new THREE.BufferAttribute(buffers.uvs, 2);
    buffers.uvAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.BufferAttribute(buffers.colors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.perpAttr = new THREE.BufferAttribute(buffers.perpendiculars, 2);
    buffers.perpAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.layerAttr = new THREE.BufferAttribute(buffers.layers, 1);
    buffers.layerAttr.setUsage(THREE.DynamicDrawUsage);

    // Set shared attributes on both geometries
    for (const ref of [bgMeshRef, fgMeshRef]) {
      ref.current!.geometry.setAttribute('position', buffers.positionAttr);
      ref.current!.geometry.setAttribute('uv2', buffers.uvAttr);
      ref.current!.geometry.setAttribute('aColor', buffers.colorAttr);
      ref.current!.geometry.setAttribute('aPerpendicular', buffers.perpAttr);
      ref.current!.geometry.setAttribute('aLayer', buffers.layerAttr);
    }

    // Helper to rebuild socket index map (only called on add/remove, not position changes)
    const rebuildSocketIndexMap = (entities: Entity[]) => {
      socketIndexMapRef.current.clear();
      for (const n of entities) {
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
    };

    // Subscribe to changes
    // IMPORTANT: entities.length subscription for socket index map rebuild (only on add/remove)
    // Also sync entityMapRef here - store creates new entityMap only on add/remove,
    // during drag it mutates the same Map in place (updateEntityPositions)
    const unsubEntitiesLength = store.subscribe(
      (state) => state.entities.length,
      () => {
        const { entities, entityMap } = store.getState();
        entityMapRef.current = entityMap;
        rebuildSocketIndexMap(entities);
        geometryDirtyRef.current = true;
        colorDirtyRef.current = true;
      }
    );
    // Position version change = positions changed, prefer partial update
    const unsubPositions = store.subscribe(
      (state) => state.positionVersion,
      () => {
        positionDirtyRef.current = true;
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      () => {
        geometryDirtyRef.current = true;
        colorDirtyRef.current = true;
      }
    );
    // Selection changes only require color update, not geometry rebuild
    const unsubSelection = store.subscribe(
      (state) => state.selectedEdgeIds,
      (newIds, prevIds) => {
        // Skip when both empty (common: entity selection clears already-empty edge selection)
        if (newIds.size === 0 && prevIds.size === 0) return;
        colorDirtyRef.current = true;
      }
    );
    // Entity selection changes require layer update (edges move between bg/fg layers via shader)
    const unsubEntitySelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => {
        layerDirtyRef.current = true;
      }
    );

    // Initialize entityMap ref and socket index map
    const { entities, entityMap } = store.getState();
    entityMapRef.current = entityMap;
    rebuildSocketIndexMap(entities);

    // Mark dirty to ensure edges render on first frame after initialization
    geometryDirtyRef.current = true;
    colorDirtyRef.current = true;

    return () => {
      unsubEntitiesLength();
      unsubPositions();
      unsubEdges();
      unsubSelection();
      unsubEntitySelection();
      bgMaterial.dispose();
      fgMaterial.dispose();
    };
  }, [store, bgMaterial, fgMaterial]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    if (!bgMeshRef.current || !fgMeshRef.current) return;

    const { edges, viewport, selectedEdgeIds, selectedEntityIds, positionVersion, entityMap } =
      store.getState();
    // Always read entityMap from store (not cached ref) because setEntities
    // creates a new Map without changing entities.length, which would leave
    // entityMapRef stale. The store's getState() is synchronous and cheap.
    entityMapRef.current = entityMap;

    // Always update zoom uniform on both materials (cheap operation)
    bgMaterial.uniforms.uZoom.value = viewport.zoom;
    fgMaterial.uniforms.uZoom.value = viewport.zoom;

    // Mark dirty on canvas resize (prevents ghosting)
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
      geometryDirtyRef.current = true;
    }

    // Skip if nothing is dirty
    if (!geometryDirtyRef.current && !positionDirtyRef.current && !colorDirtyRef.current && !layerDirtyRef.current) return;

    const socketIndexMap = socketIndexMapRef.current;
    const buffers = buffersRef.current;

    if (edges.length === 0 || entityMap.size === 0) {
      bgMeshRef.current.geometry.setDrawRange(0, 0);
      fgMeshRef.current.geometry.setDrawRange(0, 0);
      geometryDirtyRef.current = false;
      positionDirtyRef.current = false;
      colorDirtyRef.current = false;
      layerDirtyRef.current = false;
      return;
    }

    // Ensure capacity
    ensureCapacity(edges.length);

    // Fast path: layer and/or color update only (no geometry or position changes)
    if (!geometryDirtyRef.current && !positionDirtyRef.current && (layerDirtyRef.current || colorDirtyRef.current)) {
      const evStarts = edgeVertexStartsRef.current;
      const evCounts = edgeVertexCountsRef.current;
      const edgeLayers = edgeLayersRef.current;

      // Layer update: flip aLayer for edges whose bg/fg assignment changed
      if (layerDirtyRef.current) {
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const newLayer = (selectedEntityIds.has(edge.source) || selectedEntityIds.has(edge.target)) ? 1 : 0;
          if (newLayer !== edgeLayers[i]) {
            edgeLayers[i] = newLayer;
            const start = evStarts[i];
            const count = evCounts[i];
            for (let v = 0; v < count; v++) {
              buffers.layers[start + v] = newLayer;
            }
          }
        }
        if (buffers.layerAttr) {
          buffers.layerAttr.needsUpdate = true;
        }
        layerDirtyRef.current = false;
      }

      // Color update: update colors for all edges using recorded vertex layout
      if (colorDirtyRef.current) {
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const vertexStart = evStarts[i];
          const vertexCount = evCounts[i];
          if (vertexCount === 0) continue;

          let cr: number, cg: number, cb: number;
          if (selectedEdgeIds.has(edge.id)) {
            cr = selectedColor.r;
            cg = selectedColor.g;
            cb = selectedColor.b;
          } else if (edge.invalid) {
            cr = invalidColor.r;
            cg = invalidColor.g;
            cb = invalidColor.b;
          } else {
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

          for (let v = 0; v < vertexCount; v++) {
            const colIdx = (vertexStart + v) * 3;
            buffers.colors[colIdx] = cr;
            buffers.colors[colIdx + 1] = cg;
            buffers.colors[colIdx + 2] = cb;
          }
        }
        if (buffers.colorAttr) {
          buffers.colorAttr.needsUpdate = true;
        }
        colorDirtyRef.current = false;
      }

      return;
    }

    // Determine update mode: partial (position-only) vs full rebuild
    const isPartialUpdate = positionDirtyRef.current && !geometryDirtyRef.current;

    // Ensure endpoint cache and layout arrays have capacity
    const neededCacheSize = edges.length * 4;
    if (endpointCacheRef.current.length < neededCacheSize) {
      const newCache = new Float64Array(Math.ceil(neededCacheSize * BUFFER_GROWTH_FACTOR));
      newCache.set(endpointCacheRef.current);
      endpointCacheRef.current = newCache;
    }
    if (edgeVertexStartsRef.current.length < edges.length) {
      const newStarts = new Int32Array(Math.ceil(edges.length * BUFFER_GROWTH_FACTOR));
      newStarts.set(edgeVertexStartsRef.current);
      edgeVertexStartsRef.current = newStarts;
      const newCounts = new Int32Array(Math.ceil(edges.length * BUFFER_GROWTH_FACTOR));
      newCounts.set(edgeVertexCountsRef.current);
      edgeVertexCountsRef.current = newCounts;
    }
    const epCache = endpointCacheRef.current;
    const evStarts = edgeVertexStartsRef.current;
    const evCounts = edgeVertexCountsRef.current;

    // Track dirty vertex range for partial GPU upload
    let dirtyRangeMin = Infinity;
    let dirtyRangeMax = 0;

    // Pre-compute affected edge indices for O(K) partial update
    let affectedEdgeIndices: Set<number> | null = null;
    if (isPartialUpdate) {
      const movedIds = getMovedEntityIds();
      const entityEdgeMap = entityToEdgeIndicesRef.current;
      if (movedIds.size > 0 && entityEdgeMap.size > 0) {
        affectedEdgeIndices = new Set<number>();
        for (const entityId of movedIds) {
          const edgeIndices = entityEdgeMap.get(entityId);
          if (edgeIndices) {
            for (const idx of edgeIndices) affectedEdgeIndices.add(idx);
          }
        }
      }
    }

    // Full geometry rebuild or partial position update path
    // Single pass: all edges in natural order, aLayer attribute controls bg/fg visibility
    let vertexIndex = 0;
    const edgeLayers = edgeLayersRef.current;

    {
      for (let i = 0; i < edges.length; i++) {
        // Partial update: skip non-affected edges, jump to recorded position
        if (isPartialUpdate) {
          if (affectedEdgeIndices !== null && !affectedEdgeIndices.has(i)) continue;
          vertexIndex = evStarts[i];
        }

        const edge = edges[i];
        const sourceEntity = entityMap.get(edge.source);
        const targetEntity = entityMap.get(edge.target);

        if (!sourceEntity || !targetEntity) {
          // Record zero-vertex layout for this edge
          evStarts[i] = vertexIndex;
          evCounts[i] = 0;
          continue;
        }

        const sourceWidth = sourceEntity.width ?? DEFAULT_ENTITY_WIDTH;
        const sourceOutputCount = sourceEntity.outputs?.length ?? 0;
        const sourceInputCount = sourceEntity.inputs?.length ?? 0;
        const sourceHeight =
          sourceEntity.height ??
          calculateMinEntityHeight(sourceOutputCount, sourceInputCount, socketLayout);
        const targetOutputCount = targetEntity.outputs?.length ?? 0;
        const targetInputCount = targetEntity.inputs?.length ?? 0;
        const targetHeight =
          targetEntity.height ??
          calculateMinEntityHeight(targetOutputCount, targetInputCount, socketLayout);

        // Calculate source socket position - O(1) lookup via socketIndexMap
        // Source socket is always an output (rowIndex = outputIndex)
        // Headerless entity types use padding-only marginTop
        const HEADERLESS_TYPES = ['text', 'comment', 'reroute', 'image'];
        const sourceMarginTop = HEADERLESS_TYPES.includes(sourceEntity.type)
          ? socketLayout.padding : socketLayout.marginTop;
        const sourceComputedH = sourceMarginTop +
          Math.max(1, sourceOutputCount + sourceInputCount) * socketLayout.rowHeight +
          socketLayout.padding;
        const sourceCenterOffset = (sourceHeight - sourceComputedH) / 2;

        let sourceYOffset = sourceHeight / 2; // fallback to center
        if (edge.sourceSocket) {
          const socketInfo = socketIndexMap.get(`${edge.source}:${edge.sourceSocket}:output`);
          if (socketInfo) {
            sourceYOffset =
              socketInfo.socket.position !== undefined
                ? socketInfo.socket.position * sourceHeight
                : sourceMarginTop +
                  socketInfo.index * socketLayout.rowHeight +
                  socketLayout.rowHeight / 2 +
                  sourceCenterOffset;
          }
        }

        // Calculate target socket position - O(1) lookup via socketIndexMap
        // Target socket is always an input (rowIndex = outputCount + inputIndex)
        const targetMarginTop = HEADERLESS_TYPES.includes(targetEntity.type)
          ? socketLayout.padding : socketLayout.marginTop;
        const targetComputedH = targetMarginTop +
          Math.max(1, targetOutputCount + targetInputCount) * socketLayout.rowHeight +
          socketLayout.padding;
        const targetCenterOffset = (targetHeight - targetComputedH) / 2;

        let targetYOffset = targetHeight / 2; // fallback to center
        if (edge.targetSocket) {
          const socketInfo = socketIndexMap.get(`${edge.target}:${edge.targetSocket}:input`);
          if (socketInfo) {
            const targetOutputCount = targetEntity.outputs?.length ?? 0;
            const rowIndex = targetOutputCount + socketInfo.index;
            targetYOffset =
              socketInfo.socket.position !== undefined
                ? socketInfo.socket.position * targetHeight
                : targetMarginTop +
                  rowIndex * socketLayout.rowHeight +
                  socketLayout.rowHeight / 2 +
                  targetCenterOffset;
          }
        }

        // Edge endpoints at actual socket positions (outside entity body)
        const x0 = sourceEntity.position.x + sourceWidth + SOCKET_OFFSET;
        const y0 = sourceEntity.position.y + sourceYOffset;
        const x1 = targetEntity.position.x - SOCKET_OFFSET;
        const y1 = targetEntity.position.y + targetYOffset;

        // Partial update: check if this edge's endpoints changed
        if (isPartialUpdate) {
          const epBase = i * 4;
          // When using affectedEdgeIndices, we already know this edge is affected — skip comparison
          if (affectedEdgeIndices === null) {
            // Fallback: compare endpoints when reverse index isn't available
            if (
              epCache[epBase] === x0 &&
              epCache[epBase + 1] === y0 &&
              epCache[epBase + 2] === x1 &&
              epCache[epBase + 3] === y1
            ) {
              continue;
            }
          }
          // Update cache and mark dirty range
          epCache[epBase] = x0;
          epCache[epBase + 1] = y0;
          epCache[epBase + 2] = x1;
          epCache[epBase + 3] = y1;
          dirtyRangeMin = Math.min(dirtyRangeMin, vertexIndex);
        }

        const edgeVertexStart = vertexIndex;

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
          // - For close entities, use minimal offset for direct connection
          // - For far entities, use proportional offset for nice curve
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

        // Arrow dimensions in world space (scales with zoom like entities)
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

        // Record edge vertex layout for partial updates
        evStarts[i] = edgeVertexStart;
        evCounts[i] = vertexIndex - edgeVertexStart;

        // Write layer attribute for this edge's vertices (full rebuild only)
        if (!isPartialUpdate) {
          const layer =
            selectedEntityIds.has(edge.source) || selectedEntityIds.has(edge.target) ? 1 : 0;
          edgeLayers[i] = layer;
          for (let v = edgeVertexStart; v < vertexIndex; v++) {
            buffers.layers[v] = layer;
          }
        }

        // Cache endpoints (full rebuild only — partial update caches above)
        if (!isPartialUpdate) {
          const epBase = i * 4;
          epCache[epBase] = x0;
          epCache[epBase + 1] = y0;
          epCache[epBase + 2] = x1;
          epCache[epBase + 3] = y1;
        }

        // Track dirty range end for partial GPU upload
        if (isPartialUpdate) {
          dirtyRangeMax = Math.max(dirtyRangeMax, vertexIndex);
        }
      }
    } // end edge loop

    // Build reverse index: entityId → edge array indices (during full rebuild only)
    if (!isPartialUpdate) {
      const entityEdgeMap = entityToEdgeIndicesRef.current;
      entityEdgeMap.clear();
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        let arr = entityEdgeMap.get(edge.source);
        if (!arr) {
          arr = [];
          entityEdgeMap.set(edge.source, arr);
        }
        arr.push(i);
        arr = entityEdgeMap.get(edge.target);
        if (!arr) {
          arr = [];
          entityEdgeMap.set(edge.target, arr);
        }
        arr.push(i);
      }
    }

    // GPU buffer upload
    if (isPartialUpdate) {
      // Partial upload: only upload the vertex range containing dirty edges
      if (
        dirtyRangeMin < dirtyRangeMax &&
        buffers.positionAttr &&
        buffers.uvAttr &&
        buffers.colorAttr &&
        buffers.perpAttr
      ) {
        const start = dirtyRangeMin;
        const count = dirtyRangeMax - dirtyRangeMin;
        buffers.positionAttr.addUpdateRange(start * 3, count * 3);
        buffers.positionAttr.needsUpdate = true;
        buffers.uvAttr.addUpdateRange(start * 2, count * 2);
        buffers.uvAttr.needsUpdate = true;
        buffers.colorAttr.addUpdateRange(start * 3, count * 3);
        buffers.colorAttr.needsUpdate = true;
        buffers.perpAttr.addUpdateRange(start * 2, count * 2);
        buffers.perpAttr.needsUpdate = true;
      }
    } else {
      // Full upload (existing behavior)
      if (buffers.positionAttr && buffers.uvAttr && buffers.colorAttr && buffers.perpAttr) {
        buffers.positionAttr.needsUpdate = true;
        buffers.uvAttr.needsUpdate = true;
        buffers.colorAttr.needsUpdate = true;
        buffers.perpAttr.needsUpdate = true;
        if (buffers.layerAttr) buffers.layerAttr.needsUpdate = true;
      }
    }

    // Set draw ranges on both geometries — both draw all vertices, shader filters by layer
    if (!isPartialUpdate) {
      bgMeshRef.current!.geometry.setDrawRange(0, vertexIndex);
      fgMeshRef.current!.geometry.setDrawRange(0, vertexIndex);
      buffers.lastVertexCount = vertexIndex;
    }
    geometryDirtyRef.current = false;
    positionDirtyRef.current = false;
    colorDirtyRef.current = false;
    layerDirtyRef.current = false;
  });

  return (
    <>
      <mesh ref={bgMeshRef} material={bgMaterial} frustumCulled={false} renderOrder={RENDER_ORDER_BG}>
        <bufferGeometry />
      </mesh>
      <mesh ref={fgMeshRef} material={fgMaterial} frustumCulled={false} renderOrder={RENDER_ORDER_FG}>
        <bufferGeometry />
      </mesh>
    </>
  );
}
