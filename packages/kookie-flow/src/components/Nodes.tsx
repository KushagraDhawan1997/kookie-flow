import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStore } from './context';
import { NODE_COLORS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';
import type { Node } from '../types';

/**
 * Instanced mesh renderer for all nodes.
 * All node backgrounds are rendered in a single draw call.
 */
export function Nodes() {
  const nodes = useFlowStore((state) => state.nodes);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Create geometry for rounded rectangle
  const geometry = useMemo(() => {
    // Simple rectangle for now, rounded corners would need custom geometry or SDF
    return new THREE.PlaneGeometry(1, 1);
  }, []);

  // Create material
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

          // Scale by instance size
          vec3 pos = position;
          pos.x *= aSize.x;
          pos.y *= aSize.y;

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
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

          // Background
          vec3 bgColor = mix(uBackgroundColor, uSelectedColor, vSelected);
          vec3 borderColor = mix(uBorderColor, uSelectedBorderColor, vSelected);

          // Anti-aliased edges
          float aa = fwidth(d);
          float alpha = 1.0 - smoothstep(-aa, aa, d);

          // Border
          float borderAlpha = 1.0 - smoothstep(-aa, aa, d + uBorderWidth);
          vec3 color = mix(bgColor, borderColor, smoothstep(-aa, aa, d + uBorderWidth) - smoothstep(-aa, aa, d));

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
  }, []);

  // Update instance matrices when nodes change
  useEffect(() => {
    if (!meshRef.current || nodes.length === 0) return;

    const mesh = meshRef.current;
    const matrix = new THREE.Matrix4();
    const selectedAttr = new Float32Array(nodes.length);
    const sizeAttr = new Float32Array(nodes.length * 2);

    nodes.forEach((node, i) => {
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;

      // Position at center of node
      matrix.setPosition(
        node.position.x + width / 2,
        -(node.position.y + height / 2), // Flip Y for screen coordinates
        0
      );

      mesh.setMatrixAt(i, matrix);
      selectedAttr[i] = node.selected ? 1.0 : 0.0;
      sizeAttr[i * 2] = width;
      sizeAttr[i * 2 + 1] = height;
    });

    // Update instance attributes
    mesh.geometry.setAttribute(
      'aSelected',
      new THREE.InstancedBufferAttribute(selectedAttr, 1)
    );
    mesh.geometry.setAttribute(
      'aSize',
      new THREE.InstancedBufferAttribute(sizeAttr, 2)
    );

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = nodes.length;
  }, [nodes]);

  if (nodes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(nodes.length, 100)]}
      frustumCulled={false}
    />
  );
}
