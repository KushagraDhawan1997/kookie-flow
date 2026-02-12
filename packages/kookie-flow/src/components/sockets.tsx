import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { getMovedEntityIds } from '../core/store';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import {
  DEFAULT_SOCKET_TYPES,
  DEFAULT_ENTITY_WIDTH,
  SOCKET_RADIUS,
  SOCKET_OFFSET,
} from '../core/constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { areTypesCompatible } from '../utils/connections';
import { THEME_COLORS } from '../core/theme-colors';
import type { Entity, SocketType } from '../types';
import { rgbToHex } from '../utils/color';

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;

// Render order constants for z-index layering across components
const RENDER_ORDER_BG = 2; // Non-selected sockets (above non-selected entities)
const RENDER_ORDER_FG = 5; // Selected sockets (above selected entities)

interface SocketBuffers {
  colors: Float32Array;
  hovered: Float32Array;
  connected: Float32Array;
  validTarget: Float32Array;
  invalidHover: Float32Array;
  colorAttr: THREE.InstancedBufferAttribute | null;
  hoveredAttr: THREE.InstancedBufferAttribute | null;
  connectedAttr: THREE.InstancedBufferAttribute | null;
  validTargetAttr: THREE.InstancedBufferAttribute | null;
  invalidHoverAttr: THREE.InstancedBufferAttribute | null;
}

function createSocketBuffers(capacity: number): SocketBuffers {
  return {
    colors: new Float32Array(capacity * 3),
    hovered: new Float32Array(capacity),
    connected: new Float32Array(capacity),
    validTarget: new Float32Array(capacity),
    invalidHover: new Float32Array(capacity),
    colorAttr: null,
    hoveredAttr: null,
    connectedAttr: null,
    validTargetAttr: null,
    invalidHoverAttr: null,
  };
}

