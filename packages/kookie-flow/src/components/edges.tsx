import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraGate } from '../utils/viewport-cull';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_SOCKET_TYPES } from '../core/constants';
import { getSocketWorldX, getSocketYOffset } from '../utils/geometry';
import { EDGE_LEADER, EDGE_SOCKET_RIM, bezierControlOffset } from '../utils/edge-curve';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { THEME_COLORS } from '../core/theme-colors';
import type { Entity, EdgeType, SocketType, EdgeMarker, EdgeMarkerType } from '../types';

// Buffer sizing
const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_EDGE_CAPACITY = 512;

/**
 * Tessellation, and the LOD that decides how much of it an edge gets.
 *
 * SEGMENTS_PER_EDGE is the CEILING, not the working number: it sizes the buffers and bounds the
 * point array, and a curve is actually sampled at `segmentsForZoom`. Sixty-four segments is right
 * for a curve a few hundred pixels across and absurd for the same curve at zoom 0.1, where the
 * whole edge is thirty pixels long and fifty of its sixty-four segments are shorter than a pixel.
 * The cost is paid twice over — the CPU tessellates them and the GPU shades six vertices each —
 * so the count halves with each halving of zoom, down to a floor that still reads as a curve.
 *
 * It is a function of ZOOM ALONE, deliberately, and not of the edge's own length. Every edge in a
 * frame therefore gets the same count, which is what keeps the vertex-slot arithmetic stable: the
 * partial (drag) path writes into the slot the last full rebuild laid out, so a per-edge count
 * that changed as an edge was stretched would overrun its neighbour. Zoom changes the count for
 * every edge at once, and a band crossing forces a full rebuild, which relays every slot.
 */
const SEGMENTS_PER_EDGE = 64;
const MIN_SEGMENTS_PER_EDGE = 8;

/**
 * How many segments a curve is sampled at, at this zoom.
 *
 * Doubling per octave of zoom, clamped to [MIN, MAX]. Quantised to powers of two so that a slow
 * wheel crosses a boundary a handful of times rather than continuously — each crossing is a full
 * rebuild.
 */
export function segmentsForZoom(zoom: number): number {
  if (!(zoom > 0)) return SEGMENTS_PER_EDGE;
  // 64 at zoom >= 1, 32 at 0.5, 16 at 0.25, 8 below 0.125.
  const scaled = SEGMENTS_PER_EDGE * Math.pow(2, Math.ceil(Math.log2(Math.min(zoom, 1))));
  return Math.max(MIN_SEGMENTS_PER_EDGE, Math.min(SEGMENTS_PER_EDGE, scaled));
}
// Each segment = 1 quad = 2 triangles = 6 vertices
// Plus up to 2 arrows (3 vertices each) = 6 extra vertices
// Two more segments than the curve has: the straight leader at each end (see the rim anchor below).
const VERTICES_PER_EDGE = (SEGMENTS_PER_EDGE + 2) * 6 + 6;

/**
 * How far past the screen an edge is still tessellated, in SCREEN pixels.
 *
 * It covers the glow, which is a screen-space reach either side of the core, and a little slack
 * for an arrowhead sitting on the border. Divided by zoom at the call site.
 */
const EDGE_CULL_PADDING = 64;

/** What the geometry pass needs to know about one socket: which row it is on, and its type. */
interface EdgeSocketInfo {
  index: number;
  socket: { id: string; type: string; position?: number };
}

/** One entity's sockets, by direction then by id. `null` where the entity has none. */
interface EntitySocketIndex {
  inputs: Map<string, EdgeSocketInfo> | null;
  outputs: Map<string, EdgeSocketInfo> | null;
}

// Max points per edge (bezier has SEGMENTS+1, step has 4, straight has 2)
const MAX_POINTS_PER_EDGE = SEGMENTS_PER_EDGE + 3;

/**
 * Where an edge meets a socket — the rim and the leader — lives in utils/edge-curve.ts, shared with
 * the dragged wire and the hit test. `RIM` is the socket's drawn radius, so an edge starts on the
 * dot's edge rather than at its centre; `LEADER` is the straight run it leaves along before the curve
 * begins, which is what makes the join read as a plug with a direction.
 */

/**
 * Edge visual settings, all in SCREEN px: the vertex shader divides by zoom, so an edge is the
 * same width at every zoom, the way a hairline on a card is.
 *
 * The ribbon is one quad that carries two things: a 2px core (the line) and a soft glow that dies
 * quadratically over the 3px beyond it. The glow is light, not material — it is what says an edge
 * is live, and it is the only thing that changes when an edge is selected. It fades out below
 * zoom 0.8 so a zoomed-out graph is a graph and not a bloom.
 */
const EDGE_CORE_HALF = 1.0;
/** Half the core's anti-alias ramp, in screen px; the fragment shader uses the same 0.75. */
const EDGE_CORE_AA = 0.75;
const EDGE_HALF_WIDTH = 4.0;
const EDGE_GLOW_ALPHA = { dark: 0.12, light: 0.08 } as const;
const EDGE_GLOW_ALPHA_SELECTED = 0.22;
/** Two spots per edge, one lap every four seconds. */
const EDGE_LIGHT_LAPS_PER_SEC = 0.25;

/**
 * Where the glow goes as the graph zooms out: the half-width in screen px that the vertex shader
 * expands the ribbon to. Full 8px ribbon at zoom >= 0.8, core only (2px) at <= 0.45, smooth
 * between. Written where `uZoom` is written, so it costs one float per frame.
 */
export function edgeHalfWidthAtZoom(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 0.45) / (0.8 - 0.45)));
  // The floor keeps the core's 0.75px AA ramp inside the ribbon: shrunk to the bare core, the
  // ribbon ended where the ramp was still at half alpha and every diagonal showed a 2px stair.
  const floor = EDGE_CORE_HALF + EDGE_CORE_AA;
  return floor + (EDGE_HALF_WIDTH - floor) * t * t * (3 - 2 * t);
}

