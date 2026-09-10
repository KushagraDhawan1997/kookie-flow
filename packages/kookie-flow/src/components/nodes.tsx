import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { useTheme } from '../contexts/ThemeContext';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { resolveAccentColorRGB, NO_OVERRIDE_SENTINEL } from '../utils/accent-colors';
import { DEFAULT_ENTITY_WIDTH } from '../core/constants';
import type { AccentColor, EntityStatus } from '../types';
import type { RGBColor } from '../utils/color';
import { entityDepth } from '../utils/entity-depth';

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
    return new THREE.ShaderMaterial({
      uniforms: {
        // 1 = the body (writes depth, discards outside the shape); 0 = the shadow halo only.
        uPass: { value: 1 },
        uBackgroundColor: { value: new THREE.Color(...resolvedStyle.background) },
        uBorderColor: { value: new THREE.Color(...resolvedStyle.borderColor) },
        uCornerRadius: { value: resolvedStyle.borderRadius },
        uBorderWidth: { value: resolvedStyle.borderWidth },
        uBackgroundAlpha: { value: resolvedStyle.backgroundAlpha },
        // Header: the global accent band hue (r < 0 = none) and the separator's row height.
        // A Vector3 rather than a Color so the resolver's negative sentinel is not a colour.
        uHeaderColor: { value: new THREE.Vector3(...(resolvedStyle.accentBand ?? NO_ACCENT_BAND)) },
        uHeaderHeight: { value: resolvedStyle.headerHeight },
        uHeaderPosition: { value: resolvedStyle.headerPosition },
        // The card's float and its top light; both per appearance, both from the resolver.
        uShadowBlur: { value: resolvedStyle.shadowBlur },
        uShadowOffsetY: { value: resolvedStyle.shadowOffsetY },
        uShadowOpacity: { value: resolvedStyle.shadowOpacity },
        uTopLight: { value: resolvedStyle.topLightAlpha },
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
        uniform vec3 uHeaderColor; // global accent band hue; r < 0 = none
        uniform float uHeaderHeight;
        uniform float uHeaderPosition; // 0=none, 1=inside, 2=outside
        uniform float uPass;
        // Shadow uniforms
        uniform float uShadowBlur;
        uniform float uShadowOffsetY;
        uniform float uShadowOpacity;
        uniform float uTopLight;
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
          // A rounded box is only defined for r <= min(b.x, b.y). Past that every fragment
          // lands outside the shape and the early-discard erases the box entirely — which is
          // exactly what --radius-full (9999px) did: measured, node body ink fell from
          // 170/170 sampled pixels to 3/170. Clamp here rather than at the call sites: the
          // three callers pass different radii (uCornerRadius, +vPadding, -vOutlineWidth) and
          // a repeated clamp would drift.
          r = min(r, min(b.x, b.y));
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

        void main() {
          // Map UV to expanded coordinate space, then use entity size for SDF
          vec2 p = (vUv - 0.5) * vExpandedSize;
          vec2 b = vSize * 0.5;

          // Shadow calculation (rendered behind main shape)
          // The shadow is priced only in the shadow pass. Both passes share the vertex shader
          // and so the 28px padded quad; the body pass used to run this SDF, the status branch
          // and every mask over that whole ring before dying at the final alpha test — a
          // 240x100 card paid ~1.9x its fragments for nothing.
          float shadowAlpha = 0.0;
          if (uPass < 0.5 && uShadowOpacity > 0.0) {
            // Offset shadow position (Y is negated because WebGL Y-up vs our Y-down)
            vec2 shadowP = p + vec2(0.0, uShadowOffsetY);
            float shadowD = roundedBoxSDF(shadowP, b, uCornerRadius);
            // Full inside a short way under the edge, then a quadratic tail out to the blur:
            // no knee where the halo meets the body, and the card lands rather than floats.
            float s = 1.0 - smoothstep(-uShadowBlur * 0.25, uShadowBlur, shadowD);
            shadowAlpha = uShadowOpacity * s * s;
          }

          float d = roundedBoxSDF(p, b, uCornerRadius);

          // Body pass: anything past the hairline is not the body. Shadow pass: the halo alone,
          // and it returns here — nothing below it is the shadow's business.
          if (uPass > 0.5) {
            // Past the hairline AND its anti-alias ramp: aa is in world units and exceeds a
            // pixel below zoom ~0.67, so a fixed 1px margin would clip the edge when zoomed out.
            if (d > uBorderWidth + 0.5 + fwidth(d) * 1.5) discard;
          } else {
            float passAA = fwidth(d) * 1.5;
            float passFill = 1.0 - smoothstep(-passAA, passAA, d);
            float shadowMask = shadowAlpha * (1.0 - passFill);
            if (shadowMask < 0.01) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, shadowMask);
            return;
          }

          // Background color (selection/hover handled by EntitySelection layer)
          vec3 bgColor = uBackgroundColor;

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

          vec3 color = mix(bgColor, borderColor, borderMask);
          float alpha = max(bgAlpha, borderMask * fillMask);

          // Separator under an inside header: the header is typographic, the line is all that
          // is left of the block. Inset 12 world px from each side so it reads as a rule, not a
          // seam.
          if (uHeaderPosition > 0.5 && uHeaderPosition < 1.5) {
            float hb = b.y - uHeaderHeight;
            float sep = (1.0 - smoothstep(0.5, 1.0, abs(p.y - hb))) * step(12.0, b.x - abs(p.x)) * fillMask;
            color = mix(color, uBorderColor, sep);
          }
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
  }, [resolvedStyle]);

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

    return () => {
      unsubEntities();
      unsubViewport();
      unsubHidden();
      unsubSelection();
      unsubStack();
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

    const { entities, viewport, hiddenEntityIds, selectedEntityIds, stackOrder } = store.getState();
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
    let hasAnimated = false;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      // Skip special entity types (handled by separate renderers)
      if (entity.type === 'comment' || entity.type === 'reroute' || entity.type === 'text' || entity.type === 'image') continue;

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

      const status = encodeStatus(entity.data?.status);
      bufs.status[idx] = status;
      if (status > 2.5) hasAnimated = true;

      if (isSelected) fgCount++;
      else bgCount++;
    }

    hasAnimatedStatusRef.current = hasAnimated;

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