function initSocketMesh(mesh: THREE.InstancedMesh, bufs: SocketBuffers) {
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

  mesh.geometry.setAttribute('aColor', bufs.colorAttr);
  mesh.geometry.setAttribute('aHovered', bufs.hoveredAttr);
  mesh.geometry.setAttribute('aConnected', bufs.connectedAttr);
  mesh.geometry.setAttribute('aValidTarget', bufs.validTargetAttr);
  mesh.geometry.setAttribute('aInvalidHover', bufs.invalidHoverAttr);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

function markSocketBuffersForUpload(bufs: SocketBuffers) {
  if (bufs.colorAttr) bufs.colorAttr.needsUpdate = true;
  if (bufs.hoveredAttr) bufs.hoveredAttr.needsUpdate = true;
  if (bufs.connectedAttr) bufs.connectedAttr.needsUpdate = true;
  if (bufs.validTargetAttr) bufs.validTargetAttr.needsUpdate = true;
  if (bufs.invalidHoverAttr) bufs.invalidHoverAttr.needsUpdate = true;
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
  const lastPosVersionRef = useRef(-1);
  const initializedRef = useRef(false);

  // Reverse index: entityId → { mesh: 'bg'|'fg', instanceStart, instanceCount }
  // for O(K) position updates
  const entitySocketRangesRef = useRef<Map<string, { mesh: 'bg' | 'fg'; start: number; count: number }>>(new Map());

  // Derive colors from semantic theme config
  const invalidColor = tokens[THEME_COLORS.socket.invalid];
  const validTargetColor = tokens[THEME_COLORS.socket.validTarget];
  const fallbackSocketColor = rgbToHex(tokens[THEME_COLORS.socket.fallback]);

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

  // Circle geometry — separate per mesh (attributes are per-geometry)
  const bgGeometry = useMemo(() => new THREE.CircleGeometry(SOCKET_RADIUS, 16), []);
  const fgGeometry = useMemo(() => new THREE.CircleGeometry(SOCKET_RADIUS, 16), []);

  // Shader material for socket rendering (shared between both meshes)
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

  // Buffer sets for bg (non-selected entities) and fg (selected entities)
  const bgBuffers = useMemo(() => createSocketBuffers(capacity), [capacity]);
  const fgBuffers = useMemo(() => createSocketBuffers(capacity), [capacity]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (capacityRafIdRef.current !== null) {
        cancelAnimationFrame(capacityRafIdRef.current);
        capacityRafIdRef.current = null;
      }
    };
  }, []);

  // Reset initialized flag on capacity change
  useEffect(() => {
    initializedRef.current = false;
  }, [capacity]);

  // Initialize attributes
  useEffect(() => {
    if (!bgMeshRef.current || !fgMeshRef.current) return;
    initSocketMesh(bgMeshRef.current, bgBuffers);
    initSocketMesh(fgMeshRef.current, fgBuffers);
    initializedRef.current = true;
    dirtyRef.current = true;
  }, [bgBuffers, fgBuffers]);

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
    // Selection changes require full rebuild (sockets move between bg/fg meshes)
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => {
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
      unsubEntities();
      unsubHoveredSocket();
      unsubConnectionDraft();
      unsubEdges();
      unsubSelection();
    };
  }, [store]);

  // Helper: write all sockets for one entity into the target mesh/buffers
  const writeEntitySockets = (
    entity: Entity,
    mesh: THREE.InstancedMesh,
    bufs: SocketBuffers,
    startIdx: number,
    hoveredSocketId: { entityId: string; socketId: string; isInput: boolean } | null,
    connectionDraft: { source: { entityId: string; socketId: string; isInput: boolean } } | null,
    sourceSocketType: string | null,
    connectedSockets: Set<string>,
  ): number => {
    let idx = startIdx;
    const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
    const entityLayout = getEntitySocketLayout(entity, socketLayout);
    const height = entity.height ?? entityLayout.computedHeight;

    // Render input sockets
    if (entity.inputs) {
      for (let i = 0; i < entity.inputs.length; i++) {
        if (idx >= capacity) break;

        const socket = entity.inputs[i];
        const cachedPos = entityLayout.inputs[i];
        const yOffset =
          socket.position !== undefined
            ? socket.position * height
            : cachedPos?.yOffset ?? socketLayout.marginTop + socketLayout.rowHeight / 2;

        tempMatrix.identity();
        tempMatrix.setPosition(
          entity.position.x - SOCKET_OFFSET,
          -(entity.position.y + yOffset),
          0.5
        );
        mesh.setMatrixAt(idx, tempMatrix);

        const typeConfig =
          socketTypes[socket.type] ?? socketTypes.any ?? { color: fallbackSocketColor };
        tempColor.set(typeConfig.color);
        bufs.colors[idx * 3] = tempColor.r;
        bufs.colors[idx * 3 + 1] = tempColor.g;
        bufs.colors[idx * 3 + 2] = tempColor.b;

        const isHovered =
          hoveredSocketId?.entityId === entity.id &&
          hoveredSocketId?.socketId === socket.id &&
          hoveredSocketId?.isInput === true;
        bufs.hovered[idx] = isHovered ? 1.0 : 0.0;

        const socketKey = `${entity.id}:${socket.id}:input`;
        bufs.connected[idx] = connectedSockets.has(socketKey) ? 1.0 : 0.0;

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
        const cachedPos = entityLayout.outputs[i];
        const yOffset =
          socket.position !== undefined
            ? socket.position * height
            : cachedPos?.yOffset ?? socketLayout.marginTop + socketLayout.rowHeight / 2;

        tempMatrix.identity();
        tempMatrix.setPosition(
          entity.position.x + width + SOCKET_OFFSET,
          -(entity.position.y + yOffset),
          0.5
        );
        mesh.setMatrixAt(idx, tempMatrix);

        const typeConfig =
          socketTypes[socket.type] ?? socketTypes.any ?? { color: fallbackSocketColor };
        tempColor.set(typeConfig.color);
        bufs.colors[idx * 3] = tempColor.r;
        bufs.colors[idx * 3 + 1] = tempColor.g;
        bufs.colors[idx * 3 + 2] = tempColor.b;

        const isHovered =
          hoveredSocketId?.entityId === entity.id &&
          hoveredSocketId?.socketId === socket.id &&
          hoveredSocketId?.isInput === false;
        bufs.hovered[idx] = isHovered ? 1.0 : 0.0;

        const socketKey = `${entity.id}:${socket.id}:output`;
        bufs.connected[idx] = connectedSockets.has(socketKey) ? 1.0 : 0.0;

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

    // Position-only fast path: only update instance matrices for moved entities
    if (!dirtyRef.current && positionDirtyRef.current) {
      const movedIds = getMovedEntityIds();
      const socketRanges = entitySocketRangesRef.current;

      if (movedIds.size > 0 && socketRanges.size > 0) {
        const { entityMap } = store.getState();
        tempMatrix.identity();

        for (const entityId of movedIds) {
          const range = socketRanges.get(entityId);
          if (!range) continue;

          const entity = entityMap.get(entityId);
          if (!entity) continue;

          const mesh = range.mesh === 'fg' ? fgMesh : bgMesh;
          const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
          const entityLayout = getEntitySocketLayout(entity, socketLayout);
          const height = entity.height ?? entityLayout.computedHeight;

          let instanceIdx = range.start;

          if (entity.inputs) {
            for (let i = 0; i < entity.inputs.length; i++) {
              const socket = entity.inputs[i];
              const cachedPos = entityLayout.inputs[i];
              const yOffset =
                socket.position !== undefined
                  ? socket.position * height
                  : cachedPos?.yOffset ?? socketLayout.marginTop + socketLayout.rowHeight / 2;
              tempMatrix.setPosition(
                entity.position.x - SOCKET_OFFSET,
                -(entity.position.y + yOffset),
                0.5
              );
              mesh.setMatrixAt(instanceIdx, tempMatrix);
              instanceIdx++;
            }
          }

          if (entity.outputs) {
            for (let i = 0; i < entity.outputs.length; i++) {
              const socket = entity.outputs[i];
              const cachedPos = entityLayout.outputs[i];
              const yOffset =
                socket.position !== undefined
                  ? socket.position * height
                  : cachedPos?.yOffset ?? socketLayout.marginTop + socketLayout.rowHeight / 2;
              tempMatrix.setPosition(
                entity.position.x + width + SOCKET_OFFSET,
                -(entity.position.y + yOffset),
                0.5
              );
              mesh.setMatrixAt(instanceIdx, tempMatrix);
              instanceIdx++;
            }
          }
        }

        bgMesh.instanceMatrix.needsUpdate = true;
        fgMesh.instanceMatrix.needsUpdate = true;
      }

      positionDirtyRef.current = false;
      return;
    }

    if (!dirtyRef.current) return;

    const { entities, entityMap, hoveredSocketId, connectionDraft, selectedEntityIds } =
      store.getState();

    // Use cached connected sockets Set (rebuilt only when edges change)
    const connectedSockets = connectedSocketsRef.current;

    // Get source socket type with caching (O(1) after first lookup per connection draft)
    let sourceSocketType: string | null = null;
    if (connectionDraft) {
      const cacheKey = `${connectionDraft.source.entityId}:${connectionDraft.source.socketId}:${connectionDraft.source.isInput ? 'input' : 'output'}`;
      if (sourceSocketCacheRef.current?.key === cacheKey) {
        sourceSocketType = sourceSocketCacheRef.current.type;
      } else {
        const sourceEntity = entityMap.get(connectionDraft.source.entityId);
        if (sourceEntity) {
          const sourceSockets = connectionDraft.source.isInput
            ? sourceEntity.inputs
            : sourceEntity.outputs;
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
      sourceSocketCacheRef.current = null;
    }

    let bgCount = 0;
    let fgCount = 0;
    const socketRanges = entitySocketRangesRef.current;
    socketRanges.clear();

    for (const entity of entities) {
      const isSelected = selectedEntityIds.has(entity.id);
      const mesh = isSelected ? fgMesh : bgMesh;
      const bufs = isSelected ? fgBuffers : bgBuffers;
      const startIdx = isSelected ? fgCount : bgCount;

      const entitySocketStart = startIdx;
      const newIdx = writeEntitySockets(
        entity, mesh, bufs, startIdx,
        hoveredSocketId, connectionDraft, sourceSocketType, connectedSockets,
      );

      const socketsWritten = newIdx - startIdx;
      socketRanges.set(entity.id, {
        mesh: isSelected ? 'fg' : 'bg',
        start: entitySocketStart,
        count: socketsWritten,
      });

      if (isSelected) fgCount = newIdx;
      else bgCount = newIdx;
    }

    // Check capacity - defer state update to avoid React re-render inside useFrame
    const totalCount = bgCount + fgCount;
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

    // Update GPU buffers for both meshes
    bgMesh.instanceMatrix.needsUpdate = true;
    fgMesh.instanceMatrix.needsUpdate = true;
    markSocketBuffersForUpload(bgBuffers);
    markSocketBuffersForUpload(fgBuffers);

    bgMesh.count = Math.min(bgCount, capacity);
    fgMesh.count = Math.min(fgCount, capacity);
    dirtyRef.current = false;
    positionDirtyRef.current = false;
  });

  return (
    <>
      <instancedMesh
        key={`bg-${capacity}`}
        ref={bgMeshRef}
        args={[bgGeometry, material, capacity]}
        renderOrder={RENDER_ORDER_BG}
        frustumCulled={false}
      />
      <instancedMesh
        key={`fg-${capacity}`}
        ref={fgMeshRef}
        args={[fgGeometry, material, capacity]}
        renderOrder={RENDER_ORDER_FG}
        frustumCulled={false}
      />
    </>
  );
}
