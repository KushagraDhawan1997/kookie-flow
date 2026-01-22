import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import {
  DEFAULT_SOCKET_TYPES,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_RADIUS,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
} from '../core/constants';
import { areTypesCompatible } from '../utils/connections';
import type { SocketType } from '../types';
import { rgbToHex } from '../utils/color';

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;

interface SocketsProps {
  socketTypes?: Record<string, SocketType>;
}

export function Sockets({
  socketTypes = DEFAULT_SOCKET_TYPES,
}: SocketsProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Derive colors from theme tokens
  const invalidColor = tokens['--red-9'];
  const validTargetColor = tokens['--green-9'];
  const fallbackSocketColor = rgbToHex(tokens['--gray-8']);

  // Cached connected sockets Set (rebuilt only when edges change, not every frame)
  const connectedSocketsRef = useRef<Set<string>>(new Set());

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

  // Circle geometry
  const geometry = useMemo(() => new THREE.CircleGeometry(SOCKET_RADIUS, 16), []);

  // Shader material for socket rendering
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInvalidColor: { value: new THREE.Color(invalidColor[0], invalidColor[1], invalidColor[2]) },
          uValidTargetColor: { value: new THREE.Color(validTargetColor[0], validTargetColor[1], validTargetColor[2]) },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aHovered;
          attribute float aConnected;
          attribute float aValidTarget;
          attribute float aInvalidHover;

          varying vec3 vColor;
          varying float vHovered;
          varying float vConnected;
          varying float vValidTarget;
          varying float vInvalidHover;
          varying vec2 vUv;

          void main() {
            vColor = aColor;
            vHovered = aHovered;
            vConnected = aConnected;
            vValidTarget = aValidTarget;
            vInvalidHover = aInvalidHover;
            vUv = uv;

            // Scale up when hovered
            vec3 pos = position * (1.0 + aHovered * 0.3);

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform vec3 uInvalidColor;
          uniform vec3 uValidTargetColor;

          varying vec3 vColor;
          varying float vHovered;
          varying float vConnected;
          varying float vValidTarget;
          varying float vInvalidHover;
          varying vec2 vUv;

          void main() {
            // Distance from center for SDF circle
            vec2 center = vec2(0.5, 0.5);
            float dist = length(vUv - center) * 2.0;

            // Anti-aliased circle
            float aa = fwidth(dist) * 1.5;
            float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, dist);

            // Base color: socket type color or invalid color if hovering invalid target
            vec3 color = mix(vColor, uInvalidColor, vInvalidHover);

            // Only apply hover/valid brightening if NOT invalid
            float notInvalid = 1.0 - vInvalidHover;
            color = mix(color, color * 1.4, vHovered * notInvalid);
            color = mix(color, uValidTargetColor, vValidTarget * 0.6 * notInvalid);

            // Inner hollow for disconnected sockets (thinner ring = more visible hollow)
            float innerRadius = 0.65;
            float innerMask = smoothstep(innerRadius - aa, innerRadius, dist);

            // vConnected=1 (connected): solid fill
            // vConnected=0 (disconnected): hollow ring (innerMask makes center transparent)
            float fillAlpha = mix(innerMask, 1.0, vConnected);

            gl_FragColor = vec4(color, alpha * fillAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [invalidColor, validTargetColor]
  );

  // Pre-allocated buffers
  const buffers = useMemo(
    () => ({
      colors: new Float32Array(capacity * 3),
      hovered: new Float32Array(capacity),
      connected: new Float32Array(capacity),
      validTarget: new Float32Array(capacity),
      invalidHover: new Float32Array(capacity),
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      hoveredAttr: null as THREE.InstancedBufferAttribute | null,
      connectedAttr: null as THREE.InstancedBufferAttribute | null,
      validTargetAttr: null as THREE.InstancedBufferAttribute | null,
      invalidHoverAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (capacityRafIdRef.current !== null) {
        cancelAnimationFrame(capacityRafIdRef.current);
        capacityRafIdRef.current = null;
      }
    };
  }, []);

  // Initialize attributes
  useEffect(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;

    buffers.colorAttr = new THREE.InstancedBufferAttribute(buffers.colors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.hoveredAttr = new THREE.InstancedBufferAttribute(buffers.hovered, 1);
    buffers.hoveredAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.connectedAttr = new THREE.InstancedBufferAttribute(
      buffers.connected,
      1
    );
    buffers.connectedAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.validTargetAttr = new THREE.InstancedBufferAttribute(
      buffers.validTarget,
      1
    );
    buffers.validTargetAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.invalidHoverAttr = new THREE.InstancedBufferAttribute(
      buffers.invalidHover,
      1
    );
    buffers.invalidHoverAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aColor', buffers.colorAttr);
    mesh.geometry.setAttribute('aHovered', buffers.hoveredAttr);
    mesh.geometry.setAttribute('aConnected', buffers.connectedAttr);
    mesh.geometry.setAttribute('aValidTarget', buffers.validTargetAttr);
    mesh.geometry.setAttribute('aInvalidHover', buffers.invalidHoverAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    initializedRef.current = true;
    dirtyRef.current = true;
  }, [buffers]);

  // Store subscriptions
  useEffect(() => {
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      () => {
        dirtyRef.current = true;
      }
    );
    // Note: viewport changes no longer trigger dirty - GPU handles clipping efficiently
    // This allows zoom/pan without geometry rebuilds
    const unsubHoveredSocket = store.subscribe(
      (state) => state.hoveredSocketId,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubConnectionDraft = store.subscribe(
      (state) => state.connectionDraft,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      (edges) => {
        // Rebuild connected sockets Set when edges change (not every frame)
        const connectedSockets = connectedSocketsRef.current;
        connectedSockets.clear();
        for (const edge of edges) {
          if (edge.sourceSocket) {
            connectedSockets.add(`${edge.source}:${edge.sourceSocket}:output`);
          }
          if (edge.targetSocket) {
            connectedSockets.add(`${edge.target}:${edge.targetSocket}:input`);
          }
        }
        dirtyRef.current = true;
      }
    );

    // Initialize connected sockets from current edges
    const { edges: initialEdges } = store.getState();
    for (const edge of initialEdges) {
      if (edge.sourceSocket) {
        connectedSocketsRef.current.add(`${edge.source}:${edge.sourceSocket}:output`);
      }
      if (edge.targetSocket) {
        connectedSocketsRef.current.add(`${edge.target}:${edge.targetSocket}:input`);
      }
    }

    return () => {
      unsubNodes();
      unsubHoveredSocket();
      unsubConnectionDraft();
      unsubEdges();
    };
  }, [store]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current) return;

    // Mark dirty on canvas resize (prevents ghosting)
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
      dirtyRef.current = true;
    }

    if (!dirtyRef.current) return;

    const { nodes, nodeMap, hoveredSocketId, connectionDraft } =
      store.getState();

    // Use cached connected sockets Set (rebuilt only when edges change)
    const connectedSockets = connectedSocketsRef.current;

    // Get source socket type with caching (O(1) after first lookup per connection draft)
    let sourceSocketType: string | null = null;
    if (connectionDraft) {
      const cacheKey = `${connectionDraft.source.nodeId}:${connectionDraft.source.socketId}:${connectionDraft.source.isInput ? 'input' : 'output'}`;
      if (sourceSocketCacheRef.current?.key === cacheKey) {
        // Cache hit - O(1)
        sourceSocketType = sourceSocketCacheRef.current.type;
      } else {
        // Cache miss - O(n) but only once per connection draft
        const sourceNode = nodeMap.get(connectionDraft.source.nodeId);
        if (sourceNode) {
          const sourceSockets = connectionDraft.source.isInput
            ? sourceNode.inputs
            : sourceNode.outputs;
          const sourceSocket = sourceSockets?.find(
            (s) => s.id === connectionDraft.source.socketId
          );
          sourceSocketType = sourceSocket?.type ?? null;
          if (sourceSocketType) {
            sourceSocketCacheRef.current = { key: cacheKey, type: sourceSocketType };
          }
        }
      }
    } else {
      // Clear cache when no connection draft
      sourceSocketCacheRef.current = null;
    }

    // Note: CPU-side frustum culling removed - GPU handles clipping efficiently
    // This allows zoom/pan without geometry rebuilds

    let visibleCount = 0;

    for (const node of nodes) {
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;

      // Render input sockets
      if (node.inputs) {
        for (let i = 0; i < node.inputs.length; i++) {
          if (visibleCount >= capacity) break;

          const socket = node.inputs[i];
          const yOffset =
            socket.position !== undefined
              ? socket.position * height
              : SOCKET_MARGIN_TOP + i * SOCKET_SPACING;

          // Position matrix
          tempMatrix.identity();
          tempMatrix.setPosition(
            node.position.x,
            -(node.position.y + yOffset), // Negate Y for WebGL
            0.5 // Above edges
          );
          mesh.setMatrixAt(visibleCount, tempMatrix);

          // Color from socket type
          const typeConfig =
            socketTypes[socket.type] ?? socketTypes.any ?? { color: fallbackSocketColor };
          tempColor.set(typeConfig.color);
          buffers.colors[visibleCount * 3] = tempColor.r;
          buffers.colors[visibleCount * 3 + 1] = tempColor.g;
          buffers.colors[visibleCount * 3 + 2] = tempColor.b;

          // Hovered state
          const isHovered =
            hoveredSocketId?.nodeId === node.id &&
            hoveredSocketId?.socketId === socket.id &&
            hoveredSocketId?.isInput === true;
          buffers.hovered[visibleCount] = isHovered ? 1.0 : 0.0;

          // Connected state
          const socketKey = `${node.id}:${socket.id}:input`;
          buffers.connected[visibleCount] = connectedSockets.has(socketKey)
            ? 1.0
            : 0.0;

          // Valid target (during connection draft from an output)
          // Fast path: use cached sourceSocketType and areTypesCompatible
          let isValidTarget = 0.0;
          if (connectionDraft && !connectionDraft.source.isInput && sourceSocketType) {
            // Must connect output to input (not same node)
            const isStructurallyValid = connectionDraft.source.nodeId !== node.id;
            const isTypeCompatible = areTypesCompatible(
              sourceSocketType,
              socket.type,
              socketTypes
            );
            isValidTarget = isStructurallyValid && isTypeCompatible ? 1.0 : 0.0;
          }
          buffers.validTarget[visibleCount] = isValidTarget;

          // Invalid hover: this socket is hovered AND is NOT a valid target
          // Reuses the isValidTarget computation (no extra isSocketCompatible call)
          const isInvalidHover =
            isHovered && connectionDraft && isValidTarget === 0.0 ? 1.0 : 0.0;
          buffers.invalidHover[visibleCount] = isInvalidHover;

          visibleCount++;
        }
      }

      // Render output sockets
      if (node.outputs) {
        for (let i = 0; i < node.outputs.length; i++) {
          if (visibleCount >= capacity) break;

          const socket = node.outputs[i];
          const yOffset =
            socket.position !== undefined
              ? socket.position * height
              : SOCKET_MARGIN_TOP + i * SOCKET_SPACING;

          tempMatrix.identity();
          tempMatrix.setPosition(
            node.position.x + width,
            -(node.position.y + yOffset),
            0.5
          );
          mesh.setMatrixAt(visibleCount, tempMatrix);

          const typeConfig =
            socketTypes[socket.type] ?? socketTypes.any ?? { color: fallbackSocketColor };
          tempColor.set(typeConfig.color);
          buffers.colors[visibleCount * 3] = tempColor.r;
          buffers.colors[visibleCount * 3 + 1] = tempColor.g;
          buffers.colors[visibleCount * 3 + 2] = tempColor.b;

          const isHovered =
            hoveredSocketId?.nodeId === node.id &&
            hoveredSocketId?.socketId === socket.id &&
            hoveredSocketId?.isInput === false;
          buffers.hovered[visibleCount] = isHovered ? 1.0 : 0.0;

          const socketKey = `${node.id}:${socket.id}:output`;
          buffers.connected[visibleCount] = connectedSockets.has(socketKey)
            ? 1.0
            : 0.0;

          // Valid target (during connection draft from an input)
          // Fast path: use cached sourceSocketType and areTypesCompatible
          let isValidTarget = 0.0;
          if (connectionDraft && connectionDraft.source.isInput && sourceSocketType) {
            // Must connect input to output (not same node)
            const isStructurallyValid = connectionDraft.source.nodeId !== node.id;
            const isTypeCompatible = areTypesCompatible(
              sourceSocketType,
              socket.type,
              socketTypes
            );
            isValidTarget = isStructurallyValid && isTypeCompatible ? 1.0 : 0.0;
          }
          buffers.validTarget[visibleCount] = isValidTarget;

          // Invalid hover: this socket is hovered AND is NOT a valid target
          // Reuses the isValidTarget computation (no extra isSocketCompatible call)
          const isInvalidHover =
            isHovered && connectionDraft && isValidTarget === 0.0 ? 1.0 : 0.0;
          buffers.invalidHover[visibleCount] = isInvalidHover;

          visibleCount++;
        }
      }
    }

    // Check capacity - defer state update to avoid React re-render inside useFrame
    // Schedule RAF only when needed (not a continuous loop)
    if (visibleCount >= capacity) {
      const newCapacity = Math.ceil(visibleCount * BUFFER_GROWTH_FACTOR);
      if (pendingCapacityRef.current === null || newCapacity > pendingCapacityRef.current) {
        pendingCapacityRef.current = newCapacity;
        // Schedule RAF to apply the capacity update (if not already scheduled)
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

    // Update GPU buffers
    mesh.instanceMatrix.needsUpdate = true;
    if (buffers.colorAttr) buffers.colorAttr.needsUpdate = true;
    if (buffers.hoveredAttr) buffers.hoveredAttr.needsUpdate = true;
    if (buffers.connectedAttr) buffers.connectedAttr.needsUpdate = true;
    if (buffers.validTargetAttr) buffers.validTargetAttr.needsUpdate = true;
    if (buffers.invalidHoverAttr) buffers.invalidHoverAttr.needsUpdate = true;

    mesh.count = visibleCount;
    dirtyRef.current = false;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}
