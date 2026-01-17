import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import {
  DEFAULT_SOCKET_TYPES,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_RADIUS,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
} from '../core/constants';
import { isSocketCompatible } from '../utils/connections';
import type { SocketType } from '../types';

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
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Circle geometry
  const geometry = useMemo(() => new THREE.CircleGeometry(SOCKET_RADIUS, 16), []);

  // Shader material for socket rendering
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aHovered;
          attribute float aConnected;
          attribute float aValidTarget;

          varying vec3 vColor;
          varying float vHovered;
          varying float vConnected;
          varying float vValidTarget;
          varying vec2 vUv;

          void main() {
            vColor = aColor;
            vHovered = aHovered;
            vConnected = aConnected;
            vValidTarget = aValidTarget;
            vUv = uv;

            // Scale up when hovered
            vec3 pos = position * (1.0 + aHovered * 0.3);

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          varying vec3 vColor;
          varying float vHovered;
          varying float vConnected;
          varying float vValidTarget;
          varying vec2 vUv;

          void main() {
            // Distance from center for SDF circle
            vec2 center = vec2(0.5, 0.5);
            float dist = length(vUv - center) * 2.0;

            // Anti-aliased circle
            float aa = fwidth(dist) * 1.5;
            float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, dist);

            // Color: use socket type color, brighten if hovered/valid target
            vec3 color = vColor;
            color = mix(color, color * 1.4, vHovered);
            color = mix(color, vec3(0.3, 0.9, 0.4), vValidTarget * 0.6);

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
    []
  );

  // Pre-allocated buffers
  const buffers = useMemo(
    () => ({
      colors: new Float32Array(capacity * 3),
      hovered: new Float32Array(capacity),
      connected: new Float32Array(capacity),
      validTarget: new Float32Array(capacity),
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      hoveredAttr: null as THREE.InstancedBufferAttribute | null,
      connectedAttr: null as THREE.InstancedBufferAttribute | null,
      validTargetAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

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

    mesh.geometry.setAttribute('aColor', buffers.colorAttr);
    mesh.geometry.setAttribute('aHovered', buffers.hoveredAttr);
    mesh.geometry.setAttribute('aConnected', buffers.connectedAttr);
    mesh.geometry.setAttribute('aValidTarget', buffers.validTargetAttr);
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
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => {
        dirtyRef.current = true;
      }
    );
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
      () => {
        dirtyRef.current = true;
      }
    );

    return () => {
      unsubNodes();
      unsubViewport();
      unsubHoveredSocket();
      unsubConnectionDraft();
      unsubEdges();
    };
  }, [store]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current || !dirtyRef.current) return;

    const { nodes, viewport, hoveredSocketId, connectionDraft, edges } =
      store.getState();

    // Build connected sockets set for O(1) lookup
    const connectedSockets = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceSocket) {
        connectedSockets.add(`${edge.source}:${edge.sourceSocket}:output`);
      }
      if (edge.targetSocket) {
        connectedSockets.add(`${edge.target}:${edge.targetSocket}:input`);
      }
    }

    // Viewport culling bounds
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 100;

    let visibleCount = 0;

    for (const node of nodes) {
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;

      // Frustum culling
      if (
        node.position.x + width < viewLeft - cullPadding ||
        node.position.x > viewRight + cullPadding ||
        node.position.y + height < viewTop - cullPadding ||
        node.position.y > viewBottom + cullPadding
      ) {
        continue;
      }

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
            socketTypes[socket.type] ?? socketTypes.any ?? { color: '#808080' };
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
          let isValidTarget = 0.0;
          if (connectionDraft && !connectionDraft.source.isInput) {
            isValidTarget = isSocketCompatible(
              connectionDraft.source,
              { nodeId: node.id, socketId: socket.id, isInput: true },
              nodes,
              socketTypes
            )
              ? 1.0
              : 0.0;
          }
          buffers.validTarget[visibleCount] = isValidTarget;

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
            socketTypes[socket.type] ?? socketTypes.any ?? { color: '#808080' };
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
          let isValidTarget = 0.0;
          if (connectionDraft && connectionDraft.source.isInput) {
            isValidTarget = isSocketCompatible(
              connectionDraft.source,
              { nodeId: node.id, socketId: socket.id, isInput: false },
              nodes,
              socketTypes
            )
              ? 1.0
              : 0.0;
          }
          buffers.validTarget[visibleCount] = isValidTarget;

          visibleCount++;
        }
      }
    }

    // Check capacity
    if (visibleCount >= capacity) {
      setCapacity(Math.ceil(visibleCount * BUFFER_GROWTH_FACTOR));
    }

    // Update GPU buffers
    mesh.instanceMatrix.needsUpdate = true;
    if (buffers.colorAttr) buffers.colorAttr.needsUpdate = true;
    if (buffers.hoveredAttr) buffers.hoveredAttr.needsUpdate = true;
    if (buffers.connectedAttr) buffers.connectedAttr.needsUpdate = true;
    if (buffers.validTargetAttr) buffers.validTargetAttr.needsUpdate = true;

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
