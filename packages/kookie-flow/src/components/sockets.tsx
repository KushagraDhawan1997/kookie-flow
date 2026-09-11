import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import {
  DEFAULT_SOCKET_TYPES,
  SOCKET_RADIUS,
} from '../core/constants';
import { getSocketWorldX, getSocketYOffset } from '../utils/geometry';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { areTypesCompatible } from '../utils/connections';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import type { Edge, Entity, SocketType } from '../types';
import { rgbToHex } from '../utils/color';
import { entityDepth, DEPTH_LAYER } from '../utils/entity-depth';

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;

// Render order constants for z-index layering across components
const RENDER_ORDER_BG = 2; // Non-selected sockets (above non-selected entities)
const RENDER_ORDER_FG = 5; // Selected sockets (above selected entities)

/**
 * The quad each socket is painted on, in world px. Not `SOCKET_RADIUS`.
 *
 * `SOCKET_RADIUS` (6) is the HIT radius — the quadtree, `geometry.ts` and every press answer with
 * it, and the dot is still drawn at exactly that size. The quad is wider only to hold what sits
 * around the dot: a 1.5px punch ring of canvas colour and a halo that dies at r 10. Ten is chosen
 * against `SOCKET_OFFSET` (12): the halo runs out before it reaches the card edge, so nothing this
 * shader paints ever lands on a body. Exported for the value law in sockets.test.ts.
 */
export const SOCKET_GL_RADIUS = 10;

interface SocketBuffers {
  colors: Float32Array;
  hovered: Float32Array;
  connected: Float32Array;
  validTarget: Float32Array;
  invalidHover: Float32Array;
  layers: Float32Array;
  colorAttr: THREE.InstancedBufferAttribute | null;
  hoveredAttr: THREE.InstancedBufferAttribute | null;
  connectedAttr: THREE.InstancedBufferAttribute | null;
  validTargetAttr: THREE.InstancedBufferAttribute | null;
  invalidHoverAttr: THREE.InstancedBufferAttribute | null;
  layerAttr: THREE.InstancedBufferAttribute | null;
}

function createSocketBuffers(capacity: number): SocketBuffers {
  return {
    colors: new Float32Array(capacity * 3),
    hovered: new Float32Array(capacity),
    connected: new Float32Array(capacity),
    validTarget: new Float32Array(capacity),
    invalidHover: new Float32Array(capacity),
    layers: new Float32Array(capacity),
    colorAttr: null,
    hoveredAttr: null,
    connectedAttr: null,
    validTargetAttr: null,
    invalidHoverAttr: null,
    layerAttr: null,
  };
}

function initSharedSocketBuffers(
  bgMesh: THREE.InstancedMesh,
  fgMesh: THREE.InstancedMesh,
  bufs: SocketBuffers,
) {
  bufs.colorAttr = new THREE.InstancedBufferAttribute(bufs.colors, 3);
  bufs.colorAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.hoveredAttr = new THREE.InstancedBufferAttribute(bufs.hovered, 1);
  bufs.hoveredAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.connectedAttr = new THREE.InstancedBufferAttribute(bufs.connected, 1);
  bufs.connectedAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.validTargetAttr = new THREE.InstancedBufferAttribute(bufs.validTarget, 1);
  bufs.validTargetAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.invalidHoverAttr = new THREE.InstancedBufferAttribute(bufs.invalidHover, 1);
  bufs.invalidHoverAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.layerAttr = new THREE.InstancedBufferAttribute(bufs.layers, 1);
  bufs.layerAttr.setUsage(THREE.DynamicDrawUsage);

  // Set shared attributes on BOTH geometries
  for (const mesh of [bgMesh, fgMesh]) {
    mesh.geometry.setAttribute('aColor', bufs.colorAttr);
    mesh.geometry.setAttribute('aHovered', bufs.hoveredAttr);
    mesh.geometry.setAttribute('aConnected', bufs.connectedAttr);
    mesh.geometry.setAttribute('aValidTarget', bufs.validTargetAttr);
    mesh.geometry.setAttribute('aInvalidHover', bufs.invalidHoverAttr);
    mesh.geometry.setAttribute('aLayer', bufs.layerAttr);
  }

  // Share instance matrix: both meshes use bgMesh's matrix buffer
  bgMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fgMesh.instanceMatrix = bgMesh.instanceMatrix;
}

/**
 * A whole-buffer upload, for the paths that rewrote the whole buffer.
 *
 * The update ranges have to be cleared first. three only empties them when it actually uploads,
 * so a range left behind by a partial update that never reached the GPU — the mesh drew nothing
 * that frame, say — would silently turn this full upload into that one stale sliver.
 */
