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
import { THEME_COLORS, resolveColor } from '../core/theme-colors';

const tempMatrix = new THREE.Matrix4();
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 64;

/**
 * Reroute entity visual settings. The quad is a 6px circle and the dot inside it is built the way
 * a socket is: a 3.5px dot, a 1.5px punch ring of canvas colour so it reads over the edge under
 * it, and a 1px halo that lights on hover. No cross, no hover scale — motion in geometry reads as
 * jitter; a halo reads as light.
 */
const REROUTE_RADIUS = 6; // Radius in world space
const REROUTE_SEGMENTS = 12; // Circle segments

export function RerouteNodes() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Pre-filtered reroute entity IDs — only recomputed on topology changes, not every frame
  const [rerouteEntityIds, setRerouteEntityIds] = useState<string[]>(() => {
    return store.getState().entities
      .filter((e) => e.type === 'reroute')
      .map((e) => e.id);
  });
  const rerouteEntityIdsRef = useRef(rerouteEntityIds);
  rerouteEntityIdsRef.current = rerouteEntityIds;

  // Derive colors from theme
  const rerouteColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.default];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);

  const selectedColor = useMemo(() => {
    const c = tokens[THEME_COLORS.edge.selected];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);

  // The punch ring prints canvas colour, so it has to be the canvas the DOM paints (a pair token).
  const canvasColor = useMemo(() => {
    const c = resolveColor(THEME_COLORS.canvas.background, tokens);
    return new THREE.Color(c[0], c[1], c[2]);
  }, [tokens]);

  // Track canvas size for resize detection
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // Mark dirty when theme colors change
  useEffect(() => {
    dirtyRef.current = true;
  }, [rerouteColor, selectedColor, canvasColor]);

  // Circle geometry
  const geometry = useMemo(() => new THREE.CircleGeometry(REROUTE_RADIUS, REROUTE_SEGMENTS), []);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  // Shader material for reroute rendering
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: rerouteColor },
          uSelectedColor: { value: selectedColor },
          uCanvas: { value: canvasColor },
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
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform vec3 uColor;
          uniform vec3 uSelectedColor;
          uniform vec3 uCanvas;

          varying float vSelected;
          varying float vHovered;
          varying vec2 vUv;

          void main() {
            // px from the centre; the quad radius is 6
            float r  = length(vUv - 0.5) * 12.0;
            float aa = fwidth(r);
            float dot   = 1.0 - smoothstep(3.5 - aa, 3.5 + aa, r);
            float punch = smoothstep(3.5 - aa, 3.5 + aa, r) * (1.0 - smoothstep(5.0 - aa, 5.0 + aa, r));
            float halo  = smoothstep(5.0 - aa, 5.0 + aa, r) * (1.0 - smoothstep(5.0, 6.0, r));
            halo *= halo;
            // Steady on a selected reroute, lit on hover.
            float haloOn = max(vHovered, vSelected) * 0.22;

            vec3  c = mix(uColor, uSelectedColor, vSelected);
            float a = dot + punch + halo * haloOn;
            // Three bands that never overlap, blended as one premultiplied colour and un-premultiplied.
            vec3  col = (c * dot + uCanvas * punch + c * halo * haloOn) / max(a, 1e-4);
            if (a < 0.004) discard;
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [rerouteColor, selectedColor, canvasColor]
  );

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { material.dispose(); }, [material]);

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
    const markDirty = () => { dirtyRef.current = true; };

    const unsubTopology = store.subscribe(
      (state) => state.topologyVersion,
      () => {
        markDirty();
        const { entities } = store.getState();
        const ids = entities.filter((e) => e.type === 'reroute').map((e) => e.id);
        setRerouteEntityIds((prev) => {
          if (prev.length !== ids.length) return ids;
          for (let i = 0; i < ids.length; i++) {
            if (prev[i] !== ids[i]) return ids;
          }
          return prev;
        });
        if (ids.length > capacity) {
          setCapacity(Math.ceil(ids.length * BUFFER_GROWTH_FACTOR));
        }
      }
    );
    const unsubPositions = store.subscribe((state) => state.positionVersion, markDirty);
    const unsubViewport = store.subscribe((state) => state.viewport, markDirty);
    const unsubHovered = store.subscribe((state) => state.hoveredEntityId, markDirty);
    const unsubSelection = store.subscribe((state) => state.selectedEntityIds, markDirty);
    const unsubHidden = store.subscribe((state) => state.hiddenEntityIds, markDirty);

    return () => {
      unsubTopology();
      unsubPositions();
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

    const { entityMap, viewport, hoveredEntityId, selectedEntityIds, hiddenEntityIds } = store.getState();

    // Mark dirty on canvas resize
    if (size.width !== lastSizeRef.current.width || size.height !== lastSizeRef.current.height) {
      lastSizeRef.current.width = size.width;
      lastSizeRef.current.height = size.height;
    }

    const ids = rerouteEntityIdsRef.current;

    if (ids.length === 0) {
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

    for (let i = 0; i < ids.length && visibleCount < maxVisible; i++) {
      const entity = entityMap.get(ids[i]);
      if (!entity) continue;

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

    // Update GPU buffers, over the instances this pass wrote. The arrays are capacity-sized and
    // a bare `needsUpdate` uploads all of it; only `[0, visibleCount)` is drawn.
    if (visibleCount > 0) {
      mesh.instanceMatrix.addUpdateRange(0, visibleCount * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (buffers.selectedAttr && buffers.hoveredAttr) {
        buffers.selectedAttr.addUpdateRange(0, visibleCount);
        buffers.selectedAttr.needsUpdate = true;
        buffers.hoveredAttr.addUpdateRange(0, visibleCount);
        buffers.hoveredAttr.needsUpdate = true;
      }
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
