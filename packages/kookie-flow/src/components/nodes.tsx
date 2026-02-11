import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { useTheme } from '../contexts/ThemeContext';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { resolveAccentColorRGB } from '../utils/accent-colors';
import { DEFAULT_ENTITY_WIDTH } from '../core/constants';
import type { EntityStatus } from '../types';

// Status enum encoding for GPU (matches aStatus attribute)
const STATUS_NONE = 0;
const STATUS_ERROR = 1;
const STATUS_WARNING = 2;
const STATUS_RUNNING = 3;
const STATUS_SUCCESS = 4;

function encodeStatus(status: EntityStatus | undefined): number {
  switch (status) {
    case 'error': return STATUS_ERROR;
    case 'warning': return STATUS_WARNING;
    case 'running': return STATUS_RUNNING;
    case 'success': return STATUS_SUCCESS;
    default: return STATUS_NONE;
  }
}

// Pre-allocated objects to avoid GC
const tempMatrix = new THREE.Matrix4();

// Buffer growth factor
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 256;

// Render order constants for z-index layering across components
const RENDER_ORDER_BG = 1; // Non-selected entities
const RENDER_ORDER_FG = 4; // Selected entities (above selected edges)

interface InstanceBuffers {
  sizes: Float32Array;
  accentColor: Float32Array;
  status: Float32Array;
  sizeAttr: THREE.InstancedBufferAttribute | null;
  accentColorAttr: THREE.InstancedBufferAttribute | null;
  statusAttr: THREE.InstancedBufferAttribute | null;
}

function createBuffers(capacity: number): InstanceBuffers {
  return {
    sizes: new Float32Array(capacity * 2),
    accentColor: new Float32Array(capacity * 3),
    status: new Float32Array(capacity),
    sizeAttr: null,
    accentColorAttr: null,
    statusAttr: null,
  };
}

