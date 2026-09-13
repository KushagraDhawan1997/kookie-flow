import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { useTheme } from '../contexts/ThemeContext';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { squircleBoxSDF, CORNER_K } from '../utils/corner-shader';
import { MATERIAL } from '../gl';
import { resolveAccentColorRGB, NO_OVERRIDE_SENTINEL } from '../utils/accent-colors';
import { DEFAULT_ENTITY_WIDTH } from '../core/constants';
import type { AccentColor, EntityStatus } from '../types';
import type { RGBColor } from '../utils/color';
import { isSelfDrawn } from '../utils/entity-kind';
import { THEME_COLORS } from '../core/theme-colors';
import { SUCCESS_HOLD_MS } from '../core/evaluation';
import { entityDepth } from '../utils/entity-depth';
import { easeProgress, progressEaseAlpha } from '../utils/progress-ease';

// Status enum encoding for GPU (matches aStatus attribute)
const STATUS_NONE = 0;
const STATUS_ERROR = 1;
const STATUS_WARNING = 2;
const STATUS_RUNNING = 3;
const STATUS_SUCCESS = 4;
const STATUS_DIRTY = 5;

function encodeStatus(status: EntityStatus | undefined): number {
  switch (status) {
    case 'error': return STATUS_ERROR;
    case 'warning': return STATUS_WARNING;
    case 'running': return STATUS_RUNNING;
    case 'success': return STATUS_SUCCESS;
    case 'dirty': return STATUS_DIRTY;
    default: return STATUS_NONE;
  }
}

// Pre-allocated objects to avoid GC
const tempMatrix = new THREE.Matrix4();

/** What uHeaderColor carries when there is no global accent band: the shader reads r < 0 as none. */
const NO_ACCENT_BAND: readonly [number, number, number] = [-1, -1, -1];

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
  /** 0..1 while running with reported progress; -1 for no bar. */
  progress: Float32Array;
  sizeAttr: THREE.InstancedBufferAttribute | null;
  accentColorAttr: THREE.InstancedBufferAttribute | null;
  statusAttr: THREE.InstancedBufferAttribute | null;
  progressAttr: THREE.InstancedBufferAttribute | null;
}

function createBuffers(capacity: number): InstanceBuffers {
  return {
    sizes: new Float32Array(capacity * 2),
    accentColor: new Float32Array(capacity * 3),
    status: new Float32Array(capacity),
    progress: new Float32Array(capacity).fill(-1),
    sizeAttr: null,
    accentColorAttr: null,
    statusAttr: null,
    progressAttr: null,
  };
}

