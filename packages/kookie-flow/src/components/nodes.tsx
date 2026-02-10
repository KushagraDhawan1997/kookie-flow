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

/**
 * High-performance instanced mesh renderer for entities.
 * Key optimizations:
 * - Pre-allocated, reusable buffers (no GC pressure)
 * - Direct GPU buffer updates (bypasses React)
 * - Viewport frustum culling
 * - Dirty flag to skip unnecessary updates
 */
export function Entities() {
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.InstancedMesh>(null);
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

  // Create geometry once
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Create material with resolved style
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBackgroundColor: { value: new THREE.Color(...resolvedStyle.background) },
        uHoveredColor: { value: new THREE.Color(...resolvedStyle.backgroundHover) },
        uSelectedColor: { value: new THREE.Color(...resolvedStyle.background) }, // Same as bg, border shows selection
        uBorderColor: { value: new THREE.Color(...resolvedStyle.borderColor) },
        uHoveredBorderColor: { value: new THREE.Color(...resolvedStyle.borderColorHover) },
        uSelectedBorderColor: { value: new THREE.Color(...resolvedStyle.selectedBorderColor) },
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
        attribute float aSelected;
        attribute float aHovered;
        attribute vec2 aSize;
        attribute vec3 aAccentColor; // Per-entity accent color override (-1 = use global)
        attribute float aStatus; // 0=none, 1=error, 2=warning, 3=running, 4=success

        uniform float uShadowBlur;
        uniform float uShadowOffsetY;

        varying vec2 vUv;
        varying float vSelected;
        varying float vHovered;
        varying vec2 vSize;
        varying vec2 vExpandedSize;
        varying vec3 vAccentColor;
        varying float vStatus;

        void main() {
          vUv = uv;
          vSelected = aSelected;
          vHovered = aHovered;
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
        uniform vec3 uHoveredColor;
        uniform vec3 uSelectedColor;
        uniform vec3 uBorderColor;
        uniform vec3 uHoveredBorderColor;
        uniform vec3 uSelectedBorderColor;
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
        varying float vSelected;
        varying float vHovered;
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

          // Background: selected > hovered > default
          vec3 bgColor = mix(
            mix(uBackgroundColor, uHoveredColor, vHovered),
            uSelectedColor,
            vSelected
          );

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

          // Resolve selected border color: per-entity override if r >= 0, else global uniform
          vec3 resolvedSelectedBorderColor = vAccentColor.r < 0.0 ? uSelectedBorderColor : vAccentColor;

          // Border: selected > hovered > default
          vec3 borderColor = mix(
            mix(uBorderColor, uHoveredBorderColor, vHovered),
            resolvedSelectedBorderColor,
            vSelected
          );

          // Status border override (takes priority over selection/hover)
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

  // Buffers created with current capacity - recreated when capacity changes
  const buffers = useMemo(() => ({
    selected: new Float32Array(capacity),
    hovered: new Float32Array(capacity),
    sizes: new Float32Array(capacity * 2),
    accentColor: new Float32Array(capacity * 3), // Per-entity accent color (RGB)
    status: new Float32Array(capacity), // Per-entity status (0=none, 1=error, 2=warning, 3=running, 4=success)
    selectedAttr: null as THREE.InstancedBufferAttribute | null,
    hoveredAttr: null as THREE.InstancedBufferAttribute | null,
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
    accentColorAttr: null as THREE.InstancedBufferAttribute | null,
    statusAttr: null as THREE.InstancedBufferAttribute | null,
  }), [capacity]);

  // Reset initialized flag when buffers change (mesh will be recreated due to key change)
  // This prevents useFrame from running before attributes are set up
  useEffect(() => {
    initializedRef.current = false;
  }, [buffers]);

  // Initialize attributes when mesh is ready or capacity changes
  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    // Create attributes with DynamicDrawUsage for frequent updates
    buffers.selectedAttr = new THREE.InstancedBufferAttribute(buffers.selected, 1);
    buffers.selectedAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.hoveredAttr = new THREE.InstancedBufferAttribute(buffers.hovered, 1);
    buffers.hoveredAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.sizeAttr = new THREE.InstancedBufferAttribute(buffers.sizes, 2);
    buffers.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.accentColorAttr = new THREE.InstancedBufferAttribute(buffers.accentColor, 3);
    buffers.accentColorAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.statusAttr = new THREE.InstancedBufferAttribute(buffers.status, 1);
    buffers.statusAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aSelected', buffers.selectedAttr);
    mesh.geometry.setAttribute('aHovered', buffers.hoveredAttr);
    mesh.geometry.setAttribute('aSize', buffers.sizeAttr);
    mesh.geometry.setAttribute('aAccentColor', buffers.accentColorAttr);
    mesh.geometry.setAttribute('aStatus', buffers.statusAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    initializedRef.current = true;
    dirtyRef.current = true;
  }, [buffers]);

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
    const unsubHovered = store.subscribe(
      (state) => state.hoveredEntityId,
      () => { dirtyRef.current = true; }
    );
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => { dirtyRef.current = true; }
    );
    // Subscribe to hidden entity changes (Phase 7C) - O(1) lookup in hot path
    const unsubHidden = store.subscribe(
      (state) => state.hiddenEntityIds,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubEntities();
      unsubViewport();
      unsubHovered();
      unsubSelection();
      unsubHidden();
    };
  }, [store, capacity]);

  // Track whether any entity has an animated status (running/success)
  const hasAnimatedStatusRef = useRef(false);

  // Use R3F's useFrame for RAF-synchronized updates
  useFrame(({ size, clock }) => {
    const mesh = meshRef.current;

    if (!mesh || !initializedRef.current) return;

    // Always update time uniform for animated statuses
    if (hasAnimatedStatusRef.current) {
      (material.uniforms.uTime as { value: number }).value = clock.elapsedTime;
    }

    if (!dirtyRef.current) return;

    const { entities, viewport, hoveredEntityId, selectedEntityIds, hiddenEntityIds } = store.getState();
    if (entities.length === 0) {
      mesh.count = 0;
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

    let visibleCount = 0;
    const maxVisible = capacity;

    for (let i = 0; i < entities.length && visibleCount < maxVisible; i++) {
      const entity = entities[i];

      // Skip special entity types (handled by separate renderers)
      if (entity.type === 'comment' || entity.type === 'reroute') {
        continue;
      }

      // Skip entities inside collapsed frames (Phase 7C) - O(1) lookup
      if (hiddenEntityIds.has(entity.id)) {
        continue;
      }

      const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
      // Calculate height from cached socket layout (supports variable heights)
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
      ) {
        continue; // Skip this entity - not visible
      }

      // Update matrix for visible entity
      tempMatrix.identity();
      tempMatrix.setPosition(
        entity.position.x + width / 2,
        -(entity.position.y + height / 2),
        0
      );
      mesh.setMatrixAt(visibleCount, tempMatrix);

      // Update attributes - query selection Set for O(1) lookup
      buffers.selected[visibleCount] = selectedEntityIds.has(entity.id) ? 1.0 : 0.0;
      buffers.hovered[visibleCount] = entity.id === hoveredEntityId ? 1.0 : 0.0;
      buffers.sizes[visibleCount * 2] = width;
      buffers.sizes[visibleCount * 2 + 1] = height;

      // Per-entity accent color override (or sentinel for global)
      const accentRGB = resolveAccentColorRGB(entity.color, tokens);
      buffers.accentColor[visibleCount * 3] = accentRGB[0];
      buffers.accentColor[visibleCount * 3 + 1] = accentRGB[1];
      buffers.accentColor[visibleCount * 3 + 2] = accentRGB[2];

      // Per-entity status
      buffers.status[visibleCount] = encodeStatus(entity.data?.status);

      visibleCount++;
    }

    // Update instance matrix
    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.selectedAttr && buffers.hoveredAttr && buffers.sizeAttr && buffers.accentColorAttr && buffers.statusAttr) {
      buffers.selectedAttr.needsUpdate = true;
      buffers.hoveredAttr.needsUpdate = true;
      buffers.sizeAttr.needsUpdate = true;
      buffers.accentColorAttr.needsUpdate = true;
      buffers.statusAttr.needsUpdate = true;
    }

    // Check if any visible entity has animated status
    let hasAnimated = false;
    for (let j = 0; j < visibleCount; j++) {
      const s = buffers.status[j];
      if (s > 2.5) { // running (3) or success (4)
        hasAnimated = true;
        break;
      }
    }
    hasAnimatedStatusRef.current = hasAnimated;

    // Safety: never exceed buffer capacity to prevent WebGL errors
    mesh.count = Math.min(visibleCount, capacity);
    dirtyRef.current = false;
  });

  // Key forces remount when capacity changes to get a new InstancedMesh
  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}
