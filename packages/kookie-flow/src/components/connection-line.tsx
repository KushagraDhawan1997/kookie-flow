import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_SOCKET_TYPES } from '../core/constants';
import { getSocketWorldX, getSocketYOffset } from '../utils/geometry';
import { THEME_COLORS } from '../core/theme-colors';
import { SDF_GLSL } from '../gl';
import { SOCKET_RADIUS } from '../core/constants';
import { EDGE_LEADER, EDGE_SOCKET_RIM, bezierControlOffset } from '../utils/edge-curve';
import type { SocketType } from '../types';
import { rgbToHex } from '../utils/color';

// Tessellation settings
const SEGMENTS = 32;
const VERTICES_PER_SEGMENT = 6;
/**
 * The curve's segments PLUS the leader's. The wire leaves the socket along the socket's own axis
 * for a short straight run before the curve takes over, which is one more quad than the samples.
 * Sizing this at SEGMENTS alone drops the last segment off the end of the buffer.
 */
const TOTAL_VERTICES = (SEGMENTS + 1) * VERTICES_PER_SEGMENT;

/**
 * Same construction as an edge, in screen px: a 2px core over a glow that dies over the 3px
 * beyond it. The two numbers are copied from edges.tsx rather than imported — the line owns its
 * own look, and an edge tweak should not move it by accident.
 */
const CONNECTION_HALF_WIDTH = 4;
/** How fast the dashes travel toward the pointer, in cycles per second. */
const DASH_SPEED = 1.5;

interface ConnectionLineProps {
  socketTypes?: Record<string, SocketType>;
}

// Vertex shader
const vertexShader = /* glsl */ `
  attribute vec2 uv2;

  varying vec2 vUv;

  void main() {
    vUv = uv2;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader — core + glow like an edge, dashes soft-ended and travelling toward the pointer
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLength;
  uniform float uTime;
  uniform float uHalfWidth;

  varying vec2 vUv;

  void main() {
    // Screen px from the centreline; the ribbon is uHalfWidth px each side.
    float px   = abs(vUv.y) * uHalfWidth;
    float core = 1.0 - smoothstep(0.25, 1.75, px);
    float glow = 1.0 - smoothstep(1.0, uHalfWidth, px);
    glow *= glow;

    // 16px cycle in world units along the curve, phase moving with the clock so the dashes run
    // from the socket to the pointer — the direction the connection is being made in.
    float ph   = fract(vUv.x * uLength / 16.0 - uTime * ${DASH_SPEED.toFixed(2)});
    float dash = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.4, 0.5, ph));

    float a = max(core * 0.9 * dash, glow * 0.16);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * THE BRIDGE: the socket and the wire's tip as ONE surface.
 *
 * Both are discs, so they are blended with a smooth minimum rather than drawn over each other.
 * Inside the magnet's reach the two bulge toward one another and fuse — mercury, not a snap — and
 * the join is a real surface at every distance because it is one distance field and not two
 * shapes overlapping. `uBlend` is how much of that merging is allowed: it grows with the pull, so
 * far away the tip is its own round head and close up there is a single pool of metal.
 */
const bridgeFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uCenter;
  uniform vec2 uSize;
  uniform vec2 uSocket;
  uniform vec2 uTip;
  uniform float uSocketR;
  uniform float uTipR;
  uniform float uBlend;
  uniform vec3 uColor;
  uniform vec3 uSocketColor;

  varying vec2 vUv;

  ${SDF_GLSL}

  // The polynomial smooth minimum: k wide, and exactly min() at k = 0.
  float smin(float a, float b, float k) {
    if (k <= 0.0001) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  void main() {
    // World px. The mesh is placed at uCenter and scaled to uSize, and world y runs DOWN while the
    // mesh's y runs up — the same flip every layer here makes.
    vec2 p = vec2(uCenter.x + (vUv.x - 0.5) * uSize.x, uCenter.y - (vUv.y - 0.5) * uSize.y);

    float dSocket = sdCircle(p - uSocket, uSocketR);
    float dTip = sdCircle(p - uTip, uTipR);
    float d = smin(dSocket, dTip, uBlend);
    float aa = fwidth(d) * 0.75 + 1e-5;
    /**
     * NOT OVER THE SOCKET. The socket draws itself — a ring that thickens, a hole that closes, a
     * dot that swells — and a disc painted at its centre would hide every bit of that, which is
     * what the first cut did: the socket read as solid from the moment a wire came into reach.
     * The bridge is only the metal BETWEEN the two, so the socket's own disc is cut out of it.
     */
    float fill = fillSDF(d, aa) * (1.0 - fillSDF(dSocket + 0.5, aa));
    if (fill < 0.004) discard;
    // The wire's own colour at the tip, the socket's at the socket: the bridge is the wire becoming
    // the socket, so the hue crosses where the two fields do.
    float toward = clamp(0.5 + 0.5 * (dTip - dSocket) / max(uBlend, 1.0), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uSocketColor, toward), fill);
  }
`;

const bridgeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Renders a temporary bezier curve while dragging to create a connection.
 * Hidden when no connection draft is active.
 */
export function ConnectionLine({
  socketTypes = DEFAULT_SOCKET_TYPES,
}: ConnectionLineProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const meshRef = useRef<THREE.Mesh>(null);
  const bridgeRef = useRef<THREE.Mesh>(null);
  const initializedRef = useRef(false);

  // Derive colors from semantic theme config
  const defaultLineColor = rgbToHex(tokens[THEME_COLORS.connectionLine.default]);
  const invalidColor = rgbToHex(tokens[THEME_COLORS.connectionLine.invalid]);
  const fallbackSocketColor = rgbToHex(tokens[THEME_COLORS.socket.fallback]);

  // Pre-allocated buffers
  const buffersRef = useRef<{
    positions: Float32Array;
    uvs: Float32Array;
    positionAttr: THREE.BufferAttribute | null;
    uvAttr: THREE.BufferAttribute | null;
  }>({
    positions: new Float32Array(TOTAL_VERTICES * 3),
    uvs: new Float32Array(TOTAL_VERTICES * 2),
    positionAttr: null,
    uvAttr: null,
  });

  // Pre-allocated curve points (avoid GC during drag)
  const pointsRef = useRef<Float32Array>(new Float32Array((SEGMENTS + 2) * 2));

  // Cache socket lookup for O(1) access in hot path
  // Key: "entityId:socketId:input|output" -> { index, socket }
  const socketCacheRef = useRef<{
    key: string;
    index: number;
    socket: { id: string; type: string; position?: number };
  } | null>(null);

  const bridgeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const bridgeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: bridgeVertexShader,
        fragmentShader: bridgeFragmentShader,
        uniforms: {
          uCenter: { value: new THREE.Vector2() },
          uSize: { value: new THREE.Vector2(1, 1) },
          uSocket: { value: new THREE.Vector2() },
          uTip: { value: new THREE.Vector2() },
          uSocketR: { value: SOCKET_RADIUS },
          uTipR: { value: 2 },
          uBlend: { value: 0 },
          uColor: { value: new THREE.Color(defaultLineColor) },
          uSocketColor: { value: new THREE.Color(defaultLineColor) },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [defaultLineColor]
  );
  useEffect(() => () => { bridgeGeometry.dispose(); bridgeMaterial.dispose(); }, [bridgeGeometry, bridgeMaterial]);

  // Shader material
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(defaultLineColor) },
          uLength: { value: 100 },
          uTime: { value: 0 },
          uHalfWidth: { value: CONNECTION_HALF_WIDTH },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    [defaultLineColor]
  );

  // Initialize attributes after mesh is mounted
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const buffers = buffersRef.current;

    // Create and attach attributes
    buffers.positionAttr = new THREE.BufferAttribute(buffers.positions, 3);
    buffers.positionAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.uvAttr = new THREE.BufferAttribute(buffers.uvs, 2);
    buffers.uvAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('position', buffers.positionAttr);
    mesh.geometry.setAttribute('uv2', buffers.uvAttr);

    // Start with 0 draw range (invisible until we have data)
    mesh.geometry.setDrawRange(0, 0);

    initializedRef.current = true;

    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    const bridge = bridgeRef.current;
    if (!mesh || !initializedRef.current) return;

    const { connectionDraft, entityMap, viewport, magnet } = store.getState();

    if (!connectionDraft) {
      mesh.visible = false;
      mesh.geometry.setDrawRange(0, 0);
      if (bridge) bridge.visible = false;
      socketCacheRef.current = null; // Clear cache when draft ends
      return;
    }

    // The tip's spring, one frame. The pointer path aims the magnet; this is the pull acting on
    // the wire, so a wire near a socket is held back while the cursor moves on.
    magnet.advance(delta);

    const sourceEntity = entityMap.get(connectionDraft.source.entityId);
    if (!sourceEntity) {
      mesh.visible = false;
      return;
    }

    const sourceSockets = connectionDraft.source.isInput
      ? sourceEntity.inputs
      : sourceEntity.outputs;

    if (!sourceSockets) {
      mesh.visible = false;
      return;
    }

    // O(1) socket lookup via cache (only compute once per connection draft)
    const cacheKey = `${connectionDraft.source.entityId}:${connectionDraft.source.socketId}:${connectionDraft.source.isInput ? 'input' : 'output'}`;
    let socketIndex: number;
    let socket: { id: string; type: string; position?: number };

    if (socketCacheRef.current?.key === cacheKey) {
      // Cache hit - O(1)
      socketIndex = socketCacheRef.current.index;
      socket = socketCacheRef.current.socket;
    } else {
      // Cache miss - O(n) but only once per connection draft
      socketIndex = sourceSockets.findIndex(
        (s) => s.id === connectionDraft.source.socketId
      );
      if (socketIndex === -1) {
        mesh.visible = false;
        return;
      }
      socket = sourceSockets[socketIndex];
      socketCacheRef.current = { key: cacheKey, index: socketIndex, socket };
    }
    // Socket geometry comes from utils/geometry — the same arithmetic the socket index, the edge
    // endpoints and getSocketPosition use. The copy that stood here derived the row height
    // uniformly, so the line a user drags started somewhere the socket they pressed is not.
    /**
     * THE RIM, NOT THE CENTRE. `getSocketWorldX` answers with the socket's CENTRE, and a wire
     * drawn from there starts underneath the dot: on a hollow socket you see it inside the ring's
     * hole, crossing the middle, which reads as a line pinned through the socket rather than one
     * plugged into it. A resting edge was moved to the rim (see edges.tsx); this is the same join
     * for the wire being dragged, which is the one a user actually watches.
     *
     * An output leaves to the right, an input to the left — the socket's own axis.
     */
    const sourceAxis = connectionDraft.source.isInput ? -1 : 1;
    const sourceCentreX = getSocketWorldX(sourceEntity, connectionDraft.source.isInput);
    const sourceX = sourceCentreX + sourceAxis * EDGE_SOCKET_RIM;
    const sourceY =
      sourceEntity.position.y +
      getSocketYOffset(sourceEntity, socketIndex, connectionDraft.source.isInput, socketLayout);

    /**
     * The wire ends at the TIP, not under the pointer. The tip lags the cursor by however hard a
     * socket is pulling (gl/magnet.ts), so the grab is felt in the drag rather than shown as a
     * highlight. With no socket in reach the two are the same point.
     */
    const targetX = magnet.active ? magnet.tipX : connectionDraft.mouseWorld.x;
    const targetY = magnet.active ? magnet.tipY : connectionDraft.mouseWorld.y;

    // Control points direction depends on whether dragging from input or output. They are taken
    // from the LEADER's end, or the first sampled segment collapses into the straight run and the
    // curve kinks at the joint instead of continuing out of it.
    const leadX = sourceX + sourceAxis * EDGE_LEADER;
    // The resting edge's own reach (utils/edge-curve.ts), so a wire keeps its shape when dropped.
    const offset = bezierControlOffset(targetX - leadX, targetY - sourceY);
    const cx1 = leadX + sourceAxis * offset;
    const cy1 = sourceY;
    const cx2 = connectionDraft.source.isInput ? targetX + offset : targetX - offset;
    const cy2 = targetY;

    // Half-width for ribbon in world units (screen-constant, so divided by zoom)
    const halfWidth = CONNECTION_HALF_WIDTH / viewport.zoom;

    // Generate curve points into pre-allocated buffer
    const points = pointsRef.current;
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;

      // Shifted by one: points[0] is the rim, and the curve runs from the leader's end onward.
      const idx = (s + 1) * 2;
      points[idx] = mt3 * leadX + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * targetX;
      points[idx + 1] = mt3 * sourceY + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * targetY;
    }
    points[0] = sourceX;
    points[1] = sourceY;

    // Generate ribbon geometry and calculate length in single pass
    const buffers = buffersRef.current;
    let vertexIndex = 0;
    let curveLength = 0;

    for (let p = 0; p < SEGMENTS + 1; p++) {
      const idx0 = p * 2;
      const idx1 = (p + 1) * 2;
      const p0x = points[idx0];
      const p0y = points[idx0 + 1];
      const p1x = points[idx1];
      const p1y = points[idx1 + 1];

      // Direction and normal
      const dirX = p1x - p0x;
      const dirY = p1y - p0y;
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      curveLength += len;
      if (len < 0.0001) continue;

      const normX = (-dirY / len) * halfWidth;
      const normY = (dirX / len) * halfWidth;

      // UV along the edge (for dashing)
      const u0 = p / (SEGMENTS + 1);
      const u1 = (p + 1) / (SEGMENTS + 1);

      // Z position - above edges (edges are at z=1)
      const z = 2;

      // Build quad (2 triangles, 6 vertices)
      // Triangle 1
      let idx = vertexIndex * 3;
      let uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p0x + normX;
      buffers.positions[idx + 1] = -(p0y + normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u0;
      buffers.uvs[uvIdx + 1] = 1;
      vertexIndex++;

      idx = vertexIndex * 3;
      uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p0x - normX;
      buffers.positions[idx + 1] = -(p0y - normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u0;
      buffers.uvs[uvIdx + 1] = -1;
      vertexIndex++;

      idx = vertexIndex * 3;
      uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p1x + normX;
      buffers.positions[idx + 1] = -(p1y + normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u1;
      buffers.uvs[uvIdx + 1] = 1;
      vertexIndex++;

      // Triangle 2
      idx = vertexIndex * 3;
      uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p1x + normX;
      buffers.positions[idx + 1] = -(p1y + normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u1;
      buffers.uvs[uvIdx + 1] = 1;
      vertexIndex++;

      idx = vertexIndex * 3;
      uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p0x - normX;
      buffers.positions[idx + 1] = -(p0y - normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u0;
      buffers.uvs[uvIdx + 1] = -1;
      vertexIndex++;

      idx = vertexIndex * 3;
      uvIdx = vertexIndex * 2;
      buffers.positions[idx] = p1x - normX;
      buffers.positions[idx + 1] = -(p1y - normY);
      buffers.positions[idx + 2] = z;
      buffers.uvs[uvIdx] = u1;
      buffers.uvs[uvIdx + 1] = -1;
      vertexIndex++;
    }

    // Update length uniform for consistent dash sizing. The clock only moves while a draft
    // exists — this branch already rebuilds the mesh every drag frame, so one more float is free.
    material.uniforms.uLength.value = curveLength;
    material.uniforms.uTime.value = clock.elapsedTime;

    // Update GPU buffers
    if (buffers.positionAttr && buffers.uvAttr) {
      buffers.positionAttr.needsUpdate = true;
      buffers.uvAttr.needsUpdate = true;
    }

    mesh.geometry.setDrawRange(0, vertexIndex);
    mesh.visible = true;

    /**
     * The bridge, when a socket is holding the wire. Its quad only has to cover the two discs and
     * the metal between them, so it is placed and scaled per frame rather than spanning the canvas.
     */
    if (bridge) {
      const pull = magnet.active ? magnet.strength : 0;
      if (pull > 0.001) {
        const socketR = SOCKET_RADIUS + 1.2 * Math.max(0, Math.min(1, magnet.stage - 1));
        // The wire is screen-constant, so its tip is a world radius that shrinks as you zoom in.
        const tipR = Math.max(1, 2.5 / viewport.zoom);
        // How much merging is allowed: nothing at the edge of reach, a full pool at the socket.
        const blend = (socketR + tipR) * pull;
        const minX = Math.min(magnet.socketX - socketR, magnet.tipX - tipR) - blend - 2;
        const maxX = Math.max(magnet.socketX + socketR, magnet.tipX + tipR) + blend + 2;
        const minY = Math.min(magnet.socketY - socketR, magnet.tipY - tipR) - blend - 2;
        const maxY = Math.max(magnet.socketY + socketR, magnet.tipY + tipR) + blend + 2;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const u = bridgeMaterial.uniforms;
        (u.uCenter.value as THREE.Vector2).set(cx, cy);
        (u.uSize.value as THREE.Vector2).set(maxX - minX, maxY - minY);
        (u.uSocket.value as THREE.Vector2).set(magnet.socketX, magnet.socketY);
        (u.uTip.value as THREE.Vector2).set(magnet.tipX, magnet.tipY);
        u.uSocketR.value = socketR;
        u.uTipR.value = tipR;
        u.uBlend.value = blend;
        bridge.position.set(cx, -cy, 3);
        bridge.scale.set(maxX - minX, maxY - minY, 1);
        bridge.visible = true;
      } else {
        bridge.visible = false;
      }
    }

    // Update color based on validity and source socket type
    if (!connectionDraft.isValid) {
      // Invalid connection: show red
      (material.uniforms.uColor.value as THREE.Color).set(invalidColor);
    } else {
      // Valid connection: use source socket type color
      // Fallback chain: socket type → 'any' type → theme gray
      const typeConfig = socketTypes[socket.type] ?? socketTypes.any ?? { color: fallbackSocketColor, name: 'Any' };
      (material.uniforms.uColor.value as THREE.Color).set(typeConfig.color);
    }
    // The bridge takes the wire's colour at its tip and the socket's at its socket. A refused
    // socket never pulls, so the bridge is never drawn for one.
    (bridgeMaterial.uniforms.uColor.value as THREE.Color).copy(material.uniforms.uColor.value as THREE.Color);
    (bridgeMaterial.uniforms.uSocketColor.value as THREE.Color).copy(
      material.uniforms.uColor.value as THREE.Color
    );
  });

  return (
    <>
      {/* Named so a law can ask this mesh where the dragged wire begins, rather than inferring it
          from pixels: drawnVertices() labels an unnamed mesh by its geometry type, which every
          ribbon in the scene shares. */}
      <mesh ref={meshRef} name="connection-line" material={material} frustumCulled={false}>
        <bufferGeometry />
      </mesh>
      <mesh
        ref={bridgeRef}
        name="connection-bridge"
        geometry={bridgeGeometry}
        material={bridgeMaterial}
        frustumCulled={false}
        visible={false}
      />
    </>
  );
}