/**
 * The edge's state bits, packed into the magnitude of `uv2.y` beside the ribbon side.
 *
 * `uv2.y` was ±1 (which side of the centreline a vertex sits on) and 0 on arrow vertices. It is
 * now `side * (1 + flags)`: the sign is still the side, the magnitude minus one is these three
 * bits, and an arrow vertex is still 0 — so no buffer grows and no attribute is added to carry a
 * state that changes only when a selection or an edge does. The fragment shader unpacks it with
 * `mod` and `step`; `edges.test.ts` pins that the two agree.
 */
export function packEdgeFlags(animated: boolean, selected: boolean, invalid: boolean): number {
  return (animated ? 1 : 0) + (selected ? 2 : 0) + (invalid ? 4 : 0);
}

/**
 * The `uv2.y` a vertex carries: its ribbon side, with the state bits in the magnitude. An arrow
 * vertex has side 0 and must come out 0 whatever the flags — the vertex shader reads a zero as the
 * plain solid arrow, and any other value sends it down the flag-decoded path.
 */
export function packVertexSide(side: number, flags: number): number {
  return side * (1 + flags);
}

/** What the fragment shader recovers from a packed `uv2.y` magnitude; the test's mirror of the GLSL. */
export function unpackEdgeFlags(flags: number): { animated: boolean; selected: boolean; invalid: boolean } {
  const f = Math.floor(flags + 0.5);
  return { animated: f % 2 === 1, selected: Math.floor(f / 2) % 2 === 1, invalid: f >= 4 };
}

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

  varying vec3 vColor;
  varying float vAcross;
  varying float vFlags;
  varying float vU;

  void main() {
    // Discard vertices not belonging to this mesh's layer
    if (abs(aLayer - uMeshLayer) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // uv2.y is side * (1 + flags): sign is the ribbon side, magnitude carries the state bits.
    // Both are 0 on arrow vertices, whose perpendicular is (0,0) and which take no offset.
    float side = sign(uv2.y);
    vAcross = side;
    vFlags = max(0.0, abs(uv2.y) - 1.0);
    vU = uv2.x;
    vColor = aColor;

    vec3 offset = vec3(aPerpendicular * (uHalfWidth / uZoom) * side, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + offset, 1.0);
  }
`;

// Fragment shader - a 2px core over a quadratic glow, graded along u, with the moving light
const fragmentShader = /* glsl */ `
  uniform float uHalfWidth;
  uniform float uCore;
  uniform float uGlowAlpha;
  uniform float uGlowAlphaSelected;
  uniform float uTime;
  uniform float uSpotTint;

  varying vec3 vColor;
  varying float vAcross;
  varying float vFlags;
  varying float vU;

  void main() {
    // The flags are constant across a triangle, but they arrive through an interpolator, and
    // 3.9999 is not 4.0 to step(). Round before unpacking.
    float flags = floor(vFlags + 0.5);
    float anim = mod(flags, 2.0);
    float sel  = mod(floor(flags * 0.5), 2.0);
    float inv  = step(4.0, flags);

    // Screen px from the centreline: the ribbon is uHalfWidth px each side.
    float px   = abs(vAcross) * uHalfWidth;
    float core = 1.0 - smoothstep(uCore - 0.75, uCore + 0.75, px);
    float glow = 1.0 - smoothstep(uCore, uHalfWidth, px);
    glow *= glow;
    float ga   = mix(uGlowAlpha, uGlowAlphaSelected, sel) * (1.0 - inv);

    // Two soft spots travelling source -> target on a live edge; a lap every four seconds.
    float s    = fract(vU * 2.0 - uTime * ${(2 * EDGE_LIGHT_LAPS_PER_SEC).toFixed(3)});
    float spot = exp(-pow((s - 0.5) * 7.0, 2.0)) * max(anim, sel);

    // An invalid edge is 24 soft dashes and no glow.
    float ph   = fract(vU * 24.0);
    float dash = mix(1.0, smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.4, 0.5, ph)), inv);

    // The light lifts toward white in dark and toward a deeper cut of the hue in light.
    vec3  lift = mix(vColor * 0.55, vec3(1.0), uSpotTint);
    vec3  col  = mix(vColor, lift, spot * 0.5);
    float a    = max(core * 0.9 * dash, glow * ga * (1.0 + spot));
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/** One of the two edge materials. The per-appearance alphas are chosen here, once per theme. */
function createEdgeMaterial(appearance: 'light' | 'dark', meshLayer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uCore: { value: EDGE_CORE_HALF },
      uHalfWidth: { value: EDGE_HALF_WIDTH },
      uGlowAlpha: { value: EDGE_GLOW_ALPHA[appearance] },
      uGlowAlphaSelected: { value: EDGE_GLOW_ALPHA_SELECTED },
      uTime: { value: 0 },
      uSpotTint: { value: appearance === 'dark' ? 1 : 0 },
      uZoom: { value: 1 },
      uMeshLayer: { value: meshLayer },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
}

/** What one frame of the edge renderer actually has to do, derived from the four dirty flags. */
export interface EdgeUpdatePlan {
  /** Rewrite `aLayer` for every edge whose bg/fg assignment changed, and re-bound the fg draw range. */
  layer: boolean;
  /** Rewrite `aColor` for every edge from the recorded vertex layout. */
  color: boolean;
  /** `full` relays the whole buffer out, `partial` rewrites the moved edges in place, `none` means the passes above are the whole frame. */
  geometry: 'full' | 'partial' | 'none';
}

/**
 * Decide which passes a frame runs.
 *
 * This lived as three inline conditions and one of them was wrong. The layer pass was gated on
 * nothing having moved this frame, so a frame that was both position-dirty and layer-dirty —
 * which is what clicking an unselected node and dragging it in a single pointermove produces,
 * one handler setting selectedEntityIds and updateEntityPositions in the same tick — fell
 * through to the rebuild path, whose layer write is guarded to full rebuilds only, and then
 * cleared layerDirty at the end regardless. The flip was requested and silently dropped: the
 * dragged node's edges kept layer 0, drew from the background mesh, and disappeared behind every
 * node body they were dragged across until something else forced a full rebuild.
 *
 * A full rebuild writes both layer and colour inline for every edge, so those passes are
 * redundant there and only there. A PARTIAL update is the case the old gate got wrong: it visits
 * only the edges that moved, so an edge that changed layer without moving — the node that just
 * got deselected — needs the pass as much as an idle frame does.
 *
 * Colour is deliberately not run alongside a partial update. Unlike layers, the colour buffer is
 * uploaded through the partial path's addUpdateRange, so writing colours outside the moved range
 * would leave them stranded on the CPU side; the caller keeps colorDirty set instead and pays one
 * pass on the first frame after the drag settles.
 */
