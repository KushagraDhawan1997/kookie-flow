import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { NODE_COLORS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';

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

  // Create optimized material with simpler shader
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBackgroundColor: { value: new THREE.Color(NODE_COLORS.background) },
        uSelectedColor: { value: new THREE.Color(NODE_COLORS.backgroundSelected) },
        uBorderColor: { value: new THREE.Color(NODE_COLORS.border) },
        uSelectedBorderColor: { value: new THREE.Color(NODE_COLORS.borderSelected) },
        uCornerRadius: { value: 8.0 },
        uBorderWidth: { value: 2.0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSelected;
        attribute vec2 aSize;

        varying vec2 vUv;
        varying float vSelected;
        varying vec2 vSize;

        void main() {
          vUv = uv;
          vSelected = aSelected;
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
        uniform vec3 uSelectedColor;
        uniform vec3 uBorderColor;
        uniform vec3 uSelectedBorderColor;
        uniform float uCornerRadius;
        uniform float uBorderWidth;

        varying vec2 vUv;
        varying float vSelected;
        varying vec2 vSize;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

        void main() {
          vec2 p = (vUv - 0.5) * vSize;
          vec2 b = vSize * 0.5;

          float d = roundedBoxSDF(p, b, uCornerRadius);

          // Early discard for pixels outside the rounded rect
          if (d > 1.0) discard;

          vec3 bgColor = mix(uBackgroundColor, uSelectedColor, vSelected);
          vec3 borderColor = mix(uBorderColor, uSelectedBorderColor, vSelected);

          // Simplified AA - single fwidth call
          float aa = fwidth(d) * 1.5;
          float alpha = 1.0 - smoothstep(-aa, aa, d);

          // Border calculation
          float borderD = d + uBorderWidth;
          float borderMask = smoothstep(-aa, aa, borderD) - smoothstep(-aa, aa, d);
          vec3 color = mix(bgColor, borderColor, borderMask);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, []);

  // Buffers created with current capacity - recreated when capacity changes
  const buffers = useMemo(() => ({
    selected: new Float32Array(capacity),
    sizes: new Float32Array(capacity * 2),
    selectedAttr: null as THREE.InstancedBufferAttribute | null,
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
  }), [capacity]);

  // Initialize attributes when mesh is ready or capacity changes
  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    // Create attributes with DynamicDrawUsage for frequent updates
    buffers.selectedAttr = new THREE.InstancedBufferAttribute(buffers.selected, 1);
    buffers.selectedAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.sizeAttr = new THREE.InstancedBufferAttribute(buffers.sizes, 2);
    buffers.sizeAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aSelected', buffers.selectedAttr);
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

    return () => {
      unsubNodes();
      unsubViewport();
    };
  }, [store, capacity]);

  // Use R3F's useFrame for RAF-synchronized updates
  useFrame(({ size }) => {
    const mesh = meshRef.current;

    if (!mesh || !initializedRef.current || !dirtyRef.current) return;

    const { nodes, viewport } = store.getState();
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
      const height = node.height ?? DEFAULT_NODE_HEIGHT;

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

      // Update attributes
      buffers.selected[visibleCount] = node.selected ? 1.0 : 0.0;
      buffers.sizes[visibleCount * 2] = width;
      buffers.sizes[visibleCount * 2 + 1] = height;

      visibleCount++;
    }

    // Update instance matrix
    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.selectedAttr && buffers.sizeAttr) {
      buffers.selectedAttr.needsUpdate = true;
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