function initMeshBuffers(mesh: THREE.InstancedMesh, bufs: InstanceBuffers) {
  bufs.sizeAttr = new THREE.InstancedBufferAttribute(bufs.sizes, 2);
  bufs.sizeAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.accentColorAttr = new THREE.InstancedBufferAttribute(bufs.accentColor, 3);
  bufs.accentColorAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.statusAttr = new THREE.InstancedBufferAttribute(bufs.status, 1);
  bufs.statusAttr.setUsage(THREE.DynamicDrawUsage);

  mesh.geometry.setAttribute('aSize', bufs.sizeAttr);
  mesh.geometry.setAttribute('aAccentColor', bufs.accentColorAttr);
  mesh.geometry.setAttribute('aStatus', bufs.statusAttr);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

function markBuffersForUpload(bufs: InstanceBuffers) {
  if (bufs.sizeAttr) bufs.sizeAttr.needsUpdate = true;
  if (bufs.accentColorAttr) bufs.accentColorAttr.needsUpdate = true;
  if (bufs.statusAttr) bufs.statusAttr.needsUpdate = true;
}

/**
 * High-performance instanced mesh renderer for entities.
 *
 * Renders two InstancedMeshes (background + foreground) so that selected
 * entities appear above non-selected sockets and edges via renderOrder.
 *
 * Key optimizations:
 * - Pre-allocated, reusable buffers (no GC pressure)
 * - Direct GPU buffer updates (bypasses React)
 * - Viewport frustum culling
 * - Dirty flag to skip unnecessary updates
 */
export function Entities() {
  const store = useFlowStoreApi();
  const bgMeshRef = useRef<THREE.InstancedMesh>(null);
  const fgMeshRef = useRef<THREE.InstancedMesh>(null);
  const resolvedStyle = useResolvedStyle();
  const socketLayout = useSocketLayout();
  const tokens = useTheme();

  // Get initial entity count for capacity
  const [capacity, setCapacity] = useState(() => {
    const initialEntities = store.getState().entities;
    return Math.max(MIN_CAPACITY, Math.ceil(initialEntities.length * BUFFER_GROWTH_FACTOR));
  });

  // Dirty flag for updates
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Each mesh needs its own geometry (attributes are per-geometry)
  const bgGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const fgGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Create material with resolved style (shared between both meshes)
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBackgroundColor: { value: new THREE.Color(...resolvedStyle.background) },
        uBorderColor: { value: new THREE.Color(...resolvedStyle.borderColor) },
        uCornerRadius: { value: resolvedStyle.borderRadius },
        uBorderWidth: { value: resolvedStyle.borderWidth },
        uBackgroundAlpha: { value: resolvedStyle.backgroundAlpha },
        // Header styling
        uHeaderColor: { value: new THREE.Color(...resolvedStyle.headerBackground) },
        uHeaderHeight: { value: resolvedStyle.headerHeight },
        uHeaderPosition: { value: resolvedStyle.headerPosition },
        // Shadow styling (classic variant)
        uShadowBlur: { value: resolvedStyle.shadowBlur },
        uShadowOffsetY: { value: resolvedStyle.shadowOffsetY },
        uShadowOpacity: { value: resolvedStyle.shadowOpacity },
        // Status rendering
        uTime: { value: 0 },
        uStatusErrorColor: { value: new THREE.Color(0.93, 0.28, 0.26) },   // red-9
        uStatusWarningColor: { value: new THREE.Color(1.0, 0.64, 0.0) },   // amber-9
        uStatusRunningColor: { value: new THREE.Color(0.39, 0.40, 0.96) },  // indigo-9 (accent)
        uStatusSuccessColor: { value: new THREE.Color(0.30, 0.75, 0.39) },  // green-9
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSize;
        attribute vec3 aAccentColor; // Per-entity accent color override (-1 = use global)
        attribute float aStatus; // 0=none, 1=error, 2=warning, 3=running, 4=success

        uniform float uShadowBlur;
        uniform float uShadowOffsetY;

        varying vec2 vUv;
        varying vec2 vSize;
        varying vec2 vExpandedSize;
        varying vec3 vAccentColor;
        varying float vStatus;

        void main() {
          vUv = uv;
          vSize = aSize;
          vAccentColor = aAccentColor;
          vStatus = aStatus;

          // Expand geometry to include shadow padding
          float shadowPadding = uShadowBlur + abs(uShadowOffsetY);
          vec2 expandedSize = aSize + vec2(shadowPadding * 2.0);
          vExpandedSize = expandedSize;

          vec3 pos = position;
          pos.x *= expandedSize.x;
          pos.y *= expandedSize.y;

          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform vec3 uBackgroundColor;
        uniform vec3 uBorderColor;
        uniform float uCornerRadius;
        uniform float uBorderWidth;
        uniform float uBackgroundAlpha;
        // Header uniforms
        uniform vec3 uHeaderColor;
        uniform float uHeaderHeight;
        uniform float uHeaderPosition; // 0=none, 1=inside, 2=outside
        // Shadow uniforms
        uniform float uShadowBlur;
        uniform float uShadowOffsetY;
        uniform float uShadowOpacity;
        // Status uniforms
        uniform float uTime;
        uniform vec3 uStatusErrorColor;
        uniform vec3 uStatusWarningColor;
        uniform vec3 uStatusRunningColor;
        uniform vec3 uStatusSuccessColor;

        varying vec2 vUv;
        varying vec2 vSize;
        varying vec2 vExpandedSize;
        varying vec3 vAccentColor; // Per-entity accent color override (-1 = use global)
        varying float vStatus; // 0=none, 1=error, 2=warning, 3=running, 4=success

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

        void main() {
          // Map UV to expanded coordinate space, then use entity size for SDF
          vec2 p = (vUv - 0.5) * vExpandedSize;
          vec2 b = vSize * 0.5;

          // Shadow calculation (rendered behind main shape)
          float shadowAlpha = 0.0;
          if (uShadowOpacity > 0.0) {
            // Offset shadow position (Y is negated because WebGL Y-up vs our Y-down)
            vec2 shadowP = p + vec2(0.0, uShadowOffsetY);
            float shadowD = roundedBoxSDF(shadowP, b, uCornerRadius);
            // Soft shadow using blur as the falloff distance
            shadowAlpha = uShadowOpacity * (1.0 - smoothstep(-uShadowBlur, uShadowBlur * 0.5, shadowD));
          }

          float d = roundedBoxSDF(p, b, uCornerRadius);

          // Early discard for pixels outside both shadow and main shape
          float maxExtent = max(uBorderWidth, uShadowBlur + abs(uShadowOffsetY)) + 1.0;
          if (d > maxExtent && shadowAlpha < 0.01) discard;

          // Background color (selection/hover handled by EntitySelection layer)
          vec3 bgColor = uBackgroundColor;

          // Resolve header color: per-entity override if r >= 0, else global uniform
          // For per-entity colors, create a subtle tint by mixing with background (like --accent-3)
          // Global uHeaderColor is already a subtle tint (--accent-3 or --gray-3)
          vec3 resolvedHeaderColor = vAccentColor.r < 0.0
            ? uHeaderColor
            : mix(bgColor, vAccentColor, 0.15); // 15% tint to match subtle -3 variants

          // Header region check (top of entity) - only for "inside" mode (1.0)
          // "outside" mode (2.0) has no colored header - just floating text above
          if (uHeaderPosition > 0.5 && uHeaderPosition < 1.5) {
            float halfHeight = b.y;
            float headerBottom = halfHeight - uHeaderHeight;
            // Smoothstep for anti-aliased edge between header and body
            float headerMask = smoothstep(headerBottom - 0.5, headerBottom + 0.5, p.y);
            bgColor = mix(bgColor, resolvedHeaderColor, headerMask);
          }

          // Border color (selection/hover handled by EntitySelection layer)
          vec3 borderColor = uBorderColor;

          // Status border override
          float statusBorderWidth = uBorderWidth;
          if (vStatus > 0.5) {
            vec3 statusColor = uBorderColor;
            if (vStatus < 1.5) {
              // Error: solid red border
              statusColor = uStatusErrorColor;
            } else if (vStatus < 2.5) {
              // Warning: solid amber border
              statusColor = uStatusWarningColor;
            } else if (vStatus < 3.5) {
              // Running: pulsing accent border (sine wave 0.4–1.0 opacity)
              float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
              statusColor = mix(uBorderColor, uStatusRunningColor, pulse);
            } else {
              // Success: green flash that fades out (uses fract of time as progress)
              // The CPU side encodes a countdown in the status; here we just show green
              float flash = 0.7 + 0.3 * sin(uTime * 4.0);
              statusColor = mix(uBorderColor, uStatusSuccessColor, flash);
            }
            borderColor = statusColor;
            statusBorderWidth = uBorderWidth + 0.5; // Slightly thicker for visibility
          }

          // Simplified AA - single fwidth call
          float aa = fwidth(d) * 1.5;

          // Border calculation
          float borderD = d + statusBorderWidth;
          float borderMask = smoothstep(-aa, aa, borderD) - smoothstep(-aa, aa, d);

          // Background fill (respects backgroundAlpha for ghost/outline variants)
          float fillMask = 1.0 - smoothstep(-aa, aa, d);
          float bgAlpha = fillMask * uBackgroundAlpha;

          // Composite: shadow first, then border on top of background
          // Shadow is black, behind everything
          vec3 shadowColor = vec3(0.0);
          float shadowMask = shadowAlpha * (1.0 - fillMask); // Shadow only visible outside main shape

          vec3 color = mix(bgColor, borderColor, borderMask);
          float alpha = max(bgAlpha, borderMask * fillMask);

          // For transparent backgrounds, only show border
          if (uBackgroundAlpha < 0.01) {
            color = borderColor;
            alpha = borderMask * fillMask;
          }

          // Blend shadow underneath (premultiplied alpha compositing)
          color = mix(shadowColor, color, clamp(alpha / max(alpha + shadowMask, 0.001), 0.0, 1.0));
          alpha = alpha + shadowMask * (1.0 - alpha);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [resolvedStyle]);

  // Buffers for background (non-selected) and foreground (selected) meshes
  const bgBuffers = useMemo(() => createBuffers(capacity), [capacity]);
  const fgBuffers = useMemo(() => createBuffers(capacity), [capacity]);

  // Reset initialized flag when capacity changes (meshes will be recreated via key)
  useEffect(() => {
    initializedRef.current = false;
  }, [capacity]);

  // Initialize attributes when meshes are ready
  useEffect(() => {
    if (!bgMeshRef.current || !fgMeshRef.current) return;
    initMeshBuffers(bgMeshRef.current, bgBuffers);
    initMeshBuffers(fgMeshRef.current, fgBuffers);
    initializedRef.current = true;
    dirtyRef.current = true;
  }, [bgBuffers, fgBuffers]);

  // Subscribe to store changes
  useEffect(() => {
    const unsubEntities = store.subscribe(
      (state) => state.entities,
      (entities) => {
        dirtyRef.current = true;
        // Check if we need more capacity
        if (entities.length > capacity) {
          setCapacity(Math.ceil(entities.length * BUFFER_GROWTH_FACTOR));
        }
      }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
    // Subscribe to hidden entity changes (Phase 7C) - O(1) lookup in hot path
    const unsubHidden = store.subscribe(
      (state) => state.hiddenEntityIds,
      () => { dirtyRef.current = true; }
    );
    // Subscribe to selection changes so selected entities render in foreground mesh
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubEntities();
      unsubViewport();
      unsubHidden();
      unsubSelection();
    };
  }, [store, capacity]);

  // Track whether any entity has an animated status (running/success)
  const hasAnimatedStatusRef = useRef(false);

  // Use R3F's useFrame for RAF-synchronized updates
  useFrame(({ size, clock }) => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;

    if (!bgMesh || !fgMesh || !initializedRef.current) return;

    // Always update time uniform for animated statuses
    if (hasAnimatedStatusRef.current) {
      (material.uniforms.uTime as { value: number }).value = clock.elapsedTime;
    }

    if (!dirtyRef.current) return;

    const { entities, viewport, hiddenEntityIds, selectedEntityIds } = store.getState();
    if (entities.length === 0) {
      bgMesh.count = 0;
      fgMesh.count = 0;
      dirtyRef.current = false;
      return;
    }

    // Viewport bounds in world space for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;

    // Padding for entities partially in view
    const cullPadding = 300;

    let bgCount = 0;
    let fgCount = 0;
    let hasAnimated = false;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      // Skip special entity types (handled by separate renderers)
      if (entity.type === 'comment' || entity.type === 'reroute') continue;

      // Skip entities inside collapsed frames - O(1) lookup
      if (hiddenEntityIds.has(entity.id)) continue;

      const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
      const entityLayout = getEntitySocketLayout(entity, socketLayout);
      const height = entity.height ?? entityLayout.computedHeight;

      // Frustum culling - skip entities outside viewport
      const entityRight = entity.position.x + width;
      const entityBottom = entity.position.y + height;

      if (
        entityRight < viewLeft - cullPadding ||
        entity.position.x > viewRight + cullPadding ||
        entityBottom < viewTop - cullPadding ||
        entity.position.y > viewBottom + cullPadding
      ) continue;

      // Route to foreground (selected) or background (non-selected) mesh
      const isSelected = selectedEntityIds.has(entity.id);
      const mesh = isSelected ? fgMesh : bgMesh;
      const bufs = isSelected ? fgBuffers : bgBuffers;
      const idx = isSelected ? fgCount : bgCount;

      if (idx >= capacity) continue;

      // Update matrix for visible entity
      tempMatrix.identity();
      tempMatrix.setPosition(
        entity.position.x + width / 2,
        -(entity.position.y + height / 2),
        0
      );
      mesh.setMatrixAt(idx, tempMatrix);

      // Update attributes
      bufs.sizes[idx * 2] = width;
      bufs.sizes[idx * 2 + 1] = height;

      const accentRGB = resolveAccentColorRGB(entity.color, tokens);
      bufs.accentColor[idx * 3] = accentRGB[0];
      bufs.accentColor[idx * 3 + 1] = accentRGB[1];
      bufs.accentColor[idx * 3 + 2] = accentRGB[2];

      const status = encodeStatus(entity.data?.status);
      bufs.status[idx] = status;
      if (status > 2.5) hasAnimated = true;

      if (isSelected) fgCount++;
      else bgCount++;
    }

    hasAnimatedStatusRef.current = hasAnimated;

    // Update GPU buffers for both meshes
    bgMesh.instanceMatrix.needsUpdate = true;
    fgMesh.instanceMatrix.needsUpdate = true;
    markBuffersForUpload(bgBuffers);
    markBuffersForUpload(fgBuffers);

    // Safety: never exceed buffer capacity to prevent WebGL errors
    bgMesh.count = Math.min(bgCount, capacity);
    fgMesh.count = Math.min(fgCount, capacity);
    dirtyRef.current = false;
  });

  // Key forces remount when capacity changes to get new InstancedMeshes
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