export function planEdgeUpdate(dirty: {
  geometry: boolean;
  position: boolean;
  color: boolean;
  layer: boolean;
}): EdgeUpdatePlan {
  const geometry = dirty.geometry ? 'full' : dirty.position ? 'partial' : 'none';
  return {
    layer: dirty.layer && geometry !== 'full',
    color: dirty.color && geometry === 'none',
    geometry,
  };
}

/**
 * High-performance mesh-based edge renderer.
 *
 * Uses triangle strips (ribbons) with custom ShaderMaterial for:
 * - A screen-constant 2px core with a soft glow, anti-aliased via SDF
 * - Source-to-target hue gradient, moving light on live edges, dashes on invalid ones
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

  // Entity map for O(1) lookups (synced with store, avoids getState() overhead in useFrame)
  const entityMapRef = useRef<Map<string, Entity>>(new Map());

  /**
   * Socket lookup for the geometry pass, NESTED rather than keyed by a joined string.
   *
   * The flat `"${entityId}:${socketId}:input"` form this replaces is still what `SocketIndexMap`
   * is in the public API, and it is fine everywhere it is asked once. Here it was asked TWICE PER
   * EDGE PER REBUILD — once for the source, once for the target — and each ask built the key
   * first. At a couple of thousand edges that is four thousand throwaway strings per rebuild, in
   * the pass that runs on every frame of a drag; the map lookup was never the cost, the
   * concatenation was.
   *
   * Two map hops instead, no allocation. Rebuilt exactly where the flat one used to be, on
   * add/remove, so nothing about invalidation changes.
   */
  const socketIndexMapRef = useRef<
    Map<string, EntitySocketIndex>
  >(new Map());

  // Dirty flags - separate geometry vs color-only vs layer-only updates
  const geometryDirtyRef = useRef(true);
  /**
   * The camera moved, and the rect the current vertex layout was built for.
   *
   * This layer had NO viewport cull whatever: every edge in the graph was tessellated into the
   * buffer and drawn, whether or not any part of it could reach the screen. At a few thousand
   * edges that is well over a million vertices a frame for a screenful of maybe fifty wires, and
   * the CPU paid for all of it again on every rebuild.
   *
   * Culling is only possible at a FULL rebuild, because the vertex slots it hands out are what the
   * drag path writes into — so the rect gets the same hysteresis every other layer uses, and a pan
   * inside the margin still costs nothing at all.
   */
  const viewMovedRef = useRef(false);
  const cameraRef = useRef<CameraGate | null>(null);
  if (cameraRef.current === null) cameraRef.current = new CameraGate();
  /** Segments the current layout was tessellated at; a change relays every slot. */
  const segmentsRef = useRef(SEGMENTS_PER_EDGE);
  const colorDirtyRef = useRef(true);
  const layerDirtyRef = useRef(false); // entity selection changed (edges move between bg/fg layers)

  // Per-edge vertex layout in buffer: parallel arrays for start offset and vertex count
  const edgeVertexStartsRef = useRef<Int32Array>(new Int32Array(0));
  const edgeVertexCountsRef = useRef<Int32Array>(new Int32Array(0));

  // Cached endpoint positions for dirty detection: flat [x0, y0, x1, y1] per edge
  const endpointCacheRef = useRef<Float64Array>(new Float64Array(0));

  // Per-edge layer cache: 0=bg, 1=fg (for detecting layer changes on selection)
  const edgeLayersRef = useRef<Uint8Array>(new Uint8Array(0));
  /**
   * Which edges the last full rebuild CULLED, as opposed to drew or found degenerate.
   *
   * The drag path needs to tell those three apart, and `evCounts[i] === 0` cannot: a culled edge
   * and a zero-length one both record no vertices, and only the first has to force a relayout when
   * it comes back into view. A flag written by the pass that made the decision says exactly which.
   */
  const edgeCulledRef = useRef<Uint8Array>(new Uint8Array(0));

  // Position-only dirty flag (enables partial update path, avoids full rebuild)
  const positionDirtyRef = useRef(false);

  // Reverse index: entityId → edge array indices (for O(K) partial updates)
  const entityToEdgeIndicesRef = useRef<Map<string, number[]>>(new Map());

  // The set of edges touched by this frame's move, held across frames rather than allocated
  // inside one. It is refilled from scratch every drag frame either way, and a whole-graph drag
  // makes every edge affected — so the old `new Set<number>()` built and discarded a
  // 2000-element Set sixty times a second for no benefit over reusing one.
  const affectedEdgeIndicesRef = useRef<Set<number>>(new Set());

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
  /**
   * Socket-type colours parsed once per socketTypes identity, not once per edge per frame.
   *
   * Both colour paths below used to call `tempColor.set(typeConfig.color)` for every edge they
   * touched, and each of those calls re-parses a hex string through THREE.Color.setStyle: a regex
   * match and three parseInts, producing numbers that are identical from frame to frame. A
   * whole-graph drag of 2000 edges paid 2000 of those per frame to read a table with a dozen
   * entries in it. The colours arrive here already resolved to hex by resolveSocketTypes, so they
   * can be parsed when the prop changes and read as three floats afterwards.
   */
  const socketTypeColors = useMemo(() => {
    const table = new Map<string, THREE.Color>();
    for (const [name, config] of Object.entries(socketTypes)) {
      if (config?.color) table.set(name, new THREE.Color(config.color));
    }
    return table;
  }, [socketTypes]);

  // Mark color dirty when theme colors change
  useEffect(() => {
    colorDirtyRef.current = true;
  }, [tokens]);

  // Shader materials — separate instances for bg/fg with different uMeshLayer uniform. The
  // per-appearance alphas are chosen here, once per theme, never per frame.
  const appearance = tokens.appearance;
  const bgMaterial = useMemo(() => createEdgeMaterial(appearance, 0), [appearance]);
  const fgMaterial = useMemo(() => createEdgeMaterial(appearance, 1), [appearance]);

  // True while any edge is animated or selected: the only time uTime has to move.
  const hasLiveRef = useRef(false);

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
        const hasInputs = n.inputs !== undefined && n.inputs.length > 0;
        const hasOutputs = n.outputs !== undefined && n.outputs.length > 0;
        if (!hasInputs && !hasOutputs) continue;
        const entry: EntitySocketIndex = { inputs: null, outputs: null };
        if (n.inputs) {
          const m = new Map<string, EdgeSocketInfo>();
          for (let i = 0; i < n.inputs.length; i++) {
            const sock = n.inputs[i];
            m.set(sock.id, { index: i, socket: sock });
          }
          entry.inputs = m;
        }
        if (n.outputs) {
          const m = new Map<string, EdgeSocketInfo>();
          for (let i = 0; i < n.outputs.length; i++) {
            const sock = n.outputs[i];
            m.set(sock.id, { index: i, socket: sock });
          }
          entry.outputs = m;
        }
        socketIndexMapRef.current.set(n.id, entry);
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
    // Hidden entities: changes only on collapse/expand, so no per-frame cost. Without it, an edge
    // between two children of a collapsed group stays drawn inside the frame that is supposed to
    // have swallowed them.
    const unsubHidden = store.subscribe(
      (state) => state.hiddenEntityIds,
      () => {
        geometryDirtyRef.current = true;
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

    /**
     * The camera, as a question — see `viewMovedRef`. The frame loop decides whether the move took
     * the screen out of the rect the current layout was culled for; marking geometry dirty here
     * would re-tessellate every edge on every pointermove of a pan, which is exactly what having
     * no viewport subscription at all was avoiding before there was a cull to keep honest.
     */
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { viewMovedRef.current = true; }
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
      unsubViewport();
      unsubHidden();
      unsubEdges();
      unsubSelection();
      unsubEntitySelection();
    };
  }, [store]);

  /**
   * Teardown, split out of the subscription effect above rather than left in it with narrower deps.
   *
   * The two concerns had one dep array and it could only be right for one of them: the
   * subscriptions want `[store]`, the materials want themselves, and `[store, bgMaterial,
   * fgMaterial]` meant every store swap tore down and rebuilt both — disposing a material the next
   * render immediately re-acquires. Two effects make the dep array unable to lie.
   *
   * See nodes.tsx for why a dispose dep is the memoised value itself.
   */
  useEffect(() => () => { bgMaterial.dispose(); fgMaterial.dispose(); }, [bgMaterial, fgMaterial]);

  // RAF-synchronized updates
  useFrame(({ size, clock }) => {
    if (!bgMeshRef.current || !fgMeshRef.current) return;
    const camera = cameraRef.current as CameraGate;

    const { edges, viewport, selectedEdgeIds, selectedEntityIds, entityMap, hiddenEntityIds } =
      store.getState();
    // Always read entityMap from store (not cached ref) because setEntities
    // creates a new Map without changing entities.length, which would leave
    // entityMapRef stale. The store's getState() is synchronous and cheap.
    entityMapRef.current = entityMap;

    // Always update zoom uniform on both materials (cheap operation). The glow fades with it.
    const halfWidth = edgeHalfWidthAtZoom(viewport.zoom);
    bgMaterial.uniforms.uZoom.value = viewport.zoom;
    fgMaterial.uniforms.uZoom.value = viewport.zoom;
    bgMaterial.uniforms.uHalfWidth.value = halfWidth;
    fgMaterial.uniforms.uHalfWidth.value = halfWidth;
    // The clock only reaches the shader while something is lit; a still graph never re-uploads.
    if (hasLiveRef.current) {
      bgMaterial.uniforms.uTime.value = clock.elapsedTime;
      fgMaterial.uniforms.uTime.value = clock.elapsedTime;
    }

    // Mark dirty on canvas resize (prevents ghosting)
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
      geometryDirtyRef.current = true;
    }

    /**
     * Has the camera left the rect the current layout was culled for, or crossed a tessellation
     * band? Either answer relays every vertex slot, so both mean a full rebuild — and on every
     * other frame of a pan this costs four comparisons and changes nothing.
     */
    if (viewMovedRef.current) {
      viewMovedRef.current = false;
      if (
        camera.moved(
          viewport.x,
          viewport.y,
          viewport.zoom,
          size.width,
          size.height,
          EDGE_CULL_PADDING / viewport.zoom
        ) ||
        /**
         * The tessellation, asked separately from the gate's band.
         *
         * The two quantise zoom differently — the gate at eight steps per octave, this at one —
         * and an octave boundary can fall INSIDE one of the gate's bands, so crossing z = 0.5
         * halves the right segment count without moving the band. Nothing is corrupted when that
         * is missed (the slots and the count stay in step; only the LOD is stale until the next
         * rebuild), but the curve quality would be a frame behind the wheel for no reason.
         */
        segmentsForZoom(viewport.zoom) !== segmentsRef.current
      ) {
        geometryDirtyRef.current = true;
      }
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

    // The per-edge layer cache was allocated at length 0 and never grown, while its three
    // siblings were. Writes past a typed array's end are SILENTLY discarded and reads return
    // undefined, so `newLayer !== edgeLayers[i]` was always true and the selection-change fast
    // path rewrote every vertex of every edge — exactly the work the cache exists to avoid.
    //
    // It has to grow HERE, before either path reads it: the fast path below and the full rebuild
    // further down both take their reference from this ref, and ensureCapacity early-returns on
    // vertex capacity so it cannot own this.
    if (edgeLayersRef.current.length < edges.length) {
      const grownLayers = new Uint8Array(Math.ceil(edges.length * BUFFER_GROWTH_FACTOR));
      grownLayers.set(edgeLayersRef.current);
      edgeLayersRef.current = grownLayers;
      const grownCulled = new Uint8Array(grownLayers.length);
      grownCulled.set(edgeCulledRef.current);
      edgeCulledRef.current = grownCulled;
    }

    const plan = planEdgeUpdate({
      geometry: geometryDirtyRef.current,
      position: positionDirtyRef.current,
      color: colorDirtyRef.current,
      layer: layerDirtyRef.current,
    });

    // Layer pass: flip aLayer for edges whose bg/fg assignment changed. It runs OUTSIDE the
    // fast path below because a selection change and a move can land in the same frame — see
    // planEdgeUpdate for the drag that dropped the flip when this was gated on nothing moving.
    if (plan.layer) {
      const evStarts = edgeVertexStartsRef.current;
      const evCounts = edgeVertexCountsRef.current;
      const edgeLayers = edgeLayersRef.current;

      // Highest vertex the foreground mesh can need this frame. Both meshes used to draw the
      // whole buffer and let the shader throw away what did not belong to them, so with nothing
      // selected the foreground pass ran a vertex shader over every vertex of every edge to emit
      // precisely nothing — half a million invocations a frame for an empty result.
      //
      // The bound is the END OF THE LAST SELECTED EDGE'S SLOT, read from the next edge's
      // recorded start rather than from this edge's vertex count. A partial update can write
      // fewer vertices than the rebuild laid out, because it skips degenerate segments, and can
      // write them back on a later frame; a bound taken from evCounts would then be too low and
      // would clip the tail off a selected edge mid-drag. Starts are monotonic, so the next
      // edge's start is the slot boundary and never moves.
      let fgVertexMax = 0;
      // The span of `aLayer` this pass actually flipped. Without it the upload below is the whole
      // capacity-sized array — which at two thousand edges is about 4.8 MB, to change the layer of
      // however many edges a click moved between the two meshes.
      let flippedMin = Number.POSITIVE_INFINITY;
      let flippedMax = -1;
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
          if (count > 0) {
            if (start < flippedMin) flippedMin = start;
            if (start + count > flippedMax) flippedMax = start + count;
          }
        }
        if (newLayer === 1) {
          fgVertexMax = i + 1 < edges.length ? evStarts[i + 1] : buffers.lastVertexCount;
        }
      }
      if (buffers.layerAttr && flippedMax > flippedMin) {
        buffers.layerAttr.addUpdateRange(flippedMin, flippedMax - flippedMin);
        buffers.layerAttr.needsUpdate = true;
      }
      fgMeshRef.current.geometry.setDrawRange(0, fgVertexMax);
      layerDirtyRef.current = false;
    }

    // Fast path: colour-only frame. Nothing moved and nothing was rebuilt, so the recorded vertex
    // layout still describes the buffer and only aColor needs rewriting.
    if (plan.geometry === 'none') {
      const evStarts = edgeVertexStartsRef.current;
      const evCounts = edgeVertexCountsRef.current;

      // Color update: update colors for all edges using recorded vertex layout. The state bits
      // ride in uv2.y, so a selection flip rewrites that too — over the same range, marked the
      // same way — and the gradient reads `u` back from the buffer it is already in.
      if (plan.color) {
        let anyLive = false;
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const vertexStart = evStarts[i];
          const vertexCount = evCounts[i];
          if (vertexCount === 0) continue;

          const selected = selectedEdgeIds.has(edge.id);
          const flags = packEdgeFlags(edge.animated === true, selected, edge.invalid === true);
          if (edge.animated || selected) anyLive = true;

          let cr: number, cg: number, cb: number;
          let tr: number, tg: number, tb: number;
          if (selected) {
            cr = tr = selectedColor.r;
            cg = tg = selectedColor.g;
            cb = tb = selectedColor.b;
          } else if (edge.invalid) {
            cr = tr = invalidColor.r;
            cg = tg = invalidColor.g;
            cb = tb = invalidColor.b;
          } else {
            const sourceInfo = edge.sourceSocket
              ? socketIndexMap.get(edge.source)?.outputs?.get(edge.sourceSocket)
              : undefined;
            const targetInfo = edge.targetSocket
              ? socketIndexMap.get(edge.target)?.inputs?.get(edge.targetSocket)
              : undefined;
            const sourceTypeColor = sourceInfo
              ? socketTypeColors.get(sourceInfo.socket.type) ?? socketTypeColors.get('any')
              : undefined;
            const targetTypeColor = targetInfo
              ? socketTypeColors.get(targetInfo.socket.type) ?? socketTypeColors.get('any')
              : undefined;
            const from = sourceTypeColor ?? defaultColor;
            const to = targetTypeColor ?? from;
            cr = from.r;
            cg = from.g;
            cb = from.b;
            tr = to.r;
            tg = to.g;
            tb = to.b;
          }
          const dr = tr - cr;
          const dg = tg - cg;
          const db = tb - cb;

          for (let v = 0; v < vertexCount; v++) {
            const uvIdx = (vertexStart + v) * 2;
            const colIdx = (vertexStart + v) * 3;
            const side = Math.sign(buffers.uvs[uvIdx + 1]);
            // An arrow vertex (side 0) is a solid marker in the target hue, not a graded one.
            const u = side === 0 ? 1 : buffers.uvs[uvIdx];
            buffers.uvs[uvIdx + 1] = packVertexSide(side, flags);
            buffers.colors[colIdx] = cr + dr * u;
            buffers.colors[colIdx + 1] = cg + dg * u;
            buffers.colors[colIdx + 2] = cb + db * u;
          }
        }
        // Ranged to what is drawn: both arrays are capacity-sized (1.5x the edges), and a bare
        // needsUpdate handed three the whole thing — at 1.8k edges, ~10 MB per selection change,
        // most of it past lastVertexCount and never drawn.
        if (buffers.colorAttr) {
          buffers.colorAttr.addUpdateRange(0, buffers.lastVertexCount * 3);
          buffers.colorAttr.needsUpdate = true;
        }
        if (buffers.uvAttr) {
          buffers.uvAttr.addUpdateRange(0, buffers.lastVertexCount * 2);
          buffers.uvAttr.needsUpdate = true;
        }
        hasLiveRef.current = anyLive;
        colorDirtyRef.current = false;
      }

      return;
    }

    // Determine update mode: partial (position-only) vs full rebuild
    const isPartialUpdate = plan.geometry === 'partial';

    /**
     * A full rebuild re-cuts the cull rect and re-picks the tessellation; a partial one inherits
     * both, because the slots it writes into were laid out under them.
     */
    if (!isPartialUpdate) {
      // The pad covers a bezier's bulge past its endpoints and the glow's screen-space reach; the
      // gate adds the hysteresis fraction on top of it.
      camera.moved(
        viewport.x,
        viewport.y,
        viewport.zoom,
        size.width,
        size.height,
        EDGE_CULL_PADDING / viewport.zoom
      );
      segmentsRef.current = segmentsForZoom(viewport.zoom);
    }
    const cullRect = camera.rect;
    const segments = segmentsRef.current;

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
      const movedIds = store.getState().getMovedEntityIds();
      const entityEdgeMap = entityToEdgeIndicesRef.current;
      if (movedIds.size > 0 && entityEdgeMap.size > 0) {
        affectedEdgeIndices = affectedEdgeIndicesRef.current;
        affectedEdgeIndices.clear();
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
    // Foreground high-water mark, kept in step with the layer writes below so the fg mesh draws
    // only as far as the last selected edge. See the layer pass above for why it exists.
    let fgVertexMax = 0;
    const edgeLayers = edgeLayersRef.current;
    const edgeCulled = edgeCulledRef.current;
    // Whether any edge visited wants the clock. Only a full rebuild sees every edge, so only a
    // full rebuild is allowed to write it back.
    let anyLive = false;

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

        // A missing endpoint, or a HIDDEN one. Both endpoints are tested: an edge crossing a
        // collapse boundary has one visible end and belongs to neither side, so hiding it on
        // either is right — the frame is what the user sees, and a bezier reaching out of a
        // collapsed box to a node that is not drawn is a line to nowhere.
        if (
          !sourceEntity ||
          !targetEntity ||
          hiddenEntityIds.has(edge.source) ||
          hiddenEntityIds.has(edge.target)
        ) {
          // Record zero-vertex layout for this edge. Deliberately NOT flagged as culled: a
          // hidden endpoint becomes visible only through a collapse or expand, which is a topology
          // change and already a full rebuild — and flagging it would force one on every frame of
          // a collapsed group being dragged, since its hidden children move with it.
          evStarts[i] = vertexIndex;
          evCounts[i] = 0;
          continue;
        }

        // Socket geometry comes from utils/geometry, which is the same arithmetic the socket
        // index and getSocketPosition use. This block used to re-derive it with
        // `max(1, out + in) * rowHeight` — a UNIFORM row height — which is right only when every
        // row is the same height, i.e. on every entity in a uniform fixture and on none of the
        // awkward ones. Measured against the socket index before this change: an edge into a
        // stacked socket landed 10px off, into a three-row widget 40px off, and into a socket
        // with an explicit height 28px off. The bezier simply did not touch the dot it named.
        const sourceHeight =
          sourceEntity.height ?? getEntitySocketLayout(sourceEntity, socketLayout).computedHeight;
        const targetHeight =
          targetEntity.height ?? getEntitySocketLayout(targetEntity, socketLayout).computedHeight;

        // Resolved once and read twice: the geometry needs the socket's row index and the colour
        // block below needs the socket's type, and both used to build the same key string and hit
        // the same map inside the same iteration. Looking it up here keeps the read live — the
        // socket index map is rebuilt from the store, never cached per edge, so nothing here can
        // outlive a socket being added, removed or reordered.
        const sourceSocketInfo = edge.sourceSocket
          ? socketIndexMap.get(edge.source)?.outputs?.get(edge.sourceSocket)
          : undefined;

        // Fallback to the entity's centre for an edge that names no socket.
        let sourceYOffset = sourceHeight / 2;
        if (sourceSocketInfo) {
          sourceYOffset = getSocketYOffset(sourceEntity, sourceSocketInfo.index, false, socketLayout);
        }

        // Hoisted for the same reason as the source: the gradient's far end is this socket's hue.
        const targetSocketInfo = edge.targetSocket
          ? socketIndexMap.get(edge.target)?.inputs?.get(edge.targetSocket)
          : undefined;

        let targetYOffset = targetHeight / 2;
        if (targetSocketInfo) {
          targetYOffset = getSocketYOffset(targetEntity, targetSocketInfo.index, true, socketLayout);
        }

        // Edge endpoints at actual socket positions (outside entity body)
        /**
         * THE RIM, NOT THE CENTRE — and a leader before the curve.
         *
         * An edge used to be drawn to the socket's own point, which is its CENTRE, so the ribbon
         * ran under the dot and out the other side: on a hollow socket you could see the wire
         * inside the ring's hole, and nothing about the join read as a plug. The 1.5px punch of
         * canvas colour around every dot was there to hide that crossing, which is why a connected
         * edge appeared to stop short and fade a pixel from the thing it names.
         *
         * An edge now starts where the socket's edge is, and leaves along the socket's own axis —
         * an output to the right, an input to the left — for a short straight leader before the
         * curve takes over. The leader is what gives the join a direction you can read, and it is
         * why the curve no longer has to aim at a point it cannot reach.
         */
        const cx0 = getSocketWorldX(sourceEntity, false);
        const cy0 = sourceEntity.position.y + sourceYOffset;
        const cx1p = getSocketWorldX(targetEntity, true);
        const cy1p = targetEntity.position.y + targetYOffset;
        // An edge that names no socket lands on the entity's centre, where there is no rim to
        // leave from and no axis to leave along: it keeps the old behaviour.
        const sourceRim = sourceSocketInfo ? EDGE_SOCKET_RIM : 0;
        const targetRim = targetSocketInfo ? EDGE_SOCKET_RIM : 0;
        const x0 = cx0 + sourceRim;
        const y0 = cy0;
        const x1 = cx1p - targetRim;
        const y1 = cy1p;
        const lead0 = sourceSocketInfo ? EDGE_LEADER : 0;
        const lead1 = targetSocketInfo ? EDGE_LEADER : 0;

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
        /**
         * The curve spans the LEADER ENDS, not the sockets, so every control point below is
         * derived from those. Measured from the sockets instead, a short edge put its first control
         * point almost on top of the leader's end and the opening segment collapsed — the
         * degenerate-segment guard dropped it, and the ribbon started a leader's length away from
         * the plug it was supposed to be welded to. That gap is what this arithmetic exists to
         * close.
         */
        const lead0X = x0 + lead0;
        const lead1X = x1 - lead1;
        const dx = lead1X - lead0X;
        const dy = y1 - y0;
        const absDx = Math.abs(dx);

        let cx1: number, cy1: number, cx2: number, cy2: number;

        if (edgeType === 'straight') {
          cx1 = lead0X;
          cy1 = y0;
          cx2 = lead1X;
          cy2 = y1;
        } else if (edgeType === 'step') {
          // For step edges, the midpoint extends the bounds
          const midX = lead0X + dx / 2;
          cx1 = midX;
          cy1 = y0;
          cx2 = midX;
          cy2 = y1;
        } else if (edgeType === 'smoothstep') {
          // Smoothstep: constrained curve, scales with distance
          const offset = Math.min(absDx * 0.5, 100);
          cx1 = lead0X + offset;
          cy1 = y0;
          cx2 = lead1X - offset;
          cy2 = y1;
        } else {
          // The same reach the dragged wire and the hit test use; see utils/edge-curve.ts.
          const offset = bezierControlOffset(dx, dy);
          cx1 = lead0X + offset;
          cy1 = y0;
          cx2 = lead1X - offset;
          cy2 = y1;
        }

        /**
         * THE CULL, and the only place it can happen.
         *
         * A cubic lies inside the convex hull of its control points, so the box spanned by the two
         * endpoints and the two control points bounds the whole ribbon — bulge included, which is
         * why this waits until after the control points are known. `cullRect` already carries the
         * glow's reach and the hysteresis margin.
         *
         * A culled edge records a ZERO-LENGTH SLOT and writes nothing. That is safe only on a full
         * rebuild, which is why a pan that leaves the margin forces one: the drag path writes into
         * the slots this pass hands out, and it is guarded below for the case where one it needs
         * has no room.
         */
        {
          const boxLeft = Math.min(x0, x1, cx1, cx2);
          const boxRight = Math.max(x0, x1, cx1, cx2);
          const boxTop = Math.min(y0, y1, cy1, cy2);
          const boxBottom = Math.max(y0, y1, cy1, cy2);
          if (
            boxRight < cullRect.left ||
            boxLeft > cullRect.right ||
            boxBottom < cullRect.top ||
            boxTop > cullRect.bottom
          ) {
            if (!isPartialUpdate) {
              evStarts[i] = vertexIndex;
              evCounts[i] = 0;
              edgeLayers[i] = 0;
              edgeCulled[i] = 1;
            }
            continue;
          }
        }

        /**
         * An edge ARRIVING, on a drag.
         *
         * The partial path writes into the layout the last full rebuild produced, and a culled
         * edge was given no room in it. Reaching this line with the culled flag set means the drag
         * has carried the edge INTO the rect since that rebuild — one still outside it left at the
         * cull above — so the layout has to be relaid before it can be drawn. The rebuild is asked
         * for and this frame leaves the edge alone.
         *
         * The cull above is what keeps this cheap: a multi-select drag of mostly off-screen edges
         * never reaches here, so it does not force a rebuild on every frame — which is the whole
         * reason the position path exists.
         *
         * THE FLAG, NOT A VERTEX BUDGET. The first cut of this compared the worst-case vertex
         * count for the current tessellation against the room between this edge's start and the
         * next one's — and the slots a rebuild hands out are TIGHT, sized to what each edge
         * actually wrote, so an edge with no arrowheads is always a few vertices short of the
         * worst case. It tripped for nearly every edge, on every frame of every drag, and turned
         * the fast path into a full rebuild each time: the exact cost this whole file is arranged
         * to avoid, added by the guard meant to protect it.
         */
        if (isPartialUpdate && edgeCulled[i]) {
          geometryDirtyRef.current = true;
          continue;
        }

        // Edge colour is a gradient, source-socket hue at u=0 to target-socket hue at u=1, so a
        // float feeding an image reads as blue becoming purple. Selected and invalid are one hue
        // at both ends. edge.invalid is set when edges are created via UI (no runtime type checking
        // for performance).
        const selected = selectedEdgeIds.has(edge.id);
        const flags = packEdgeFlags(edge.animated === true, selected, edge.invalid === true);
        if (edge.animated || selected) anyLive = true;
        let cr: number, cg: number, cb: number;
        let tr: number, tg: number, tb: number;
        if (selected) {
          cr = tr = selectedColor.r;
          cg = tg = selectedColor.g;
          cb = tb = selectedColor.b;
        } else if (edge.invalid) {
          cr = tr = invalidColor.r;
          cg = tg = invalidColor.g;
          cb = tb = invalidColor.b;
        } else {
          // O(1) from the sockets resolved above and the pre-parsed colour table. A target with
          // no socket takes the source hue, so an edge into an entity's centre stays one colour.
          const sourceTypeColor = sourceSocketInfo
            ? socketTypeColors.get(sourceSocketInfo.socket.type) ?? socketTypeColors.get('any')
            : undefined;
          const targetTypeColor = targetSocketInfo
            ? socketTypeColors.get(targetSocketInfo.socket.type) ?? socketTypeColors.get('any')
            : undefined;
          const from = sourceTypeColor ?? defaultColor;
          const to = targetTypeColor ?? from;
          cr = from.r;
          cg = from.g;
          cb = from.b;
          tr = to.r;
          tg = to.g;
          tb = to.b;
        }
        const dr = tr - cr;
        const dg = tg - cg;
        const db = tb - cb;
        // uv2.y for the two ribbon sides, with the state bits in the magnitude.
        const sideTop = packVertexSide(1, flags);
        const sideBottom = packVertexSide(-1, flags);

        // Generate curve points into pre-allocated buffer (avoids GC)
        // points buffer stores [x0, y0, x1, y1, ...] as flat array
        const points = buffers.points;
        let pointsCount = 0;

        if (edgeType === 'step') {
          // Step: horizontal → vertical → horizontal
          const midX = lead0X + dx / 2;
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
          /**
           * The leader, then the curve. The straight run leaves the socket along its own axis, and
           * the curve is sampled between the leader's ends rather than between the sockets — so the
           * ribbon is continuous through the joint instead of kinking at it.
           */
          const lx0 = x0 + lead0;
          const lx1 = x1 - lead1;
          for (let s = 0; s <= segments; s++) {
            const t = s / segments;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;

            const idx = (s + 1) * 2;
            points[idx] = mt3 * lx0 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * lx1;
            points[idx + 1] = mt3 * y0 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * y1;
          }
          // The two leader ends, in front of and behind the sampled curve.
          points[0] = x0;
          points[1] = y0;
          const tail = (segments + 2) * 2;
          points[tail] = x1;
          points[tail + 1] = y1;
          pointsCount = segments + 3;
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
          buffers.uvs[uvIdx + 1] = sideTop;
          buffers.colors[colIdx] = cr + dr * u0;
          buffers.colors[colIdx + 1] = cg + dg * u0;
          buffers.colors[colIdx + 2] = cb + db * u0;
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
          buffers.uvs[uvIdx + 1] = sideBottom;
          buffers.colors[colIdx] = cr + dr * u0;
          buffers.colors[colIdx + 1] = cg + dg * u0;
          buffers.colors[colIdx + 2] = cb + db * u0;
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
          buffers.uvs[uvIdx + 1] = sideTop;
          buffers.colors[colIdx] = cr + dr * u1;
          buffers.colors[colIdx + 1] = cg + dg * u1;
          buffers.colors[colIdx + 2] = cb + db * u1;
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
          buffers.uvs[uvIdx + 1] = sideTop;
          buffers.colors[colIdx] = cr + dr * u1;
          buffers.colors[colIdx + 1] = cg + dg * u1;
          buffers.colors[colIdx + 2] = cb + db * u1;
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
          buffers.uvs[uvIdx + 1] = sideBottom;
          buffers.colors[colIdx] = cr + dr * u0;
          buffers.colors[colIdx + 1] = cg + dg * u0;
          buffers.colors[colIdx + 2] = cb + db * u0;
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
          buffers.uvs[uvIdx + 1] = sideBottom;
          buffers.colors[colIdx] = cr + dr * u1;
          buffers.colors[colIdx + 1] = cg + dg * u1;
          buffers.colors[colIdx + 2] = cb + db * u1;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
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
          buffers.colors[colIdx] = tr;
          buffers.colors[colIdx + 1] = tg;
          buffers.colors[colIdx + 2] = tb;
          buffers.perpendiculars[perpIdx] = 0;
          buffers.perpendiculars[perpIdx + 1] = 0;
          vertexIndex++;
        }

        // Record edge vertex layout for partial updates
        evStarts[i] = edgeVertexStart;
        evCounts[i] = vertexIndex - edgeVertexStart;
        // Drawn, so not culled — including the degenerate case, which writes nothing and must not
        // be mistaken for an edge that was left out of the layout.
        if (!isPartialUpdate) edgeCulled[i] = 0;

        // Write layer attribute for this edge's vertices (full rebuild only)
        if (!isPartialUpdate) {
          const layer =
            selectedEntityIds.has(edge.source) || selectedEntityIds.has(edge.target) ? 1 : 0;
          edgeLayers[i] = layer;
          for (let v = edgeVertexStart; v < vertexIndex; v++) {
            buffers.layers[v] = layer;
          }
          if (layer === 1) fgVertexMax = vertexIndex;
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
      /**
       * Full upload, ranged to the vertices this rebuild WROTE.
       *
       * These five arrays are sized to `capacity * VERTICES_PER_EDGE`, and capacity is grown 1.5x
       * ahead of the edge count — so at two thousand edges they hold 1.2 million vertices between
       * them whatever is on screen. A bare `needsUpdate` with no range hands three all of it:
       * `WebGLAttributes.updateBuffer` falls back to `bufferSubData(type, 0, array)` when
       * `updateRanges` is empty, which is about 53 MB per rebuild.
       *
       * That was invisible while nothing a CAMERA did could reach this path — it fired on a
       * topology or selection change and no more. Culling the layer gave a zoom band crossing a
       * reason to rebuild, and the counts spike measured the result at 13 MB per frame of a wheel
       * zoom. The draw range below stops at `vertexIndex`, so every byte past it is unread; a
       * freshly grown attribute still gets a full `bufferData` on its first upload, which is what
       * keeps the untouched tail from being garbage.
       */
      if (vertexIndex > 0 && buffers.positionAttr && buffers.uvAttr && buffers.colorAttr && buffers.perpAttr) {
        buffers.positionAttr.addUpdateRange(0, vertexIndex * 3);
        buffers.positionAttr.needsUpdate = true;
        buffers.uvAttr.addUpdateRange(0, vertexIndex * 2);
        buffers.uvAttr.needsUpdate = true;
        buffers.colorAttr.addUpdateRange(0, vertexIndex * 3);
        buffers.colorAttr.needsUpdate = true;
        buffers.perpAttr.addUpdateRange(0, vertexIndex * 2);
        buffers.perpAttr.needsUpdate = true;
        if (buffers.layerAttr) {
          buffers.layerAttr.addUpdateRange(0, vertexIndex);
          buffers.layerAttr.needsUpdate = true;
        }
      }
    }

    // Set draw ranges. The background mesh covers everything and the shader drops the selected
    // vertices out of it; the foreground mesh stops at the last selected edge, which is zero when
    // nothing is selected and saves that whole pass.
    if (!isPartialUpdate) {
      bgMeshRef.current!.geometry.setDrawRange(0, vertexIndex);
      fgMeshRef.current!.geometry.setDrawRange(0, fgVertexMax);
      buffers.lastVertexCount = vertexIndex;
      hasLiveRef.current = anyLive;
    }
    geometryDirtyRef.current = false;
    positionDirtyRef.current = false;
    // A partial update rewrites only the edges that moved, so a colour change asked for in the
    // same frame has not been serviced for the rest of the graph. Clearing the flag here would
    // throw that request away the way the layer flip used to be thrown away; leaving it set costs
    // one colour pass on the first frame after the drag settles.
    if (!isPartialUpdate) colorDirtyRef.current = false;
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
