import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { calculateMinNodeHeight } from '../utils/style-resolver';
import { DEFAULT_NODE_WIDTH } from '../core/constants';

// Pre-allocated objects to avoid GC
const tempMatrix = new THREE.Matrix4();

// Buffer growth factor
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 256;

/**
 * High-performance instanced mesh renderer for nodes.
 * Key optimizations:
 * - Pre-allocated, reusable buffers (no GC pressure)
 * - Direct GPU buffer updates (bypasses React)
 * - Viewport frustum culling
 * - Dirty flag to skip unnecessary updates
 */
export function Nodes() {
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const resolvedStyle = useResolvedStyle();
  const socketLayout = useSocketLayout();

  // Get initial node count for capacity
  const [capacity, setCapacity] = useState(() => {
    const initialNodes = store.getState().nodes;
    return Math.max(MIN_CAPACITY, Math.ceil(initialNodes.length * BUFFER_GROWTH_FACTOR));
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
      },
      vertexShader: /* glsl */ `
        attribute float aSelected;
        attribute float aHovered;
        attribute vec2 aSize;

        varying vec2 vUv;
        varying float vSelected;
        varying float vHovered;
        varying vec2 vSize;

        void main() {
          vUv = uv;
          vSelected = aSelected;
          vHovered = aHovered;
          vSize = aSize;

          vec3 pos = position;
          pos.x *= aSize.x;
          pos.y *= aSize.y;

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

        varying vec2 vUv;
        varying float vSelected;
        varying float vHovered;
        varying vec2 vSize;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

        void main() {
          vec2 p = (vUv - 0.5) * vSize;
          vec2 b = vSize * 0.5;

          float d = roundedBoxSDF(p, b, uCornerRadius);

          // Early discard for pixels outside the rounded rect (with border)
          if (d > uBorderWidth + 1.0) discard;

          // Background: selected > hovered > default
          vec3 bgColor = mix(
            mix(uBackgroundColor, uHoveredColor, vHovered),
            uSelectedColor,
            vSelected
          );

          // Header region check (top of node) - only for "inside" mode (1.0)
          // "outside" mode (2.0) has no colored header - just floating text above
          if (uHeaderPosition > 0.5 && uHeaderPosition < 1.5) {
            float halfHeight = b.y;
            float headerBottom = halfHeight - uHeaderHeight;
            // Smoothstep for anti-aliased edge between header and body
            float headerMask = smoothstep(headerBottom - 0.5, headerBottom + 0.5, p.y);
            bgColor = mix(bgColor, uHeaderColor, headerMask);
          }

          // Border: selected > hovered > default
          vec3 borderColor = mix(
            mix(uBorderColor, uHoveredBorderColor, vHovered),
            uSelectedBorderColor,
            vSelected
          );

          // Simplified AA - single fwidth call
          float aa = fwidth(d) * 1.5;

          // Border calculation
          float borderD = d + uBorderWidth;
          float borderMask = smoothstep(-aa, aa, borderD) - smoothstep(-aa, aa, d);

          // Background fill (respects backgroundAlpha for ghost/outline variants)
          float fillMask = 1.0 - smoothstep(-aa, aa, d);
          float bgAlpha = fillMask * uBackgroundAlpha;

          // Composite: border on top of background
          vec3 color = mix(bgColor, borderColor, borderMask);
          float alpha = max(bgAlpha, borderMask * fillMask);

          // For transparent backgrounds, only show border
          if (uBackgroundAlpha < 0.01) {
            color = borderColor;
            alpha = borderMask * fillMask;
          }

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
    selectedAttr: null as THREE.InstancedBufferAttribute | null,
    hoveredAttr: null as THREE.InstancedBufferAttribute | null,
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
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

    mesh.geometry.setAttribute('aSelected', buffers.selectedAttr);
    mesh.geometry.setAttribute('aHovered', buffers.hoveredAttr);
    mesh.geometry.setAttribute('aSize', buffers.sizeAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    initializedRef.current = true;
    dirtyRef.current = true;
  }, [buffers]);

  // Subscribe to store changes
  useEffect(() => {
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (nodes) => {
        dirtyRef.current = true;
        // Check if we need more capacity
        if (nodes.length > capacity) {
          setCapacity(Math.ceil(nodes.length * BUFFER_GROWTH_FACTOR));
        }
      }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
    const unsubHovered = store.subscribe(
      (state) => state.hoveredNodeId,
      () => { dirtyRef.current = true; }
    );
    const unsubSelection = store.subscribe(
      (state) => state.selectedNodeIds,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubNodes();
      unsubViewport();
      unsubHovered();
      unsubSelection();
    };
  }, [store, capacity]);

  // Use R3F's useFrame for RAF-synchronized updates
  useFrame(({ size }) => {
    const mesh = meshRef.current;

    if (!mesh || !initializedRef.current || !dirtyRef.current) return;

    const { nodes, viewport, hoveredNodeId, selectedNodeIds } = store.getState();
    if (nodes.length === 0) {
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

    // Padding for nodes partially in view
    const cullPadding = 300;

    let visibleCount = 0;
    const maxVisible = capacity;

    for (let i = 0; i < nodes.length && visibleCount < maxVisible; i++) {
      const node = nodes[i];
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      // Calculate height based on socket count if not explicitly set
      const outputCount = node.outputs?.length ?? 0;
      const inputCount = node.inputs?.length ?? 0;
      const height = node.height ?? calculateMinNodeHeight(outputCount, inputCount, socketLayout);

      // Frustum culling - skip nodes outside viewport
      const nodeRight = node.position.x + width;
      const nodeBottom = node.position.y + height;

      if (
        nodeRight < viewLeft - cullPadding ||
        node.position.x > viewRight + cullPadding ||
        nodeBottom < viewTop - cullPadding ||
        node.position.y > viewBottom + cullPadding
      ) {
        continue; // Skip this node - not visible
      }

      // Update matrix for visible node
      tempMatrix.identity();
      tempMatrix.setPosition(
        node.position.x + width / 2,
        -(node.position.y + height / 2),
        0
      );
      mesh.setMatrixAt(visibleCount, tempMatrix);

      // Update attributes - query selection Set for O(1) lookup
      buffers.selected[visibleCount] = selectedNodeIds.has(node.id) ? 1.0 : 0.0;
      buffers.hovered[visibleCount] = node.id === hoveredNodeId ? 1.0 : 0.0;
      buffers.sizes[visibleCount * 2] = width;
      buffers.sizes[visibleCount * 2 + 1] = height;

      visibleCount++;
    }

    // Update instance matrix
    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.selectedAttr && buffers.hoveredAttr && buffers.sizeAttr) {
      buffers.selectedAttr.needsUpdate = true;
      buffers.hoveredAttr.needsUpdate = true;
      buffers.sizeAttr.needsUpdate = true;
    }

    mesh.count = visibleCount;
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