function markSocketBuffersForUpload(bufs: SocketBuffers) {
  if (bufs.colorAttr) { bufs.colorAttr.clearUpdateRanges(); bufs.colorAttr.needsUpdate = true; }
  if (bufs.hoveredAttr) { bufs.hoveredAttr.clearUpdateRanges(); bufs.hoveredAttr.needsUpdate = true; }
  if (bufs.connectedAttr) { bufs.connectedAttr.clearUpdateRanges(); bufs.connectedAttr.needsUpdate = true; }
  if (bufs.validTargetAttr) { bufs.validTargetAttr.clearUpdateRanges(); bufs.validTargetAttr.needsUpdate = true; }
  if (bufs.invalidHoverAttr) { bufs.invalidHoverAttr.clearUpdateRanges(); bufs.invalidHoverAttr.needsUpdate = true; }
  if (bufs.layerAttr) { bufs.layerAttr.clearUpdateRanges(); bufs.layerAttr.needsUpdate = true; }
}

/**
 * Upload only the instances a fast path actually rewrote.
 *
 * These buffers are sized to CAPACITY, not to the live socket count, so a bare `needsUpdate`
 * hands three the entire array: at a thousand nodes the instance matrix alone is over half a
 * megabyte, re-sent every drag frame for the handful of floats one moved node changed. three
 * merges overlapping ranges itself inside `updateBuffer` and clears them once the upload lands,
 * so a caller only has to declare the span it touched.
 */
function markSocketRangeForUpload(bufs: SocketBuffers, start: number, count: number) {
  if (count <= 0) return;
  if (bufs.colorAttr) { bufs.colorAttr.addUpdateRange(start * 3, count * 3); bufs.colorAttr.needsUpdate = true; }
  if (bufs.hoveredAttr) { bufs.hoveredAttr.addUpdateRange(start, count); bufs.hoveredAttr.needsUpdate = true; }
  if (bufs.connectedAttr) { bufs.connectedAttr.addUpdateRange(start, count); bufs.connectedAttr.needsUpdate = true; }
  if (bufs.validTargetAttr) { bufs.validTargetAttr.addUpdateRange(start, count); bufs.validTargetAttr.needsUpdate = true; }
  if (bufs.invalidHoverAttr) { bufs.invalidHoverAttr.addUpdateRange(start, count); bufs.invalidHoverAttr.needsUpdate = true; }
}

/**
 * Build the per-entity, per-direction index of which sockets carry an edge.
 *
 * Kept out of the component so both the edges subscription and the initial seed use one
 * implementation; they drifted apart as two copies of the same loop.
 */
export function indexConnectedSockets(
  edges: readonly Edge[],
  inputs: Map<string, Set<string>>,
  outputs: Map<string, Set<string>>
): void {
  for (const edge of edges) {
    if (edge.sourceSocket) {
      let set = outputs.get(edge.source);
      if (!set) {
        set = new Set();
        outputs.set(edge.source, set);
      }
      set.add(edge.sourceSocket);
    }
    if (edge.targetSocket) {
      let set = inputs.get(edge.target);
      if (!set) {
        set = new Set();
        inputs.set(edge.target, set);
      }
      set.add(edge.targetSocket);
    }
  }
}

interface SocketsProps {
  socketTypes?: Record<string, SocketType>;
}

