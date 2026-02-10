/**
 * RerouteNodes - Renders reroute/waypoint entities as small circles.
 * Phase 7C: Grouping & Annotations
 *
 * Reroute entities are edge waypoints that allow users to create custom edge paths.
 * They render as small circles (similar to sockets) and can be dragged.
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';

const tempMatrix = new THREE.Matrix4();
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 64;

/** Reroute entity visual settings */
const REROUTE_RADIUS = 6; // Radius in world space
const REROUTE_SEGMENTS = 12; // Circle segments

export function RerouteNodes() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Derive colors from theme
  const rerouteColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.default];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);

  const selectedColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.selected];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);

  // Track canvas size for resize detection
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // Mark dirty when theme colors change
  useEffect(() => {
    dirtyRef.current = true;
  }, [rerouteColor, selectedColor]);

  // Circle geometry
  const geometry = useMemo(() => new THREE.CircleGeometry(REROUTE_RADIUS, REROUTE_SEGMENTS), []);

  // Shader material for reroute rendering
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: rerouteColor },
          uSelectedColor: { value: selectedColor },
        },
        vertexShader: /* glsl */ `
          attribute float aSelected;
          attribute float aHovered;

          varying float vSelected;
          varying float vHovered;
          varying vec2 vUv;

          void main() {
            vSelected = aSelected;
            vHovered = aHovered;
            vUv = uv;

            // Scale up when hovered
            vec3 pos = position * (1.0 + aHovered * 0.3);

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform vec3 uColor;
          uniform vec3 uSelectedColor;

          varying float vSelected;
          varying float vHovered;
          varying vec2 vUv;

          void main() {
            // Distance from center for SDF circle
            vec2 center = vec2(0.5, 0.5);
            float dist = length(vUv - center) * 2.0;

            // Anti-aliased circle
            float aa = fwidth(dist) * 1.5;
            float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, dist);

            // Color: selected or default
            vec3 color = mix(uColor, uSelectedColor, vSelected);

            // Brighten on hover
            color = mix(color, color * 1.4, vHovered);

            // Small cross in center to distinguish from sockets
            vec2 p = (vUv - center) * 2.0;
            float crossWidth = 0.15;
            float crossMask = 0.0;
            if (abs(p.x) < crossWidth || abs(p.y) < crossWidth) {
              if (abs(p.x) < 0.5 && abs(p.y) < 0.5) {
                crossMask = 0.3;
              }
            }

            // Darken center cross area
            color = mix(color, color * 0.5, crossMask);

            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [rerouteColor, selectedColor]
  );

  // Pre-allocated buffers
  const buffers = useMemo(
    () => ({
      selected: new Float32Array(capacity),
      hovered: new Float32Array(capacity),
      selectedAttr: null as THREE.InstancedBufferAttribute | null,
      hoveredAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

  // Reset initialized flag when buffers change
  useEffect(() => {
    initializedRef.current = false;
  }, [buffers]);

  // Initialize attributes when mesh is ready
  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    buffers.selectedAttr = new THREE.InstancedBufferAttribute(buffers.selected, 1);
    buffers.selectedAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.hoveredAttr = new THREE.InstancedBufferAttribute(buffers.hovered, 1);
    buffers.hoveredAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aSelected', buffers.selectedAttr);
    mesh.geometry.setAttribute('aHovered', buffers.hoveredAttr);
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
        // Check if we need more capacity for reroute entities
        const rerouteCount = entities.filter((n) => n.type === 'reroute').length;
        if (rerouteCount > capacity) {
          setCapacity(Math.ceil(rerouteCount * BUFFER_GROWTH_FACTOR));
        }
      }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubHovered = store.subscribe(
      (state) => state.hoveredEntityId,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => {
        dirtyRef.current = true;
      }
    );
    const unsubHidden = store.subscribe(
      (state) => state.hiddenEntityIds,
      () => {
        dirtyRef.current = true;
      }
    );

    return () => {
      unsubEntities();
      unsubViewport();
      unsubHovered();
      unsubSelection();
      unsubHidden();
    };
  }, [store, capacity]);

  // RAF-synchronized updates
  useFrame(({ size }) => {
    const mesh = meshRef.current;

    if (!mesh || !initializedRef.current || !dirtyRef.current) return;

    const { entities, viewport, hoveredEntityId, selectedEntityIds, hiddenEntityIds } = store.getState();

    // Mark dirty on canvas resize
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
    }

    // Filter to reroute entities only
    const rerouteEntities = entities.filter((n) => n.type === 'reroute');

    if (rerouteEntities.length === 0) {
      mesh.count = 0;
      dirtyRef.current = false;
      return;
    }

    // Viewport bounds for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 50;

    let visibleCount = 0;
    const maxVisible = capacity;

    for (let i = 0; i < rerouteEntities.length && visibleCount < maxVisible; i++) {
      const entity = rerouteEntities[i];

      // Skip if inside collapsed frame - O(1) lookup
      if (hiddenEntityIds.has(entity.id)) {
        continue;
      }

      const x = entity.position.x;
      const y = entity.position.y;

      // Frustum culling
      if (
        x < viewLeft - cullPadding ||
        x > viewRight + cullPadding ||
        y < viewTop - cullPadding ||
        y > viewBottom + cullPadding
      ) {
        continue;
      }

      // Update matrix - position at entity center
      tempMatrix.identity();
      tempMatrix.setPosition(x, -y, 2); // Z=2 to render above edges
      mesh.setMatrixAt(visibleCount, tempMatrix);

      // Update attributes
      buffers.selected[visibleCount] = selectedEntityIds.has(entity.id) ? 1.0 : 0.0;
      buffers.hovered[visibleCount] = entity.id === hoveredEntityId ? 1.0 : 0.0;

      visibleCount++;
    }

    // Update GPU buffers
    mesh.instanceMatrix.needsUpdate = true;
    if (buffers.selectedAttr && buffers.hoveredAttr) {
      buffers.selectedAttr.needsUpdate = true;
      buffers.hoveredAttr.needsUpdate = true;
    }

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