function initMeshBuffers(mesh: THREE.InstancedMesh, bufs: InstanceBuffers) {
  bufs.sizeAttr = new THREE.InstancedBufferAttribute(bufs.sizes, 2);
  bufs.sizeAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.accentColorAttr = new THREE.InstancedBufferAttribute(bufs.accentColor, 3);
  bufs.accentColorAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.statusAttr = new THREE.InstancedBufferAttribute(bufs.status, 1);
  bufs.statusAttr.setUsage(THREE.DynamicDrawUsage);
  bufs.progressAttr = new THREE.InstancedBufferAttribute(bufs.progress, 1);
  bufs.progressAttr.setUsage(THREE.DynamicDrawUsage);

  mesh.geometry.setAttribute('aSize', bufs.sizeAttr);
  mesh.geometry.setAttribute('aAccentColor', bufs.accentColorAttr);
  mesh.geometry.setAttribute('aStatus', bufs.statusAttr);
  mesh.geometry.setAttribute('aProgress', bufs.progressAttr);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

/**
 * Upload only the instances this frame actually wrote.
 *
 * These buffers are sized to CAPACITY, not to the live node count, and capacity is grown well
 * ahead of demand — so a bare `needsUpdate` handed three the whole array every dirty frame for
 * the handful of instances a viewport cull left visible. Measured on a pan at 5000 nodes: 1.2 MB
 * per frame, sixty times a second, to move about thirty nodes' worth of matrices. At 1000 nodes it
 * was 250 KB per frame. The figure scaled with the SIZE OF THE GRAPH rather than with what was on
 * screen, which is the signature of an upload that is not culled even though the draw is.
 *
 * Instances are written from index 0 upward for each mesh, so the written span is exactly
 * `[0, count)` and one range describes it. three merges overlapping ranges itself and clears them
 * once the upload lands, so a range left behind by a frame that never reached the GPU widens the
 * next upload rather than truncating it — the safe direction.
 *
 * A count of zero declares nothing and uploads nothing, which is what an empty graph should cost.
 */
function markBuffersForUpload(bufs: InstanceBuffers, count: number) {
  if (count <= 0) return;
  if (bufs.sizeAttr) {
    bufs.sizeAttr.addUpdateRange(0, count * 2);
    bufs.sizeAttr.needsUpdate = true;
  }
  if (bufs.accentColorAttr) {
    bufs.accentColorAttr.addUpdateRange(0, count * 3);
    bufs.accentColorAttr.needsUpdate = true;
  }
  if (bufs.statusAttr) {
    bufs.statusAttr.addUpdateRange(0, count);
    bufs.statusAttr.needsUpdate = true;
  }
  if (bufs.progressAttr) {
    bufs.progressAttr.addUpdateRange(0, count);
    bufs.progressAttr.needsUpdate = true;
  }
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

  /**
   * THE SHADOW IS A SECOND PASS, and the depth buffer is why.
   *
   * Bodies now WRITE depth so that a node in front covers everything of a node behind (see
   * utils/entity-depth.ts). The shadow used to be composited in the same fragment, outside the
   * shape — and a fragment that writes depth writes it for the whole quad it lands on. With the
   * shadow in the body pass, the soft halo around every node would have stamped the node's
   * depth into the buffer, and anything behind it in that band would have been clipped by an
   * invisible rectangle.
   *
   * So the body pass discards outside the shape and writes depth; the shadow pass draws only
   * the halo, tests depth (a node in front hides the shadow of a node behind — the shadow falls
   * ONTO whatever is behind, which is what a shadow does) and writes none. It shares the body
   * mesh's geometry and instance matrices, so it costs a draw call and no buffers.
   */
  const bgShadowRef = useRef<THREE.InstancedMesh>(null);
  const fgShadowRef = useRef<THREE.InstancedMesh>(null);

  /**
   * Free the GPU resources this component owns.
   *
   * three does not reclaim a GPU resource on garbage collection — the renderer holds it in its own
   * caches — so a memo that is rebuilt, or a mesh that unmounts, leaves the old one uploaded for
   * the life of the renderer. Every dispose effect in this package is keyed on the memoised value
   * ITSELF and nothing else: the cleanup closes over the PREVIOUS render's object, which is
   * exactly the one being replaced, while a dep that changes more often than the resource does
   * would free something the scene is still drawing. That failure is invisible by eye — three
   * re-acquires a disposed material on the next render — so it shows up only as a silent
   * per-frame recompile.
   */
  useEffect(() => () => { bgGeometry.dispose(); fgGeometry.dispose(); }, [bgGeometry, fgGeometry]);

  // Create material with resolved style (shared between both meshes)
  const material = useMemo(() => {
    /**
     * THE CARD'S FLOAT IS `--shadow-3`, and it is the token rather than an impression of it.
     *
     * This used to be a hand-rolled `NODE_SHADOW` — one layer, blur 20, offset 8 — justified by
     * the claim that the `--shadow-N` tokens "top out at blur 16". That was only ever true of
     * useThemeTokens' FALLBACK table, which invents single-layer stand-ins because "CSS shadows
     * are too complex to parse reliably". v2's real `--shadow-3` is three layers reaching 48, and
     * gl/material.ts already carries it read off v2's own stylesheet. The popover has drawn it
     * correctly all along; the node body was the one surface that never moved over.
     */
    const cast = MATERIAL[tokens.appearance].floatingCast;
    // A layer reaches `y + spread + blur` past the shape, and the quad has to hold all three.
    const castPad = cast.reduce((m, l) => Math.max(m, Math.abs(l.y) + l.spread + l.blur), 0);
    return new THREE.ShaderMaterial({
      uniforms: {
        // 1 = the body (writes depth, discards outside the shape); 0 = the shadow halo only.
        uPass: { value: 1 },
        uBackgroundColor: { value: new THREE.Color(...resolvedStyle.background) },
        uBorderColor: { value: new THREE.Color(...resolvedStyle.borderColor) },
        uCornerRadius: { value: resolvedStyle.borderRadius * CORNER_K },
        uBorderWidth: { value: resolvedStyle.borderWidth },
        uBackgroundAlpha: { value: resolvedStyle.backgroundAlpha },
        // The global accent band hue (r < 0 = none). A Vector3 rather than a Color so the
        // resolver's negative sentinel is not a colour.
        uHeaderColor: { value: new THREE.Vector3(...(resolvedStyle.accentBand ?? NO_ACCENT_BAND)) },
        // The card's float: v2's `--shadow-3`, three layers, per appearance. The colours are the
        // token's own, so the appearance pair is the material's and not a light/dark opacity.
        uCast: { value: cast.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)) },
        uCastColor: { value: cast.map((l) => new THREE.Vector4(...l.color)) },
        uShadowPad: { value: castPad },
        uTopLight: { value: resolvedStyle.topLightAlpha },
        // Status rendering
        // Status speaks in ONE hue, the theme's accent, at three intensities: stale is a quiet
        // tint, running is the ring sweeping to full, done is the full ring for a moment. Error is
        // the graph's own invalid red. Warning is the consumer's and keeps amber.
        uAccentColor: { value: new THREE.Color(...tokens[THEME_COLORS.node.borderSelected]) },
        uStatusErrorColor: { value: new THREE.Color(...tokens[THEME_COLORS.edge.invalid]) },
        uStatusWarningColor: { value: new THREE.Color(1.0, 0.64, 0.0) },
        uStatusSuccessColor: { value: new THREE.Color(0.19, 0.64, 0.33) },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSize;
        attribute vec3 aAccentColor; // Per-entity accent color override (-1 = use global)
        attribute float aStatus; // 0=none, 1=error, 2=warning, 3=running, 4=success, 5=dirty
        attribute float aProgress; // 0..1 while running with reported progress; -1 = no bar

        uniform float uShadowPad;

        varying vec2 vUv;
        varying vec2 vSize;
        varying vec2 vExpandedSize;
        varying vec3 vAccentColor;
        varying float vStatus;
        varying float vProgress;

        void main() {
          vUv = uv;
          vSize = aSize;
          vAccentColor = aAccentColor;
          vStatus = aStatus;
          vProgress = aProgress;

          // Expand geometry to hold the whole cast; the reach is computed on the CPU.
          vec2 expandedSize = aSize + vec2(uShadowPad * 2.0);
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
        uniform vec3 uHeaderColor; // global accent band hue; r < 0 = none
        uniform float uPass;
        // The float: shadow-3 as (y, blur, spread) and a colour, three layers.
        uniform vec4 uCast[3];
        uniform vec4 uCastColor[3];
        uniform float uTopLight;
        // Status uniforms
        uniform vec3 uAccentColor;
        uniform vec3 uStatusErrorColor;
        uniform vec3 uStatusWarningColor;
        uniform vec3 uStatusSuccessColor;

        varying vec2 vUv;
        varying vec2 vSize;
        varying vec2 vExpandedSize;
        varying vec3 vAccentColor; // Per-entity accent color override (-1 = use global)
        varying float vStatus; // 0=none, 1=error, 2=warning, 3=running, 4=success, 5=dirty
        varying float vProgress;

        ${squircleBoxSDF}

        // Straight-alpha "over", as gl/glass.ts defines it. Inlined rather than pulling GLASS_GLSL
        // in whole: this shader needs two of its fifteen functions and runs on every node.
        vec4 over(vec4 dst, vec3 c, float a) {
          a = clamp(a, 0.0, 1.0);
          float outA = a + dst.a * (1.0 - a);
          vec3 outC = (c * a + dst.rgb * dst.a * (1.0 - a)) / max(outA, 1e-5);
          return vec4(outC, outA);
        }
        vec4 overC(vec4 dst, vec4 c, float a) {
          return over(dst, c.rgb, c.a * a);
        }

        /**
         * Where a point on the border sits along the perimeter: 0 at top-centre, rising clockwise
         * on screen, 1 back at the top. GL y is up, so "top" is +y and clockwise runs top, right,
         * bottom, left. Straight edges are measured by length and corners by angle, so the sweep
         * moves at one speed all the way round — a plain angle about the centre would race along
         * the short sides of a wide card.
         */
        float perimeterT(vec2 p, vec2 b, float r) {
          float sw = max(b.x - r, 0.0);
          float sh = max(b.y - r, 0.0);
          float arc = 1.5707963 * r;
          float L = 4.0 * (sw + sh + arc);
          float s;
          if (p.y >= sh && abs(p.x) <= sw) {
            s = p.x;                                          // top: 0 at centre, negative x wraps
          } else if (p.x >= sw && abs(p.y) <= sh) {
            s = sw + arc + (sh - p.y);                        // right, going down
          } else if (p.y <= -sh && abs(p.x) <= sw) {
            s = sw + 2.0 * arc + 2.0 * sh + (sw - p.x);       // bottom, going left
          } else if (p.x <= -sw && abs(p.y) <= sh) {
            s = 3.0 * sw + 3.0 * arc + 2.0 * sh + (p.y + sh); // left, going up
          } else {
            vec2 q = p - vec2(sign(p.x) * sw, sign(p.y) * sh);
            float a = atan(q.x, q.y);                         // 0 at up, clockwise toward right
            if (a < 0.0) a += 6.2831853;
            float k = floor(a / 1.5707963);                   // 0 TR, 1 BR, 2 BL, 3 TL
            float within = (a - k * 1.5707963) * r;
            float before = k < 0.5 ? sw : k < 1.5 ? sw + 2.0 * sh : k < 2.5 ? 3.0 * sw + 2.0 * sh : 3.0 * sw + 4.0 * sh;
            s = before + k * arc + within;
          }
          return fract(s / L + 1.0);
        }

        void main() {
          // Map UV to expanded coordinate space, then use entity size for SDF
          vec2 p = (vUv - 0.5) * vExpandedSize;
          vec2 b = vSize * 0.5;

          float d = roundedBoxSDF(p, b, uCornerRadius);

          // The float, priced only in the shadow pass — the body pass used to run this whole ring
          // before dying at the final alpha test, and a 240x100 card paid ~1.9x its fragments for
          // nothing. Each layer is the shape moved DOWN by y, grown by its spread, and blurred;
          // the CSS blur radius is two sigma, so the ramp runs -blur..blur. Exactly glassCast().
          // "cast" is a reserved word in GLSL ES 1.00, hence the name.
          vec4 castAcc = vec4(0.0);
          if (uPass < 0.5) {
            for (int i = 0; i < 3; i++) {
              float cy = uCast[i].x;
              float cb = uCast[i].y;
              float cs = uCast[i].z;
              float dc = roundedBoxSDF(p + vec2(0.0, cy), b + cs, uCornerRadius + cs);
              castAcc = overC(castAcc, uCastColor[i], 1.0 - smoothstep(-cb, cb, dc));
            }
          }

          // Body pass: anything past the hairline is not the body. Shadow pass: the halo alone,
          // and it returns here — nothing below it is the shadow's business.
          if (uPass > 0.5) {
            // Past the hairline AND its anti-alias ramp: aa is in world units and exceeds a
            // pixel below zoom ~0.67, so a fixed 1px margin would clip the edge when zoomed out.
            if (d > uBorderWidth + 0.5 + fwidth(d) * 1.5) discard;
          } else {
            float passAA = fwidth(d) * 1.5;
            float passFill = 1.0 - smoothstep(-passAA, passAA, d);
            // CSS never paints a box-shadow under its own box, and the body is the other pass, so
            // what is left is the halo outside the shape, faded across the shape's own edge.
            float shadowMask = castAcc.a * (1.0 - passFill);
            // 0.004, not 0.01, and it is the difference between a halo that fades and one that
            // ENDS. The outermost layer is still ~1% black where 0.01 would cut it, which is three
            // luma levels on the light floor — a hard edge tracing the card's own outline out in
            // open canvas. At 0.004 the step is one level, the floor's own quantisation. Nothing
            // is saved by the higher number: the three SDFs have already run by this point.
            if (shadowMask < 0.004) discard;
            gl_FragColor = vec4(castAcc.rgb, shadowMask);
            return;
          }

          // Background color (selection/hover handled by EntitySelection layer)
          vec3 bgColor = uBackgroundColor;

          // Border color (selection/hover handled by EntitySelection layer)
          vec3 borderColor = uBorderColor;

          // Status: the card's own outline tells it. Apple's rule, not a badge bolted on — the
          // ring IS the progress, sweeping the perimeter from top-centre clockwise; a run that
          // reports nothing sends a short arc round instead; done completes the ring for a moment
          // and lets it go; stale fades the card a step and tints the hairline. One hue.
          float statusBorderWidth = uBorderWidth;
          float bgAlphaScale = 1.0;
          if (vStatus > 0.5) {
            if (vStatus < 1.5) {
              // Error: the graph's invalid red, a step thicker.
              borderColor = uStatusErrorColor;
              statusBorderWidth = uBorderWidth + 1.0;
            } else if (vStatus < 2.5) {
              // Warning: the consumer's, in amber.
              borderColor = uStatusWarningColor;
              statusBorderWidth = uBorderWidth + 1.0;
            } else if (vStatus < 3.5) {
              float crS = min(uCornerRadius, min(b.x, b.y));
              float t = perimeterT(p, b, crS);
              float swept;
              if (vProgress >= 0.0) {
                // Determinate: everything behind the head is lit, with a soft head.
                swept = 1.0 - smoothstep(vProgress, vProgress + 0.008, t);
              } else {
                // Indeterminate: a comet a fifth of the perimeter long, fading behind its head.
                // Its phase is the RUN's age, not the clock's: every run starts its arc at
                // top-centre, where a reported sweep starts, so a run that reports late does not
                // flash its arc at wherever the clock happened to be before sweeping from zero.
                float head = fract((-vProgress - 1.0) * 0.3);
                float behind = fract(head - t);
                swept = 1.0 - smoothstep(0.0, 0.2, behind);
              }
              borderColor = mix(uBorderColor, uAccentColor, swept);
              statusBorderWidth = uBorderWidth + swept;
            } else if (vStatus < 4.5 && vProgress < 0.0) {
              // Done by the consumer's word: no run, so no hold to dissolve over. A steady ring in
              // the success hue, like the consumer's error and warning rings. The accent held still
              // is what selection looks like, which is what this drew before.
              borderColor = uStatusSuccessColor;
              statusBorderWidth = uBorderWidth + 1.0;
            } else if (vStatus < 4.5) {
              // Done: the ring completes, then dissolves over the hold — vProgress carries how far
              // into the hold this is. A full ring held still would read as SELECTED, which is the
              // same hue; the dissolve is what keeps the two cues apart.
              float fade = 1.0 - clamp(vProgress, 0.0, 1.0);
              fade = fade * fade;
              borderColor = mix(uBorderColor, uAccentColor, fade);
              statusBorderWidth = uBorderWidth + fade;
            } else {
              // Stale: the card fades a step and the hairline takes a quiet accent tint. Subtle
              // by design — on a board mid-edit most cards are stale, and stale is not an alarm.
              borderColor = mix(uBorderColor, uAccentColor, 0.35);
              bgAlphaScale = 0.7;
            }
          }

          // Simplified AA - single fwidth call
          float aa = fwidth(d) * 1.5;

          // Border calculation
          float borderD = d + statusBorderWidth;
          float borderMask = smoothstep(-aa, aa, borderD) - smoothstep(-aa, aa, d);

          // Background fill (respects backgroundAlpha for ghost/outline variants)
          float fillMask = 1.0 - smoothstep(-aa, aa, d);
          float bgAlpha = fillMask * uBackgroundAlpha * bgAlphaScale;

          vec3 color = mix(bgColor, borderColor, borderMask);
          float alpha = max(bgAlpha, borderMask * fillMask);

          // Top light: the 1.5px just inside the shape, weighted to the top edge, dying through
          // the corners. An accent (per-entity, else the global accentHeader) is the same band in
          // its hue, near-solid: one thin line of colour is the whole statement.
          // d runs negative inward: the band is d in [-1.5, 0], softened over the next 1.5px so
          // it reads as light and not as a second hairline. (Written the other way round, this
          // lit the whole top-radius zone of every card: a 12px accent bar, not a 1.5px line.)
          float rim = smoothstep(-3.0, -1.5, d) * fillMask;
          // Clamped to the shape the way roundedBoxSDF clamps it: radius="full" is 9999, and
          // unclamped that put up at ~1 around the whole perimeter — a full accent ring on
          // every pill. max(): smoothstep is undefined when its edges coincide, and radius="none"
          // is legal.
          float cr = min(uCornerRadius, min(b.x, b.y));
          float up = smoothstep(b.y - max(cr, 1.0), b.y, p.y);
          bool accented = vAccentColor.r >= 0.0;
          bool globalAccent = uHeaderColor.r >= 0.0;
          vec3 lightColor = accented ? vAccentColor : (globalAccent ? uHeaderColor : vec3(1.0));
          float lightAlpha = (accented || globalAccent) ? 0.9 : uTopLight;
          color = mix(color, lightColor, rim * up * lightAlpha);

          // For transparent backgrounds, only show border
          if (uBackgroundAlpha < 0.01) {
            color = borderColor;
            alpha = borderMask * fillMask;
          }

          // Body pass. The discard is what keeps the depth write INSIDE the shape: a quad is a
          // rectangle, the node is not, and a fragment that is not drawn writes no depth.
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      // The body is what everything else tests against: it writes depth, inside the shape only.
      depthWrite: true,
      depthTest: true,
    });
  }, [resolvedStyle, tokens]);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { material.dispose(); }, [material]);

  // Same shader, second pass: the halo, depth-tested against the bodies, writing none.
  const shadowMaterial = useMemo(() => {
    const m = material.clone();
    m.uniforms.uPass.value = 0;
    m.depthWrite = false;
    m.depthTest = true;
    return m;
  }, [material]);
  useEffect(() => () => { shadowMaterial.dispose(); }, [shadowMaterial]);

  // Buffers for background (non-selected) and foreground (selected) meshes
  const bgBuffers = useMemo(() => createBuffers(capacity), [capacity]);
  const fgBuffers = useMemo(() => createBuffers(capacity), [capacity]);

  /**
   * Initialise on ATTACH, not in an effect keyed on the buffers.
   *
   * The effect this replaces depended on [bgBuffers, fgBuffers], which change only with capacity.
   * But `args={[geometry, material, capacity]}` makes R3F reconstruct the InstancedMesh whenever
   * `material` changes — and `material` is memoised on `resolvedStyle`, so every THEME CHANGE
   * built a fresh mesh that nobody ever initialised. Its instance attributes were missing and the
   * nodes went with them: measured, a light→dark flip took node-body ink from 170/170 sampled
   * pixels to 41/170.
   *
   * A callback ref fixes the mechanism rather than the cause: whatever the reason a new mesh
   * arrives, it gets its buffers. `initMeshBuffers` wraps the same typed arrays in fresh
   * InstancedBufferAttributes, which is exactly what the new mesh needs.
   */
  const attach = useCallback(
    (which: 'bg' | 'fg') => (mesh: THREE.InstancedMesh | null) => {
      const ref = which === 'bg' ? bgMeshRef : fgMeshRef;
      ref.current = mesh;
      if (mesh) {
        initMeshBuffers(mesh, which === 'bg' ? bgBuffers : fgBuffers);
      }
      // Only claim initialised once BOTH meshes are attached; useFrame reads both.
      initializedRef.current = Boolean(bgMeshRef.current && fgMeshRef.current);
      dirtyRef.current = true;
    },
    [bgBuffers, fgBuffers]
  );
  const attachBg = useMemo(() => attach('bg'), [attach]);
  const attachFg = useMemo(() => attach('fg'), [attach]);

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
    // A press moved something to the front: every body's depth may have changed.
    const unsubStack = store.subscribe(
      (state) => state.stackVersion,
      () => { dirtyRef.current = true; }
    );
    const unsubEvaluation = store.subscribe(
      (state) => state.evaluationVersion,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubEntities();
      unsubViewport();
      unsubHidden();
      unsubSelection();
      unsubStack();
      unsubEvaluation();
    };
  }, [store, capacity]);

  /**
   * The accent a node is painted with is a pure function of (colour name, theme), so resolve it
   * once per pair instead of once per node per frame.
   *
   * `resolveAccentColorRGB` looks cheap and is not: for any entity carrying a `color` it goes
   * through `frozenHue` into `hexToRGB`, which slices the leading `#`, runs a regex, builds a
   * match array, parses three integers and allocates an RGBA array to return three of its four
   * elements. The viewport subscription above marks this layer dirty on every pointermove of a
   * pan, so that whole parse ran per visible accented node per frame — measured in the hundreds
   * of kilobytes of young-generation garbage a second on a canvas of a thousand coloured nodes,
   * to recompute an answer drawn from a closed set of twenty-six hues.
   *
   * The cache is filled lazily through the real resolver rather than built up front from the
   * `AccentColor` union, and that is deliberate: the resolver owns the frozen-palette ordering
   * and the once-per-colour warning for a colour that arrived from stored JSON and is not in the
   * table. Going around it would have re-introduced the per-frame console.warn that
   * `accent-colors.ts` keeps a module-scope Set to prevent. A miss pays the old cost exactly
   * once; every later frame is a Map lookup.
   *
   * Keyed on `tokens` and nothing else. `useThemeTokens` deep-compares before it publishes a new
   * object, so the identity changes when — and only when — a hue actually moved; a narrower dep
   * would leave every accented node painted in the previous theme.
   */
  const accentCache = useMemo(() => new Map<AccentColor, RGBColor>(), [tokens]);

  /**
   * Whether any card is drawing a moving ring — a sweep in progress or a hold dissolving. Both
   * are carried by `aProgress`, which only a rebuild writes, so while either is true the rebuild
   * is forced every frame. Bounded: the engine ends both.
   */
  const hasMovingRingRef = useRef(false);
  /**
   * The drawn sweep, per entity, eased toward what the handler reported.
   *
   * Handlers report progress at whatever rate suits the work — tenths, once a second, per chunk —
   * and drawing that number raw made the ring jump in steps between reports. This holds the value
   * actually painted; entries live only while a run does.
   */
  const progressDisplayRef = useRef(new Map<string, number>());

  // Use R3F's useFrame for RAF-synchronized updates
  useFrame(({ size }, delta) => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;

    if (!bgMesh || !fgMesh || !initializedRef.current) return;

    if (hasMovingRingRef.current) dirtyRef.current = true;

    if (!dirtyRef.current) return;

    const { entities, viewport, hiddenEntityIds, selectedEntityIds, stackOrder, getEvaluationStatus, getEvaluationRecord } = store.getState();
    // One clock read per pass, for the arc and the dissolve; the engine stamps in the same clock.
    const passNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Frame-rate independent: the same fraction of the remaining gap is closed per second
    // whether the display runs at 60Hz or 120Hz.
    const easeAlpha = progressEaseAlpha(delta);
    const progressDisplay = progressDisplayRef.current;
    if (entities.length === 0) {
      bgMesh.count = 0;
      fgMesh.count = 0;
      /**
       * The shadows have to be zeroed HERE too, not only on the path below.
       *
       * A shadow mesh draws the body mesh's instance matrices by aliasing the same attribute, and
       * that array is never cleared — only `count` decides how much of it is drawn. This early
       * return used to zero the two body counts and leave the shadow counts at whatever the last
       * populated frame set, so deleting the last node (select all, delete) erased every body and
       * left its soft halo painted at its old position until a node was added back. The shadow
       * pass writes no depth and nothing was left in front of it to hide it.
       */
      const bgShadowEmpty = bgShadowRef.current;
      const fgShadowEmpty = fgShadowRef.current;
      if (bgShadowEmpty) bgShadowEmpty.count = 0;
      if (fgShadowEmpty) fgShadowEmpty.count = 0;
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
    let movingRing = false;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      // Skip special entity types (handled by separate renderers)
      if (isSelfDrawn(entity.type)) continue;

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
        entityDepth(entity.id, stackOrder, selectedEntityIds)
      );
      mesh.setMatrixAt(idx, tempMatrix);

      // Update attributes
      bufs.sizes[idx * 2] = width;
      bufs.sizes[idx * 2 + 1] = height;

      const color = entity.color;
      let accentRGB: RGBColor;
      if (!color) {
        accentRGB = NO_OVERRIDE_SENTINEL;
      } else {
        const cached = accentCache.get(color);
        if (cached) {
          accentRGB = cached;
        } else {
          accentRGB = resolveAccentColorRGB(color, tokens);
          accentCache.set(color, accentRGB);
        }
      }
      bufs.accentColor[idx * 3] = accentRGB[0];
      bufs.accentColor[idx * 3 + 1] = accentRGB[1];
      bufs.accentColor[idx * 3 + 2] = accentRGB[2];

      // The consumer's word wins where they have one; the engine fills in where they do not.
      // Engine status cannot live on entity data — FlowSync replaces every entity on every prop
      // change, which would erase it within a frame of the widget edit that started the run.
      const engineStatus = getEvaluationStatus(entity.id);
      const status = encodeStatus(
        entity.data?.status ?? (engineStatus === 'idle' ? undefined : engineStatus)
      );
      bufs.status[idx] = status;
      /**
       * What the ring does is the engine's alone: a consumer overriding status has said the run
       * is not what is happening, so the engine's record is not read for that entity.
       *
       * `aProgress` carries two things in one attribute. Positive is the sweep, 0..1. Negative
       * is a travelling arc, and how negative says how long it has been travelling — the shader
       * takes its phase from that, so an arc always sets off from top-centre where a sweep does.
       */
      const record = entity.data?.status === undefined ? getEvaluationRecord(entity.id) : undefined;
      let progress = -1;
      let eased = false;
      if (status === STATUS_RUNNING) {
        if (record?.progress !== undefined) {
          // Chase the reported number rather than snapping to it: a run that reports in tenths
          // then reads as one continuous sweep, and one that reports per frame is unchanged.
          const next = easeProgress(progressDisplay.get(entity.id), record.progress, easeAlpha);
          progressDisplay.set(entity.id, next);
          progress = next;
          eased = true;
        } else {
          // A run anchors the arc to its own start. A consumer who has only said "running" has no
          // start to anchor to, so the arc rides the clock the rest of the pass reads.
          progress = -1 - Math.max(0, record ? passNow - record.since : passNow) / 1000;
        }
        // Between two reports nothing else would move the ring, so a run owns the pass the same
        // way a dissolving hold does. Bounded: the engine ends every run.
        movingRing = true;
      } else if (status === STATUS_SUCCESS && record) {
        progress = Math.min(1, Math.max(0, (passNow - record.since) / SUCCESS_HOLD_MS));
        movingRing = true;
      }
      // A consumer's own `status: 'success'` has no record and keeps -1, which the shader draws as
      // a steady success ring rather than as an accent hold that never dissolves.
      if (!eased) progressDisplay.delete(entity.id);
      bufs.progress[idx] = progress;

      if (isSelected) fgCount++;
      else bgCount++;
    }

    hasMovingRingRef.current = movingRing;
    // Culled and deleted entities are never visited, so their entries are dropped here rather
    // than one by one. Nothing is sweeping, so nothing is left to remember.
    if (!movingRing && progressDisplay.size > 0) progressDisplay.clear();

    // Safety: never exceed buffer capacity to prevent WebGL errors
    bgMesh.count = Math.min(bgCount, capacity);
    fgMesh.count = Math.min(fgCount, capacity);

    // Update GPU buffers for both meshes, over the span each one actually wrote.
    if (bgMesh.count > 0) {
      bgMesh.instanceMatrix.addUpdateRange(0, bgMesh.count * 16);
      bgMesh.instanceMatrix.needsUpdate = true;
    }
    if (fgMesh.count > 0) {
      fgMesh.instanceMatrix.addUpdateRange(0, fgMesh.count * 16);
      fgMesh.instanceMatrix.needsUpdate = true;
    }
    markBuffersForUpload(bgBuffers, bgMesh.count);
    markBuffersForUpload(fgBuffers, fgMesh.count);

    // The shadow passes alias the body passes' instance matrices — the same trick sockets.tsx
    // uses for its two layers — so they are positioned by the write above and never by a copy.
    const bgShadow = bgShadowRef.current;
    const fgShadow = fgShadowRef.current;
    if (bgShadow) { bgShadow.instanceMatrix = bgMesh.instanceMatrix; bgShadow.count = bgMesh.count; }
    if (fgShadow) { fgShadow.instanceMatrix = fgMesh.instanceMatrix; fgShadow.count = fgMesh.count; }
    dirtyRef.current = false;
  });

  // Key forces remount when capacity changes to get new InstancedMeshes
  return (
    <>
      <instancedMesh
        key={`bg-${capacity}`}
        ref={attachBg}
        args={[bgGeometry, material, capacity]}
        renderOrder={RENDER_ORDER_BG}
        frustumCulled={false}
      />
      <instancedMesh
        key={`fg-${capacity}`}
        ref={attachFg}
        args={[fgGeometry, material, capacity]}
        renderOrder={RENDER_ORDER_FG}
        frustumCulled={false}
      />
      {/* Shadows draw AFTER the labels (6) and before the selection chrome (7): a node's halo has
          to fall onto everything behind it, and depth — not this number — keeps it off anything
          in front. */}
      <instancedMesh
        key={`bg-shadow-${capacity}`}
        ref={bgShadowRef}
        name="node-shadows"
        args={[bgGeometry, shadowMaterial, capacity]}
        renderOrder={6.5}
        frustumCulled={false}
      />
      <instancedMesh
        key={`fg-shadow-${capacity}`}
        ref={fgShadowRef}
        name="node-shadows-selected"
        args={[fgGeometry, shadowMaterial, capacity]}
        renderOrder={6.5}
        frustumCulled={false}
      />
    </>
  );
}
