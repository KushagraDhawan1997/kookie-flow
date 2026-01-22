import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import {
  DEFAULT_SOCKET_TYPES,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
} from '../core/constants';
import type { SocketType } from '../types';
import type { RGBColor } from '../utils/color';

/** Convert RGB array [0-1] to hex string */
function rgbToHex(rgb: RGBColor): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Tessellation settings
const SEGMENTS = 32;
const VERTICES_PER_SEGMENT = 6;
const TOTAL_VERTICES = SEGMENTS * VERTICES_PER_SEGMENT;

const LINE_WIDTH = 3;

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

// Fragment shader with dashed line effect
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAASmooth;
  uniform float uLength;

  varying vec2 vUv;

  void main() {
    float dist = abs(vUv.y);
    float alpha = 1.0 - smoothstep(1.0 - uAASmooth, 1.0, dist);

    // Dashed pattern - fixed 8px dash, 8px gap (16px cycle)
    float dashCycle = 16.0;
    float dashCount = uLength / dashCycle;
    float dash = step(0.5, fract(vUv.x * dashCount));
    alpha *= dash;

    gl_FragColor = vec4(uColor, alpha * 0.9);
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
  const meshRef = useRef<THREE.Mesh>(null);
  const initializedRef = useRef(false);

  // Derive colors from theme tokens
  const defaultLineColor = rgbToHex(tokens['--gray-8']);
  const invalidColor = rgbToHex(tokens['--red-9']);
  const fallbackSocketColor = rgbToHex(tokens['--gray-8']);

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
  const pointsRef = useRef<Float32Array>(new Float32Array((SEGMENTS + 1) * 2));

  // Cache socket lookup for O(1) access in hot path
  // Key: "nodeId:socketId:input|output" -> { index, socket }
  const socketCacheRef = useRef<{
    key: string;
    index: number;
    socket: { id: string; type: string; position?: number };
  } | null>(null);

  // Shader material
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(defaultLineColor) },
          uAASmooth: { value: 0.3 },
          uLength: { value: 100 },
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

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current) return;

    const { connectionDraft, nodeMap, viewport } = store.getState();

    if (!connectionDraft) {
      mesh.visible = false;
      mesh.geometry.setDrawRange(0, 0);
      socketCacheRef.current = null; // Clear cache when draft ends
      return;
    }

    const sourceNode = nodeMap.get(connectionDraft.source.nodeId);
    if (!sourceNode) {
      mesh.visible = false;
      return;
    }

    // Calculate source socket position
    const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;
    const sourceHeight = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
    const sourceSockets = connectionDraft.source.isInput
      ? sourceNode.inputs
      : sourceNode.outputs;

    if (!sourceSockets) {
      mesh.visible = false;
      return;
    }

    // O(1) socket lookup via cache (only compute once per connection draft)
    const cacheKey = `${connectionDraft.source.nodeId}:${connectionDraft.source.socketId}:${connectionDraft.source.isInput ? 'input' : 'output'}`;
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
    const yOffset =
      socket.position !== undefined
        ? socket.position * sourceHeight
        : SOCKET_MARGIN_TOP + socketIndex * SOCKET_SPACING;

    const sourceX = connectionDraft.source.isInput
      ? sourceNode.position.x
      : sourceNode.position.x + sourceWidth;
    const sourceY = sourceNode.position.y + yOffset;

    // Target is current mouse position
    const targetX = connectionDraft.mouseWorld.x;
    const targetY = connectionDraft.mouseWorld.y;

    // Calculate bezier control points
    const dx = targetX - sourceX;
    const absDx = Math.abs(dx);
    const distance = Math.sqrt(dx * dx + (targetY - sourceY) ** 2);
    const baseOffset = Math.min(absDx * 0.5, distance * 0.4);
    const offset = Math.max(baseOffset, Math.min(absDx * 0.25, 50));

    // Control points direction depends on whether dragging from input or output
    const cx1 = connectionDraft.source.isInput ? sourceX - offset : sourceX + offset;
    const cy1 = sourceY;
    const cx2 = connectionDraft.source.isInput ? targetX + offset : targetX - offset;
    const cy2 = targetY;

    // Half-width for ribbon (scaled by zoom)
    const halfWidth = LINE_WIDTH / 2 / viewport.zoom;

    // Generate curve points into pre-allocated buffer
    const points = pointsRef.current;
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;

      const idx = s * 2;
      points[idx] = mt3 * sourceX + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * targetX;
      points[idx + 1] = mt3 * sourceY + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * targetY;
    }

    // Generate ribbon geometry and calculate length in single pass
    const buffers = buffersRef.current;
    let vertexIndex = 0;
    let curveLength = 0;

    for (let p = 0; p < SEGMENTS; p++) {
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
      const u0 = p / SEGMENTS;
      const u1 = (p + 1) / SEGMENTS;

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

    // Update length uniform for consistent dash sizing
    material.uniforms.uLength.value = curveLength;

    // Update GPU buffers
    if (buffers.positionAttr && buffers.uvAttr) {
      buffers.positionAttr.needsUpdate = true;
      buffers.uvAttr.needsUpdate = true;
    }

    mesh.geometry.setDrawRange(0, vertexIndex);
    mesh.visible = true;

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
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false}>
      <bufferGeometry />
    </mesh>
  );
}
