import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Selection box rendered during box selection.
 * Uses a shader for dashed border effect.
 */
export function SelectionBox() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.Mesh>(null);
  const dirtyRef = useRef(true);

  // Derive accent color from theme tokens
  const accentColor = tokens['--accent-9'];

  // Simple plane geometry
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Shader material with dashed border
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uFillColor: { value: new THREE.Color(accentColor[0], accentColor[1], accentColor[2]) },
        uBorderColor: { value: new THREE.Color(accentColor[0], accentColor[1], accentColor[2]) },
        uSize: { value: new THREE.Vector2(1, 1) },
        uZoom: { value: 1.0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vSize;
        uniform vec2 uSize;

        void main() {
          vUv = uv;
          vSize = uSize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform vec3 uFillColor;
        uniform vec3 uBorderColor;
        uniform vec2 uSize;
        uniform float uZoom;
        uniform float uTime;

        varying vec2 vUv;
        varying vec2 vSize;

        void main() {
          vec2 pixelPos = vUv * vSize;

          // Border width and dash size in screen pixels (zoom-independent)
          float borderWidth = 1.5 / uZoom;
          float dashSize = 6.0 / uZoom;

          // Distance from edge
          float distFromLeft = pixelPos.x;
          float distFromRight = vSize.x - pixelPos.x;
          float distFromTop = pixelPos.y;
          float distFromBottom = vSize.y - pixelPos.y;

          float minDist = min(min(distFromLeft, distFromRight), min(distFromTop, distFromBottom));

          // Check if we're in the border region
          bool inBorder = minDist < borderWidth;

          // Dashed pattern - use position along the perimeter
          float perimeterPos = 0.0;
          if (distFromTop < borderWidth) {
            perimeterPos = pixelPos.x;
          } else if (distFromRight < borderWidth) {
            perimeterPos = vSize.x + pixelPos.y;
          } else if (distFromBottom < borderWidth) {
            perimeterPos = vSize.x + vSize.y + (vSize.x - pixelPos.x);
          } else if (distFromLeft < borderWidth) {
            perimeterPos = 2.0 * vSize.x + vSize.y + (vSize.y - pixelPos.y);
          }

          // Animated dash pattern (screen-space consistent)
          float dashPhase = mod(perimeterPos * uZoom + uTime * 30.0, dashSize * uZoom * 2.0);
          bool inDash = dashPhase < dashSize * uZoom;

          if (inBorder && inDash) {
            gl_FragColor = vec4(uBorderColor, 1.0);
          } else {
            // Semi-transparent fill
            gl_FragColor = vec4(uFillColor, 0.1);
          }
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [accentColor]);

  // Subscribe to selection box and viewport changes
  useEffect(() => {
    const unsubBox = store.subscribe(
      (state) => state.selectionBox,
      () => { dirtyRef.current = true; }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
    return () => {
      unsubBox();
      unsubViewport();
    };
  }, [store]);

  // Update mesh each frame
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { selectionBox, viewport } = store.getState();

    if (!selectionBox) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;

    const { start, end } = selectionBox;

    // Calculate box dimensions
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;

    // Update mesh transform
    mesh.position.set(centerX, -centerY, 1); // Z=1 to be above nodes
    mesh.scale.set(width, height, 1);

    // Update shader uniforms
    (material.uniforms.uSize.value as THREE.Vector2).set(width, height);
    material.uniforms.uZoom.value = viewport.zoom;
    material.uniforms.uTime.value = clock.elapsedTime;

    dirtyRef.current = false;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} visible={false} />
  );
}