export function Sockets({
  socketTypes = DEFAULT_SOCKET_TYPES,
}: SocketsProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const bgMeshRef = useRef<THREE.InstancedMesh>(null);
  const fgMeshRef = useRef<THREE.InstancedMesh>(null);

  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const dirtyRef = useRef(true);
  const positionDirtyRef = useRef(false);
  /**
   * Hover gets its own flag, because it used to share `dirtyRef` with structural change.
   *
   * A pointer crossing a row of sockets flips `hoveredSocketId` twice per socket, and each flip
   * re-ran the whole graph's socket build — every matrix, every colour, every attribute, then a
   * full upload of all six buffers — to change one instance's `hovered` float from 0 to 1. The set
   * records which entities the hover moved between, since several flips can land between two
   * frames and only the frame gets to write.
   */
  const hoverDirtyRef = useRef(false);
  const hoverTouchedRef = useRef<Set<string>>(new Set());
  const lastPosVersionRef = useRef(-1);
  const initializedRef = useRef(false);

  // Reverse index: entityId → the run of instances that entity owns, for O(K) position updates.
  // It used to carry a `mesh: 'bg' | 'fg'` field as well, read only by a selection fast path that
  // could never execute. Both meshes draw every instance and the shader picks by `aLayer`, so
  // nothing else ever needed to know which of the two an entity "belongs" to.
  const entitySocketRangesRef = useRef<Map<string, { start: number; count: number }>>(new Map());

  // Derive colors from semantic theme config
  const invalidColor = tokens[THEME_COLORS.socket.invalid];
  const validTargetColor = tokens[THEME_COLORS.socket.validTarget];
  const fallbackSocketColor = rgbToHex(tokens[THEME_COLORS.socket.fallback]);
  // The punch ring paints the canvas back over whatever the dot sits on, so it needs the canvas's
  // own colour — a pair token, resolved per appearance at material build. Memoised on `tokens`
  // because `resolveColor` returns a fresh tuple, and the materials memoise on this value.
  const canvasColor = useMemo(() => resolveColor(THEME_COLORS.canvas.background, tokens), [tokens]);

  /**
   * Which sockets have an edge on them, indexed by entity and split by direction.
   *
   * This was one flat `Set<string>` of `entityId:socketId:input` keys, which meant the build loop
   * had to construct that key — a fresh template-literal string — for every socket in the graph on
   * every rebuild, just to ask a yes/no question. Five thousand sockets, five thousand throwaway
   * strings. Indexing by entity lets the loop look the entity's set up once and then ask about
   * each socket id it already holds, which allocates nothing at all. Rebuilt only when edges
   * change, never per frame.
   */
  const connectedInputsRef = useRef<Map<string, Set<string>>>(new Map());
  const connectedOutputsRef = useRef<Map<string, Set<string>>>(new Map());

  /**
   * Socket type colours, parsed once per theme instead of once per socket per rebuild.
   *
   * `tempColor.set(typeConfig.color)` is `THREE.Color.setStyle`, which runs two regexes and
   * allocates a match array. It sat in the innermost build loop, so a graph of a thousand nodes
   * re-parsed the same handful of CSS colour strings five thousand times on every rebuild —
   * measured at around 0.7ms of pure string work per hover. There are only ever as many distinct
   * colours as there are socket types, and they change only when the theme does.
   */
  const { typeRGB, defaultRGB } = useMemo(() => {
    const table = new Map<string, readonly [number, number, number]>();
    for (const typeName of Object.keys(socketTypes)) {
      tempColor.set(socketTypes[typeName].color);
      table.set(typeName, [tempColor.r, tempColor.g, tempColor.b] as const);
    }
    // Mirrors the old `socketTypes[type] ?? socketTypes.any ?? { color: fallback }` chain.
    let fallback = table.get('any');
    if (!fallback) {
      tempColor.set(fallbackSocketColor);
      fallback = [tempColor.r, tempColor.g, tempColor.b] as const;
    }
    return { typeRGB: table, defaultRGB: fallback };
  }, [socketTypes, fallbackSocketColor]);

  // Deferred capacity update (avoids React re-render inside useFrame)
  const pendingCapacityRef = useRef<number | null>(null);
  const capacityRafIdRef = useRef<number | null>(null);

  // Cache for source socket type lookup (avoids O(n) find per frame during connection draft)
  const sourceSocketCacheRef = useRef<{
    key: string;
    type: string;
  } | null>(null);

  // Track canvas size for resize detection
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // Mark dirty when theme colors change
  useEffect(() => {
    dirtyRef.current = true;
  }, [invalidColor, validTargetColor, fallbackSocketColor]);

  // Circle geometry — separate per mesh (attributes are per-geometry)
  const bgGeometry = useMemo(() => new THREE.CircleGeometry(SOCKET_GL_RADIUS, 16), []);
  const fgGeometry = useMemo(() => new THREE.CircleGeometry(SOCKET_GL_RADIUS, 16), []);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { bgGeometry.dispose(); fgGeometry.dispose(); }, [bgGeometry, fgGeometry]);

  // Shared shader code for socket rendering
  const vertexShader = /* glsl */ `
    attribute vec3 aColor;
    attribute float aHovered;
    attribute float aConnected;
    attribute float aValidTarget;
    attribute float aInvalidHover;
    attribute float aLayer;
    uniform float uMeshLayer;

    varying vec3 vColor;
    varying float vHovered;
    varying float vConnected;
    varying float vValidTarget;
    varying float vInvalidHover;
    varying vec2 vUv;

    void main() {
      // Discard instances that don't belong to this mesh's layer
      if (abs(aLayer - uMeshLayer) > 0.5) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      vColor = aColor;
      vHovered = aHovered;
      vConnected = aConnected;
      vValidTarget = aValidTarget;
      vInvalidHover = aInvalidHover;
      vUv = uv;

      // No hover scale: a dot that grows reads as jitter, a halo reads as light. Hover is drawn
      // in the fragment on the same quad.
      vec3 pos = position;

      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;

    uniform vec3 uInvalidColor;
    uniform vec3 uValidTargetColor;
    uniform vec3 uCanvas;

    varying vec3 vColor;
    varying float vHovered;
    varying float vConnected;
    varying float vValidTarget;
    varying float vInvalidHover;
    varying vec2 vUv;

    void main() {
      // World px from the centre; the quad is SOCKET_GL_RADIUS (10) on a side, uv spans [0, 1].
      float r  = length(vUv - 0.5) * ${(SOCKET_GL_RADIUS * 2).toFixed(1)};
      float aa = fwidth(r);

      // The dot is still SOCKET_RADIUS: the hit radius, the drawn radius. Unconnected sockets are
      // hollow to r 4.5, a 1.5px ring, so the canvas shows through their centre.
      float dot   = 1.0 - smoothstep(${SOCKET_RADIUS.toFixed(1)} - aa, ${SOCKET_RADIUS.toFixed(1)} + aa, r);
      // aConnected carries two bits: 1 = connected, 2 = no punch (a grouped child's socket sits
      // on its parent's body, where a ring of canvas colour would be a visibly wrong hole).
      float connected = mod(vConnected, 2.0);
      float punchOn = 1.0 - step(1.5, vConnected);
      float hole  = (1.0 - smoothstep(4.5 - aa, 4.5 + aa, r)) * (1.0 - connected);
      // A 1.5px punch of canvas colour around the dot, always: an edge running under a socket
      // stops short of it, so the dot reads over any ribbon rather than merging with it.
      float punch = smoothstep(${SOCKET_RADIUS.toFixed(1)} - aa, ${SOCKET_RADIUS.toFixed(1)} + aa, r) * (1.0 - smoothstep(7.5 - aa, 7.5 + aa, r)) * punchOn;
      // The halo outside the punch, quadratic, gone by the quad edge. Only lit by a state.
      float halo  = smoothstep(7.5 - aa, 7.5 + aa, r) * (1.0 - smoothstep(7.5, 10.0, r));
      halo *= halo;
      float haloOn = max(vHovered, max(vValidTarget, vInvalidHover)) * 0.22;

      vec3  dotC  = mix(vColor, uInvalidColor, vInvalidHover);
      vec3  haloC = mix(mix(vColor, uValidTargetColor, vValidTarget), uInvalidColor, vInvalidHover);

      // The three bands never overlap, so their alphas sum and the colour is the alpha-weighted
      // average. Inside the dot that division is by exactly 1.0 and the hue is returned untouched,
      // which the socket-placement law depends on: it flood-fills pixels of the exact frozen hue.
      float dotA = dot - hole;
      float a = dotA + punch + halo * haloOn;
      vec3  c = (dotC * dotA + uCanvas * punch + haloC * halo * haloOn) / max(a, 1e-4);
      if (a < 0.004) discard;
      gl_FragColor = vec4(c, a);
    }
  `;

  // Two materials: same shader, different uMeshLayer uniform for layer filtering
  const bgMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInvalidColor: { value: new THREE.Color(invalidColor[0], invalidColor[1], invalidColor[2]) },
          uValidTargetColor: { value: new THREE.Color(validTargetColor[0], validTargetColor[1], validTargetColor[2]) },
          uCanvas: { value: new THREE.Color(canvasColor[0], canvasColor[1], canvasColor[2]) },
          uMeshLayer: { value: 0.0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    [invalidColor, validTargetColor, canvasColor]
  );
  const fgMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInvalidColor: { value: new THREE.Color(invalidColor[0], invalidColor[1], invalidColor[2]) },
          uValidTargetColor: { value: new THREE.Color(validTargetColor[0], validTargetColor[1], validTargetColor[2]) },
          uCanvas: { value: new THREE.Color(canvasColor[0], canvasColor[1], canvasColor[2]) },
          uMeshLayer: { value: 1.0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    [invalidColor, validTargetColor, canvasColor]
  );

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { bgMaterial.dispose(); fgMaterial.dispose(); }, [bgMaterial, fgMaterial]);

  // Shared buffers for all sockets (layer attribute controls bg/fg visibility)
  const sharedBuffers = useMemo(() => createSocketBuffers(capacity), [capacity]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (capacityRafIdRef.current !== null) {
        cancelAnimationFrame(capacityRafIdRef.current);
        capacityRafIdRef.current = null;
      }
    };
  }, []);

  /**
   * Initialise on ATTACH, for the same reason nodes.tsx does.
   *
   * `args={[geometry, material, capacity]}` makes R3F reconstruct the InstancedMesh whenever the
   * material changes, and the materials are memoised on the theme — so a theme change built fresh
   * meshes that the [sharedBuffers] effect never touched. Here that also destroys the
   * `fgMesh.instanceMatrix = bgMesh.instanceMatrix` aliasing that the two-layer split depends on,
   * so selected sockets stop being drawn and never come back.
   *
   * Both meshes must be present before initialising, because the aliasing needs the pair.
   */
  const attach = useCallback(
    (which: 'bg' | 'fg') => (mesh: THREE.InstancedMesh | null) => {
      const ref = which === 'bg' ? bgMeshRef : fgMeshRef;
      ref.current = mesh;
      if (bgMeshRef.current && fgMeshRef.current) {
        initSharedSocketBuffers(bgMeshRef.current, fgMeshRef.current, sharedBuffers);
        initializedRef.current = true;
        dirtyRef.current = true;
      } else {
        initializedRef.current = false;
      }
    },
    [sharedBuffers]
  );
  const attachBg = useMemo(() => attach('bg'), [attach]);
  const attachFg = useMemo(() => attach('fg'), [attach]);

  // Store subscriptions
  useEffect(() => {
    const unsubEntities = store.subscribe(
      (state) => state.entities,
      () => {
        // Check if this is a position-only change (from updateEntityPositions)
        // vs a structural change (add/remove/dimensions)
        const currentPosVersion = store.getState().positionVersion;
        if (currentPosVersion !== lastPosVersionRef.current) {
          lastPosVersionRef.current = currentPosVersion;
          positionDirtyRef.current = true;
        } else {
          dirtyRef.current = true;
        }
      }
    );
    // Note: viewport changes no longer trigger dirty - GPU handles clipping efficiently
    // This allows zoom/pan without geometry rebuilds.
    //
    // `hiddenEntityIds` is different, and is subscribed: it changes only when a group is collapsed
    // or expanded, so there is no per-frame cost, and without it a collapsed group's children keep
    // their socket dots painted on top of the frame — dots that cannot be pressed, because the
    // store deliberately keeps hidden entities out of the socket index. The paint and the hit test
    // disagreed.
    const unsubHidden = store.subscribe(
      (state) => state.hiddenEntityIds,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubHoveredSocket = store.subscribe(
      (state) => state.hoveredSocketId,
      (hovered, previous) => {
        // Only two entities can be affected by a hover moving: the one it left and the one it
        // entered. Record both, and let the frame rewrite just those two runs of instances.
        hoverDirtyRef.current = true;
        if (previous) hoverTouchedRef.current.add(previous.entityId);
        if (hovered) hoverTouchedRef.current.add(hovered.entityId);
      }
    );
    const unsubConnectionDraft = store.subscribe(
      // The SOURCE, not the whole draft. `connectionDraft` carries `mouseWorld`, so subscribing to
      // the object fires on every pointermove of a connection gesture and rebuilds every socket in
      // the graph — sixty rebuilds where two are needed. This renderer never reads `mouseWorld`
      // (nor `isValid`); it computes its own validity from the source and the hovered socket. The
      // source object is copied by reference through the store's spread, so its identity is stable
      // for the life of a gesture and this fires exactly twice: once at open, once at close.
      (state) => state.connectionDraft?.source ?? null,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      (edges) => {
        // Rebuild the connected-socket index when edges change (not every frame)
        connectedInputsRef.current.clear();
        connectedOutputsRef.current.clear();
        indexConnectedSockets(edges, connectedInputsRef.current, connectedOutputsRef.current);
        dirtyRef.current = true;
      }
    );
    /**
     * Selection is a full rebuild, and there is no cheaper path available.
     *
     * There used to be one beside this: a block that flipped only `aLayer` for the entities whose
     * selection changed. It was dead code — this subscriber set `dirtyRef` too, and the block's
     * guard required `dirtyRef` to be clear — and it could not be revived as written, because
     * selection also changes an entity's depth (see utils/entity-depth.ts, which applies a boost
     * to selected entities). Depth lives in the instance matrix, and `aLayer` cannot write it, so
     * a layer-only path would leave a selected node's sockets sorted under the nodes they should
     * now sit above. That is the interleaving defect entity-depth.ts exists to fix.
     */
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => {
        dirtyRef.current = true;
      }
    );

    // Initialize connected sockets from current edges
    indexConnectedSockets(
      store.getState().edges,
      connectedInputsRef.current,
      connectedOutputsRef.current
    );

    // A press moved something to the front: every socket's depth may have changed.
    const unsubStack = store.subscribe(
      (state) => state.stackVersion,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubStack();
      unsubEntities();
      unsubHoveredSocket();
      unsubHidden();
      unsubConnectionDraft();
      unsubEdges();
      unsubSelection();
    };
  }, [store]);

  // Helper: write all sockets for one entity into the shared buffers
  const writeEntitySockets = (
    entity: Entity,
    bufs: SocketBuffers,
    matrixArray: Float32Array,
    startIdx: number,
    hoveredSocketId: { entityId: string; socketId: string; isInput: boolean } | null,
    connectionDraft: { source: { entityId: string; socketId: string; isInput: boolean } } | null,
    sourceSocketType: string | null,
    connectedInputs: Map<string, Set<string>>,
    connectedOutputs: Map<string, Set<string>>,
  ): number => {
    let idx = startIdx;
    // One lookup per entity, then a socket-id membership test per socket — the old shape built a
    // composite key string per socket instead.
    const entityConnectedInputs = connectedInputs.get(entity.id);
    const entityConnectedOutputs = connectedOutputs.get(entity.id);
    // A grouped child's sockets sit on its parent's body: no punch ring there (see the shader).
    const punchOff = entity.parentId ? 2.0 : 0.0;
    // Hoisted out of the socket loops and handed to getSocketYOffset: without it, moving these
    // four sites onto the shared arithmetic would turn one layout-cache lookup per ENTITY into
    // one per SOCKET, in the hottest loop the renderer has.
    const entityLayout = getEntitySocketLayout(entity, socketLayout);
    // A socket sits in its entity's depth slice, above the body — see utils/entity-depth.ts.
    const { stackOrder, selectedEntityIds } = store.getState();
    const z = entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.socket);

    // Render input sockets
    if (entity.inputs) {
      for (let i = 0; i < entity.inputs.length; i++) {
        if (idx >= capacity) break;

        const socket = entity.inputs[i];
        const yOffset = getSocketYOffset(entity, i, true, socketLayout, entityLayout);

        tempMatrix.identity();
        tempMatrix.setPosition(
          getSocketWorldX(entity, true),
          -(entity.position.y + yOffset),
          z
        );
        tempMatrix.toArray(matrixArray, idx * 16);

        const rgb = typeRGB.get(socket.type) ?? defaultRGB;
        bufs.colors[idx * 3] = rgb[0];
        bufs.colors[idx * 3 + 1] = rgb[1];
        bufs.colors[idx * 3 + 2] = rgb[2];

        const isHovered =
          hoveredSocketId?.entityId === entity.id &&
          hoveredSocketId?.socketId === socket.id &&
          hoveredSocketId?.isInput === true;
        bufs.hovered[idx] = isHovered ? 1.0 : 0.0;

        bufs.connected[idx] =
          (entityConnectedInputs !== undefined && entityConnectedInputs.has(socket.id) ? 1.0 : 0.0) + punchOff;

        let isValidTarget = 0.0;
        if (connectionDraft && !connectionDraft.source.isInput && sourceSocketType) {
          const isStructurallyValid = connectionDraft.source.entityId !== entity.id;
          const isTypeCompatible = areTypesCompatible(
            sourceSocketType,
            socket.type,
            socketTypes
          );
          isValidTarget = isStructurallyValid && isTypeCompatible ? 1.0 : 0.0;
        }
        bufs.validTarget[idx] = isValidTarget;

        const isInvalidHover =
          isHovered && connectionDraft && isValidTarget === 0.0 ? 1.0 : 0.0;
        bufs.invalidHover[idx] = isInvalidHover;

        idx++;
      }
    }

    // Render output sockets
    if (entity.outputs) {
      for (let i = 0; i < entity.outputs.length; i++) {
        if (idx >= capacity) break;

        const socket = entity.outputs[i];
        const yOffset = getSocketYOffset(entity, i, false, socketLayout, entityLayout);

        tempMatrix.identity();
        tempMatrix.setPosition(
          getSocketWorldX(entity, false),
          -(entity.position.y + yOffset),
          z
        );
        tempMatrix.toArray(matrixArray, idx * 16);

        const rgb = typeRGB.get(socket.type) ?? defaultRGB;
        bufs.colors[idx * 3] = rgb[0];
        bufs.colors[idx * 3 + 1] = rgb[1];
        bufs.colors[idx * 3 + 2] = rgb[2];

        const isHovered =
          hoveredSocketId?.entityId === entity.id &&
          hoveredSocketId?.socketId === socket.id &&
          hoveredSocketId?.isInput === false;
        bufs.hovered[idx] = isHovered ? 1.0 : 0.0;

        bufs.connected[idx] =
          (entityConnectedOutputs !== undefined && entityConnectedOutputs.has(socket.id) ? 1.0 : 0.0) + punchOff;

        let isValidTarget = 0.0;
        if (connectionDraft && connectionDraft.source.isInput && sourceSocketType) {
          const isStructurallyValid = connectionDraft.source.entityId !== entity.id;
          const isTypeCompatible = areTypesCompatible(
            sourceSocketType,
            socket.type,
            socketTypes
          );
          isValidTarget = isStructurallyValid && isTypeCompatible ? 1.0 : 0.0;
        }
        bufs.validTarget[idx] = isValidTarget;

        const isInvalidHover =
          isHovered && connectionDraft && isValidTarget === 0.0 ? 1.0 : 0.0;
        bufs.invalidHover[idx] = isInvalidHover;

        idx++;
      }
    }

    return idx;
  };

  /**
   * The type of the socket a connection draft started from, cached for the life of the draft.
   *
   * Lifted out of the full rebuild so the hover fast path can reach it too: hover feeds
   * `invalidHover`, which is only meaningful relative to the draft's source type, and a fast path
   * that could not answer this question would have had to fall back to a full rebuild on exactly
   * the gesture where hover changes most often.
   */
  const resolveSourceSocketType = (
    connectionDraft: { source: { entityId: string; socketId: string; isInput: boolean } } | null,
    entityMap: Map<string, Entity>
  ): string | null => {
    if (!connectionDraft) {
      sourceSocketCacheRef.current = null;
      return null;
    }
    const cacheKey = `${connectionDraft.source.entityId}:${connectionDraft.source.socketId}:${connectionDraft.source.isInput ? 'input' : 'output'}`;
    if (sourceSocketCacheRef.current?.key === cacheKey) {
      return sourceSocketCacheRef.current.type;
    }
    const sourceEntity = entityMap.get(connectionDraft.source.entityId);
    if (!sourceEntity) return null;
    const sourceSockets = connectionDraft.source.isInput
      ? sourceEntity.inputs
      : sourceEntity.outputs;
    const sourceSocket = sourceSockets?.find((s) => s.id === connectionDraft.source.socketId);
    const sourceSocketType = sourceSocket?.type ?? null;
    if (sourceSocketType) {
      sourceSocketCacheRef.current = { key: cacheKey, type: sourceSocketType };
    }
    return sourceSocketType;
  };

  /**
   * Rewrite just the entities a hover moved between.
   *
   * Returns false when it cannot safely do so, and the caller then falls back to a full rebuild.
   * The two refusals both come from the same invariant: a run of instances belongs to one entity
   * only when its length matches that entity's socket count. A hidden entity holds an explicit
   * zero-count range, and the last entity's run is truncated when the buffer is at capacity;
   * writing `inputs.length + outputs.length` instances from `range.start` in either case lands on
   * the NEXT entity's instances. That is the same defect the position fast path guards against.
   *
   * The whole entity is rebuilt rather than only its `hovered` floats, because hover also drives
   * `invalidHover` — the red ring on an incompatible drop target — and reusing `writeEntitySockets`
   * keeps the two derivations from drifting apart. It is ten sockets of work, not five thousand.
   */
  const writeHoverFastPath = (bgMesh: THREE.InstancedMesh): boolean => {
    const socketRanges = entitySocketRangesRef.current;
    const { entityMap, hoveredSocketId, connectionDraft } = store.getState();
    const sourceSocketType = resolveSourceSocketType(connectionDraft, entityMap);
    const matrixArray = bgMesh.instanceMatrix.array as Float32Array;

    for (const entityId of hoverTouchedRef.current) {
      const range = socketRanges.get(entityId);
      const entity = entityMap.get(entityId);
      if (!range || !entity) return false;

      const socketCount = (entity.inputs?.length ?? 0) + (entity.outputs?.length ?? 0);
      if (range.count !== socketCount) return false;

      writeEntitySockets(
        entity, sharedBuffers, matrixArray, range.start,
        hoveredSocketId, connectionDraft, sourceSocketType,
        connectedInputsRef.current, connectedOutputsRef.current,
      );
      markSocketRangeForUpload(sharedBuffers, range.start, range.count);
      // `writeEntitySockets` rewrites the matrices too. Their values are unchanged here — depth
      // and position both dirty the full path — but uploading the same span keeps the matrix
      // buffer and the attribute buffers from ever describing different frames.
      bgMesh.instanceMatrix.addUpdateRange(range.start * 16, range.count * 16);
      bgMesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  };

  // RAF-synchronized updates
  useFrame(({ size }) => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;
    if (!bgMesh || !fgMesh || !initializedRef.current) return;

    // Mark dirty on canvas resize (prevents ghosting)
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
      dirtyRef.current = true;
    }

    // Hover fast path. Deliberately does not return: a frame can carry both a hover change and a
    // position change, and the position path below still has to run.
    if (!dirtyRef.current && hoverDirtyRef.current) {
      if (!writeHoverFastPath(bgMesh)) {
        dirtyRef.current = true;
      }
      hoverDirtyRef.current = false;
      hoverTouchedRef.current.clear();
    }

    // Position-only fast path: only update instance matrices for moved entities
    if (!dirtyRef.current && positionDirtyRef.current) {
      const movedIds = store.getState().getMovedEntityIds();
      const socketRanges = entitySocketRangesRef.current;

      if (movedIds.size > 0 && socketRanges.size > 0) {
        const { entityMap, stackOrder, selectedEntityIds } = store.getState();
        tempMatrix.identity();

        // The span of instances this frame actually rewrote. Without it, `needsUpdate` alone made
        // three re-send the whole instance matrix — sized to CAPACITY, so over half a megabyte at
        // a thousand nodes — every drag frame, to deliver the few hundred bytes one moved node
        // changed. Min/max rather than a range per entity, because a range is an object and this
        // loop runs on every pointermove.
        let dirtyMin = Number.POSITIVE_INFINITY;
        let dirtyMax = -1;

        for (const entityId of movedIds) {
          const range = socketRanges.get(entityId);
          if (!range) continue;
          // A hidden entity holds a zero-count range. Writing its matrices anyway would put them
          // at `range.start`, which is where the NEXT visible entity's instances live — dragging a
          // node inside a collapsed group would move a different node's sockets.
          if (range.count === 0) continue;

          const entity = entityMap.get(entityId);
          if (!entity) continue;

          if (range.start < dirtyMin) dirtyMin = range.start;
          if (range.start + range.count > dirtyMax) dirtyMax = range.start + range.count;

          // Both meshes share bgMesh's instanceMatrix
          const mesh = bgMesh;
          const entityLayout = getEntitySocketLayout(entity, socketLayout);
          const z = entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.socket);

          let instanceIdx = range.start;

          if (entity.inputs) {
            for (let i = 0; i < entity.inputs.length; i++) {
              const yOffset = getSocketYOffset(entity, i, true, socketLayout, entityLayout);
              tempMatrix.setPosition(
                getSocketWorldX(entity, true),
                -(entity.position.y + yOffset),
                z
              );
              mesh.setMatrixAt(instanceIdx, tempMatrix);
              instanceIdx++;
            }
          }

          if (entity.outputs) {
            for (let i = 0; i < entity.outputs.length; i++) {
              const yOffset = getSocketYOffset(entity, i, false, socketLayout, entityLayout);
              tempMatrix.setPosition(
                getSocketWorldX(entity, false),
                -(entity.position.y + yOffset),
                z
              );
              mesh.setMatrixAt(instanceIdx, tempMatrix);
              instanceIdx++;
            }
          }
        }

        if (dirtyMax > dirtyMin) {
          bgMesh.instanceMatrix.addUpdateRange(dirtyMin * 16, (dirtyMax - dirtyMin) * 16);
          bgMesh.instanceMatrix.needsUpdate = true;
        }
      }

      positionDirtyRef.current = false;
      return;
    }

    if (!dirtyRef.current) return;

    const { entities, entityMap, hoveredSocketId, connectionDraft, selectedEntityIds, hiddenEntityIds } =
      store.getState();

    // Get source socket type with caching (O(1) after first lookup per connection draft)
    const sourceSocketType = resolveSourceSocketType(connectionDraft, entityMap);

    let totalCount = 0;
    const socketRanges = entitySocketRangesRef.current;
    socketRanges.clear();
    const matrixArray = bgMesh.instanceMatrix.array as Float32Array;

    for (const entity of entities) {
      const isSelected = selectedEntityIds.has(entity.id);
      const entitySocketStart = totalCount;

      // A hidden entity records an EXPLICIT ZERO-COUNT range rather than being skipped outright.
      // The position fast path indexes by these ranges and writes `inputs.length + outputs.length`
      // matrices from `range.start`; without a range that says zero, a hidden entity being dragged
      // would overwrite its neighbour's instances.
      if (hiddenEntityIds.has(entity.id)) {
        socketRanges.set(entity.id, { start: entitySocketStart, count: 0 });
        continue;
      }

      totalCount = writeEntitySockets(
        entity, sharedBuffers, matrixArray, totalCount,
        hoveredSocketId, connectionDraft, sourceSocketType,
        connectedInputsRef.current, connectedOutputsRef.current,
      );

      const socketsWritten = totalCount - entitySocketStart;
      socketRanges.set(entity.id, {
        start: entitySocketStart,
        count: socketsWritten,
      });

      // Set layer for this entity's socket instances
      const layer = isSelected ? 1 : 0;
      for (let j = entitySocketStart; j < totalCount; j++) {
        sharedBuffers.layers[j] = layer;
      }
    }

    // Check capacity - defer state update to avoid React re-render inside useFrame
    if (totalCount >= capacity) {
      const newCapacity = Math.ceil(totalCount * BUFFER_GROWTH_FACTOR);
      if (pendingCapacityRef.current === null || newCapacity > pendingCapacityRef.current) {
        pendingCapacityRef.current = newCapacity;
        if (capacityRafIdRef.current === null) {
          capacityRafIdRef.current = requestAnimationFrame(() => {
            capacityRafIdRef.current = null;
            if (pendingCapacityRef.current !== null) {
              setCapacity(pendingCapacityRef.current);
              pendingCapacityRef.current = null;
            }
          });
        }
      }
    }

    // Update GPU buffers (shared between both meshes). Ranges left over from a fast path that
    // bailed into this rebuild have to go, or three would upload that sliver instead of the whole
    // buffer this path just rewrote.
    bgMesh.instanceMatrix.clearUpdateRanges();
    bgMesh.instanceMatrix.needsUpdate = true;
    markSocketBuffersForUpload(sharedBuffers);

    // Both meshes draw all instances; shader filters by layer
    const clampedCount = Math.min(totalCount, capacity);
    bgMesh.count = clampedCount;
    fgMesh.count = clampedCount;
    dirtyRef.current = false;
    positionDirtyRef.current = false;
    hoverDirtyRef.current = false;
    hoverTouchedRef.current.clear();
  });

  return (
    <>
      <instancedMesh
        key={`bg-${capacity}`}
        ref={attachBg}
        // Named so a law can identify this mesh rather than infer it from geometry type and render
        // order, the same reason widgets-gl.tsx names its two. Without a name it reports as
        // `CircleGeometry:r2`, which is a description of a shape and not an identity.
        name="sockets"
        args={[bgGeometry, bgMaterial, capacity]}
        renderOrder={RENDER_ORDER_BG}
        frustumCulled={false}
      />
      <instancedMesh
        key={`fg-${capacity}`}
        ref={attachFg}
        name="sockets-selected"
        args={[fgGeometry, fgMaterial, capacity]}
        renderOrder={RENDER_ORDER_FG}
        frustumCulled={false}
      />
    </>
  );
}
