import { useMemo, useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { DEFAULT_GRID_SIZE } from '../core/constants';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';

export interface GridProps {
  size?: number;
  color?: string;
  /** @deprecated The grid is a dot lattice with no accent lines; the value is accepted and ignored. */
  colorAccent?: string;
}

/**
 * The lattice's alpha per appearance, applied at material build.
 *
 * `--neutral-7` is one token in both themes; what differs is how much of it a dot needs to be
 * seen against its canvas. Light needs less: the canvas is a step below white and the dot is dark
 * on it, where in dark the dot is a mid grey on near-black and wants a touch more.
 */
/** The zoom below which the lattice is fully faded and the quad is not drawn at all. */
const GRID_FADE_START = 0.45;
const GRID_DOT_ALPHA = { dark: 0.18, light: 0.14 } as const;

/**
 * Infinite dot lattice rendered via shader on one full-screen quad.
 * Key optimizations:
 * - Dirty flag to skip updates when viewport unchanged
 * - Fades out below zoom 0.9 so a dense lattice never moirés; the quad discards instead of blending
 * - Reuses geometry and material
 */
export function Grid({
  size = DEFAULT_GRID_SIZE,
  color,
}: GridProps) {
  const { camera } = useThree();
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.Mesh>(null);
  const dirtyRef = useRef(true);
  /**
   * The last frustum the quad was fitted to, plus the zoom the fade was written at.
   *
   * This used to record the store's viewport, and that was the wrong thing to watch: the quad has
   * to cover what the CAMERA sees, and the camera's frustum moves without the viewport moving —
   * on the frame the canvas first gets a size, and on every resize after. A quad fitted while the
   * canvas measured 0×0 was scaled to zero and stayed there until the user panned, which is why
   * the harness had never once painted a grid at rest.
   */
  const lastRef = useRef({ left: 0, right: 0, top: 0, bottom: 0, zoom: 0 });

  // Use semantic theme colors
  const gridColor = color ?? rgbToHex(tokens[THEME_COLORS.grid.lines]);
  const gridAlpha = GRID_DOT_ALPHA[tokens.appearance];

  const gridMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uGridSize: { value: size },
        uColor: { value: new THREE.Color(gridColor) },
        uAlpha: { value: gridAlpha },
        uZoom: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xy;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      // highp on purpose: mediump `fract` on large world coordinates is visibly wrong far from the
      // origin — the lattice drifts and doubles a few thousand px out.
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform float uGridSize;
        uniform float uZoom;
        uniform float uAlpha;
        uniform vec3 uColor;

        varying vec2 vWorldPos;

        void main() {
          vec2 coord = vec2(vWorldPos.x, -vWorldPos.y);

          // Offset from the nearest lattice point, in world units. The +0.5 puts the points on
          // integer multiples of the cell — where snapping lands a node — not on half-cells.
          vec2  g  = (fract(coord / uGridSize + 0.5) - 0.5) * uGridSize;
          // One screen px in world units, so the dot stays ~1.2 screen px at every zoom.
          float px = fwidth(coord.x);
          float dot = 1.0 - smoothstep(0.6 * px, 1.6 * px, length(g));

          // Gone below zoom 0.45, full from 0.9: a lattice denser than a few px moirés.
          float alpha = dot * uAlpha * smoothstep(${GRID_FADE_START.toFixed(2)}, 0.9, uZoom);
          if (alpha < 0.01) discard;

          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [size, gridColor, gridAlpha]);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { gridMaterial.dispose(); }, [gridMaterial]);

  // A rebuilt material (theme flip) starts with uZoom at 1; the frame loop only writes it in
  // its dirty branch, so mark it — otherwise a lattice faded out at zoom 0.4 came back at full
  // strength on the flip and stayed until the next pan.
  useEffect(() => { dirtyRef.current = true; }, [gridMaterial]);

  // Subscribe to viewport changes
  useEffect(() => {
    return store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
  }, [store]);

  // Update grid position/scale in useFrame
  useFrame(() => {
    if (!meshRef.current || !(camera instanceof THREE.OrthographicCamera)) return;

    const { zoom } = store.getState().viewport;
    const last = lastRef.current;

    // Skip if neither the frustum nor the zoom moved. CameraController's frame callback runs
    // before this one (it is mounted first), so the frustum read here is this frame's.
    if (
      !dirtyRef.current &&
      camera.left === last.left &&
      camera.right === last.right &&
      camera.top === last.top &&
      camera.bottom === last.bottom &&
      zoom === last.zoom
    ) {
      return;
    }

    dirtyRef.current = false;
    // Mutated, not replaced: this ref is a private record of the last-seen values, never handed to
    // anyone, so a fresh object per frame buys nothing and allocates in the frame loop.
    last.left = camera.left;
    last.right = camera.right;
    last.top = camera.top;
    last.bottom = camera.bottom;
    last.zoom = zoom;
    // The fade is a uniform, not a re-render: written here, in the branch that already runs only
    // when something moved.
    gridMaterial.uniforms.uZoom.value = zoom;
    // Below the fade every fragment discards; the full-screen quad is not worth submitting.
    meshRef.current.visible = zoom >= GRID_FADE_START;

    // Position grid at the center of what the camera sees
    const centerX = (camera.left + camera.right) / 2;
    const centerY = (camera.top + camera.bottom) / 2;
    const viewWidth = Math.abs(camera.right - camera.left);
    const viewHeight = Math.abs(camera.top - camera.bottom);

    // Make grid larger than view to prevent edges showing during pan
    meshRef.current.position.set(centerX, centerY, -1);
    meshRef.current.scale.set(viewWidth * 3, viewHeight * 3, 1);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
}
