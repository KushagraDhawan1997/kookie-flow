/**
 * On-node widget chrome, drawn in WebGL.
 *
 * THE RULE THIS IMPLEMENTS: everything persistent PAINTS in GL; the DOM appears only
 * transiently, for one field, during an active edit, and then vanishes. Widgets were the last
 * persistent DOM in the graph — seven React components per socket, each a real design-system
 * control, mounted for every visible entity. At a thousand nodes that is thousands of composited
 * layers, which is the measured reason the label path was deleted before it.
 *
 * THE WORD IS "PAINTS", AND IT WAS "RENDERS" UNTIL THE ACCESSIBILITY TREE FORCED THE DISTINCTION.
 * A canvas has no roles, no names and no focusable children, so this file drawing every widget
 * took the widgets out of the accessibility tree entirely — a screen-reader user could reach a
 * socket widget before the migration and had nothing to reach after it. The answer is
 * `widget-a11y-mirror.tsx`: a clipped, focusable DOM control per widget on the ONE node the
 * keyboard cursor is standing on. It paints nothing, it composites nothing, and its element count
 * does not move with the size of the graph. What the rule forbids is a per-node compositing cost,
 * not a per-node entry in a tree the compositor never sees. See decisions.md D7.
 *
 * ONE DRAW CALL for every widget on screen. Kind, value and colour are per-instance attributes and
 * the fragment shader branches on kind — the branch is uniform across an instance, so it costs
 * nothing a separate mesh per kind would have saved, and it saves six draw calls and six buffer
 * sets.
 *
 * WHAT IS NOT HERE. Text is not drawn here: `text-renderer.tsx` already owns MSDF glyphs and
 * knows how to batch them by weight, so a widget's value and a select's current option are
 * contributed to it rather than re-implemented. And nothing here handles a keystroke — an edit
 * borrows a real DOM input, which is `widget-edit-overlay.tsx`.
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useSocketLayout } from '../contexts/StyleContext';
import { getWidgetBox } from '../utils/widget-geometry';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { resolveWidgetConfig } from '../utils/widgets';
import { readWidgetValue, widgetKey } from '../utils/widget-values';
import { WIDGET_RADIUS } from '../utils/widget-text';
import { MIN_WIDGET_ZOOM as HIT_MIN_WIDGET_ZOOM } from '../utils/widget-hit';
import { entityDepth, DEPTH_LAYER } from '../utils/entity-depth';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import type { SocketType, ResolvedWidgetConfig, WidgetType } from '../types';

const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_CAPACITY = 64;
const MAX_CAPACITY = 20000;

/**
 * Widgets stop drawing below this zoom — at that size they are noise, not controls. Imported
 * rather than declared, because `widget-hit.ts` states the invariant this number carries: a
 * threshold the painter honours and the presser does not is an invisible control. Two copies of
 * it are two chances for exactly that to come back.
 */
const MIN_WIDGET_ZOOM = HIT_MIN_WIDGET_ZOOM;

/**
 * TWO MESHES, ROUTED BY SELECTION, exactly as nodes.tsx and sockets.tsx do — and for the reason
 * that made a whole node's widgets vanish the moment it was selected.
 *
 * Every layer here paints with `depthTest: false`, so `renderOrder` alone decides what covers
 * what. A selected node's body moves to its foreground mesh at 4. Widgets sat at 3, once, for
 * every node — so selecting a node drew its body OVER its own sliders and fields, and clicking
 * a field (which selected the node) made the rest of the row disappear.
 *
 * Background sits above the non-selected body (1) and sockets (2); foreground sits above the
 * selected body (4), level with selected sockets (5, no overlap), and below the labels (6) that
 * have to stay readable on top of a field.
 */
const RENDER_ORDER_BG = 3;
const RENDER_ORDER_FG = 5;

/** The well's corner radius; declared beside PAD in widget-text.ts, see there for why. */
export { WIDGET_RADIUS };

/**
 * Room around the box for the focus ring, in world px each side of the quad. The hit box, the
 * instance matrix and every row metric are untouched — the quad alone grows, so a ring drawn
 * just outside the hairline has somewhere to land instead of being cut at the box edge.
 */
export const WIDGET_GLOW_PAD = 4;

/**
 * The inner top shade on a well, and the focus ring's peak. Per appearance, chosen when the
 * material is built and never per frame. Dark wells are punched through to the canvas, so the
 * shade only has to say "recessed"; a light well is a step below white and needs less still.
 */
const WELL_INSET_ALPHA = { dark: 0.12, light: 0.05 } as const;
const FOCUS_RING_ALPHA = { dark: 0.24, light: 0.18 } as const;

/**
 * What the shader draws. Ordered by nothing in particular; the numbers are private to this file
 * and its shader, which is why they are a const object rather than a public union.
 */
const KIND = {
  field: 0,
  checkboxOff: 1,
  checkboxOn: 2,
  slider: 3,
  select: 4,
  color: 5,
} as const;

/** Which kind a widget type draws as. `text`, `number` and `textarea` are all a field. */
function kindFor(type: WidgetType, value: unknown): number {
  switch (type) {
    case 'checkbox':
      return value ? KIND.checkboxOn : KIND.checkboxOff;
    case 'slider':
      return KIND.slider;
    case 'select':
      return KIND.select;
    case 'color':
      return KIND.color;
    default:
      return KIND.field;
  }
}

/** A slider's fill fraction, clamped, with a degenerate range treated as empty rather than NaN. */
function sliderFraction(value: unknown, config: ResolvedWidgetConfig): number {
  const min = config.min ?? 0;
  const max = config.max ?? 1;
  const span = max - min;
  if (!Number.isFinite(span) || span === 0) return 0;
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, (v - min) / span));
}

/**
 * Parse a widget's colour value to RGB into `out` at `offset`, falling back to mid-grey rather
 * than throwing.
 *
 * It writes into the caller's array instead of returning a tuple because the only hot caller is
 * the per-widget loop below, which was allocating a fresh three-element array for EVERY widget on
 * EVERY dirty frame — a colour widget got one from here, and everything else got a literal
 * `[0, 0, 0]` it read three numbers out of and dropped. The loop runs on every frame of a pan, so
 * that was a few hundred arrays a frame of pure nursery churn in the layer whose entire reason for
 * existing is that a pan costs nothing. The destination is the instance buffer itself, so the
 * three components now go straight where they were always headed.
 */
function writeColor(value: unknown, out: { [index: number]: number }, offset: number): void {
  let r = 0.5;
  let g = 0.5;
  let b = 0.5;
  if (typeof value === 'string') {
    const hex = value.trim().replace('#', '');
    if (hex.length === 6) {
      const n = Number.parseInt(hex, 16);
      if (Number.isFinite(n)) {
        r = ((n >> 16) & 255) / 255;
        g = ((n >> 8) & 255) / 255;
        b = (n & 255) / 255;
      }
    }
  }
  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
}

/**
 * The same parse, as a tuple, for callers outside the hot loop. One implementation, because two
 * would eventually disagree about what an unparseable colour looks like.
 */
function colorOf(value: unknown): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  writeColor(value, out, 0);
  return out;
}

/**
 * One matrix, reused for every instance on every frame, exactly as nodes.tsx and sockets.tsx do
 * it. It is only ever written and immediately flushed into the instance array, so nothing can
 * observe it between iterations.
 */
const tempMatrix = new THREE.Matrix4();

export interface WidgetsGLProps {
  /** Socket type definitions, for resolving which widget a socket gets. */
  socketTypes: Record<string, SocketType>;
  /** Minimum zoom at which widgets draw. */
  minWidgetZoom?: number;
  /** Default entity width when the entity does not state one. */
  defaultEntityWidth?: number;
  /** Width reserved for a socket's label before its widget starts. */
  socketLabelWidth?: number;
}

const vertexShader = /* glsl */ `
  attribute vec2 aSize;
  attribute float aRadius;
  attribute float aKind;
  attribute float aValue;
  attribute vec3 aTint;
  attribute float aHover;

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;
  varying float vRadius;
  varying float vHover;

  void main() {
    vUv = uv;
    vSize = aSize;
    vKind = aKind;
    vValue = aValue;
    vTint = aTint;
    vRadius = aRadius;
    vHover = aHover;
    // The quad is WIDGET_GLOW_PAD wider than the box on every side: the focus ring lives there.
    vec3 pos = vec3(position.xy * (aSize + ${(2 * WIDGET_GLOW_PAD).toFixed(1)}), position.z);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uFill;
  uniform vec3 uBorder;
  uniform vec3 uTrack;
  uniform vec3 uActive;
  uniform vec3 uActiveContrast;
  uniform vec3 uThumb;
  uniform vec3 uThumbRing;
  uniform vec3 uChevron;
  uniform float uBorderWidth;
  // The inner top shade's depth and the focus ring's peak, per appearance (see the constants
  // beside the render orders).
  uniform float uInset;
  uniform float uFocusAlpha;

  // The hover dress, as UNIFORMS rather than attributes: WHICH widget is hovered varies per
  // instance, what hover LOOKS like does not. One float per instance carries the first; three
  // colours shared by every instance carry the second.
  uniform vec3 uFillHover;
  uniform vec3 uTrackHover;
  uniform vec3 uBorderHover;

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;
  varying float vRadius;
  varying float vHover;

  // Clamped exactly as nodes.tsx clamps it, and for the same reason: past r = min(b.x, b.y)
  // every fragment lands outside the shape and the box erases itself.
  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    // The quad is padded by WIDGET_GLOW_PAD on every side (vertex shader), so p runs past the
    // box: the shape's own SDFs are still measured against the unpadded halfSize.
    vec2 p = (vUv - 0.5) * (vSize + ${(2 * WIDGET_GLOW_PAD).toFixed(1)});
    vec2 halfSize = vSize * 0.5;

    // vHover is 0 at rest, 1 under the pointer, 2 focused or pressed. Two steps rather than a
    // branch on a varying: hover is +1 step on the chrome, focus is the accent ring on top of it.
    float hov = step(0.5, vHover);
    float foc = step(1.5, vHover);

    // The three state colours, resolved once. hov is 0 or 1, so this is the rest colour or the
    // hover colour and never a blend — but it is a mix rather than a branch, because a branch on a
    // varying costs a divergent path and this costs three lerps of a constant.
    vec3 fill = mix(uFill, uFillHover, hov);
    vec3 track = mix(uTrack, uTrackHover, hov);
    vec3 border = mix(uBorder, uBorderHover, hov);

    vec3 color = fill;
    float alpha = 0.0;
    // One pixel of the world, so the antialiasing is the same width at every zoom.
    float aa = fwidth(p.x) * 0.75 + 1e-5;

    if (vKind < 2.5 && vKind > 0.5) {
      // ---- checkbox: a square mark at the left of the row, not the whole row ----
      float side = min(vSize.y, 18.0);
      vec2 b = vec2(side * 0.5);
      vec2 cp = p - vec2(-halfSize.x + side * 0.5, 0.0);
      float d = roundedBoxSDF(cp, b, min(4.0, side * 0.25));
      float inside = 1.0 - smoothstep(-aa, aa, d);
      float on = step(1.5, vKind);
      // Pressed is the gesture, and it reads as the box going a shade darker under the finger.
      vec3 boxFill = mix(mix(track, uActive, on), vec3(0.0), 0.12 * foc);
      float ring = 1.0 - smoothstep(-aa, aa, d + uBorderWidth);
      color = mix(border, boxFill, ring);

      // The tick, drawn as two thick segments rather than a glyph: it is five lines of SDF and
      // needs no atlas, no second draw call and no font to have loaded.
      if (on > 0.5) {
        vec2 t = cp / side;
        float arm1 = abs(dot(t - vec2(-0.12, 0.06), normalize(vec2(1.0, 1.0))));
        float seg1 = step(-0.20, t.x) * step(t.x, -0.04);
        float arm2 = abs(dot(t - vec2(-0.04, 0.10), normalize(vec2(1.0, -1.0))));
        float seg2 = step(-0.05, t.x) * step(t.x, 0.20);
        float tick = max(seg1 * (1.0 - smoothstep(0.0, 0.055, arm1)),
                         seg2 * (1.0 - smoothstep(0.0, 0.055, arm2)));
        color = mix(color, uActiveContrast, tick * inside);
      }

      // A 3px accent ring outside the box: full strength while pressed, six tenths when a ticked
      // box is hovered, nothing on a hovered empty one — the hairline step already says that.
      float cg = clamp(d / 3.0, 0.0, 1.0);
      float cbHalo = (1.0 - cg) * (1.0 - cg) * step(0.0, d) * max(foc, hov * on * 0.6) * uFocusAlpha;
      // Outside the shape the fragment IS the ring, so it takes the accent outright; its weight
      // is in the alpha. Gated on the ring existing: ungated, the shape's own AA fringe (inside
      // fractional, alpha = inside) took the accent too and every box wore a blue edge at rest.
      color = mix(color, uActive, (1.0 - inside) * step(1e-4, cbHalo));
      alpha = max(inside, cbHalo);
    } else if (vKind > 2.5 && vKind < 3.5) {
      // ---- slider: a channel, a filled portion, and a grip ----
      float trackH = min(4.0, vSize.y * 0.25);
      float d = roundedBoxSDF(p, vec2(halfSize.x, trackH * 0.5), trackH * 0.5);
      alpha = 1.0 - smoothstep(-aa, aa, d);
      float fillEdge = -halfSize.x + vSize.x * vValue;
      color = mix(uActive, track, step(fillEdge, p.x));

      // The grip rides the fill edge, inset by its own radius so it never leaves the channel —
      // the same wall rule a segmented control's thumb obeys. It no longer grows under the
      // pointer: motion in geometry reads as jitter, so hover moves its ring to the accent and
      // a press puts a halo around it instead.
      float gr = 7.0;
      float gx = clamp(fillEdge, -halfSize.x + gr, halfSize.x - gr);
      float gd = length(p - vec2(gx, 0.0)) - gr;
      float grip = 1.0 - smoothstep(-aa, aa, gd);
      float gripRing = 1.0 - smoothstep(-aa, aa, gd + uBorderWidth);
      vec3 thumbRing = mix(uThumbRing, uActive, hov);
      color = mix(color, mix(thumbRing, uThumb, gripRing), grip);

      // Pressed: 4px accent halo around the thumb. On bare card it is the accent at the halo's
      // alpha; where it crosses the channel it is a tint on the channel, since that already has
      // an alpha of its own.
      float gh = clamp(gd / 4.0, 0.0, 1.0);
      float thumbHalo = (1.0 - gh) * (1.0 - gh) * step(0.0, gd) * foc * uFocusAlpha;
      // Proportional to the halo itself: off the chrome a fragment is pure accent only where the
      // halo has alpha, on the chrome it is a tint by the halo's weight, and at rest — thumbHalo
      // zero — nothing moves. The previous weight tinted the channel's and the ring's AA fringes
      // at rest.
      float haloA = thumbHalo * (1.0 - grip);
      float outA = max(alpha, max(grip, thumbHalo));
      color = mix(color, uActive, haloA / max(outA, 1e-4));
      alpha = outA;
    } else {
      // ---- field, select, colour: a well with a hairline ----
      float d = roundedBoxSDF(p, halfSize, min(vRadius, min(halfSize.x, halfSize.y)));
      float inside = 1.0 - smoothstep(-aa, aa, d);
      float ring = 1.0 - smoothstep(-aa, aa, d + uBorderWidth);
      // A colour widget's value is a swatch sitting INSIDE the well with 3px of well showing
      // around it — a swatch in a well, not a lozenge — so the hairline, the shade and the ring
      // are the same chrome as any other well's.
      float swatch = (1.0 - smoothstep(-aa, aa, d + 3.0)) * step(4.5, vKind);
      vec3 base = mix(fill, vTint, swatch);
      // Focus turns the hairline itself to the accent; the ring outside it is the soft half.
      vec3 hair = mix(border, uActive, foc);
      color = mix(hair, base, ring);

      // The inner top shade: 3px of black just under the top hairline, which is what makes a
      // well read as recessed rather than as a lighter or darker rectangle. p.y is up on screen.
      float inset = (1.0 - smoothstep(0.0, 3.0, halfSize.y - p.y - uBorderWidth)) * ring;
      color = mix(color, vec3(0.0), inset * uInset);

      // The focus ring: 3px outside the shape, quadratic, peaking at uFocusAlpha at the edge.
      float g = clamp(d / 3.0, 0.0, 1.0);
      float halo = (1.0 - g) * (1.0 - g) * step(0.0, d) * foc * uFocusAlpha;
      alpha = max(inside, halo);
      // Same rule as the checkbox: outside the shape the colour is the accent, the alpha is the
      // ring's weight — and only while focused, or the AA fringe wears it at rest.
      color = mix(color, uActive, (1.0 - inside) * foc);

      if (vKind > 3.5 && vKind < 4.5) {
        // The select's chevron, at the trailing edge. Two segments, same construction as the tick;
        // 8 wide, 4 tall, a ~1.25px stroke in its own ink rather than the hairline's.
        vec2 c = p - vec2(halfSize.x - 10.0, 0.0);
        float a1 = abs(dot(c - vec2(-2.0, -1.0), normalize(vec2(1.0, 1.0))));
        float s1 = step(-4.0, c.x) * step(c.x, 0.0);
        float a2 = abs(dot(c - vec2(2.0, -1.0), normalize(vec2(1.0, -1.0))));
        float s2 = step(0.0, c.x) * step(c.x, 4.0);
        float chev = max(s1 * (1.0 - smoothstep(0.0, 1.25, a1)),
                         s2 * (1.0 - smoothstep(0.0, 1.25, a2)));
        color = mix(color, uChevron, chev * inside);
      }
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createBuffers(capacity: number) {
  return {
    size: new Float32Array(capacity * 2),
    radius: new Float32Array(capacity),
    kind: new Float32Array(capacity),
    value: new Float32Array(capacity),
    tint: new Float32Array(capacity * 3),
    /**
     * The widget's state: 0 at rest, 1 under the pointer, 2 focused (its edit is open) or
     * pressed. A SIXTH attribute, because there was no spare room in the five above it: `aValue` is the slider fraction, `aTint` the colour widget's value, `aRadius` the
     * corner radius, and every one of them is load-bearing for some kind. (The migration notes
     * claimed the shader already had the attributes for hover. It did not.) Four bytes an
     * instance, 80KB a mesh at MAX_CAPACITY, allocated with the capacity step and never in a frame.
     */
    hover: new Float32Array(capacity),
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
    radiusAttr: null as THREE.InstancedBufferAttribute | null,
    kindAttr: null as THREE.InstancedBufferAttribute | null,
    valueAttr: null as THREE.InstancedBufferAttribute | null,
    tintAttr: null as THREE.InstancedBufferAttribute | null,
    hoverAttr: null as THREE.InstancedBufferAttribute | null,
  };
}

export function WidgetsGL({
  socketTypes,
  minWidgetZoom = MIN_WIDGET_ZOOM,
  defaultEntityWidth = DEFAULT_ENTITY_WIDTH,
  socketLabelWidth = SOCKET_LABEL_WIDTH,
}: WidgetsGLProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();

  const bgMeshRef = useRef<THREE.InstancedMesh>(null);
  const fgMeshRef = useRef<THREE.InstancedMesh>(null);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);
  const [capacity, setCapacity] = useState(INITIAL_CAPACITY);

  const c = THEME_COLORS.widget;
  const material = useMemo(() => {
    // `resolveColor` rather than `resolveTokenColor`: several of these are appearance PAIRS
    // (the well is punched through to the canvas in dark and a step below the card in light),
    // and the pair collapses to one token here, at material build, never per frame.
    const rgb = (key: (typeof THEME_COLORS)['widget'][keyof (typeof THEME_COLORS)['widget']]) => {
      const v = resolveColor(key, tokens);
      return new THREE.Color(v[0], v[1], v[2]);
    };
    return new THREE.ShaderMaterial({
      uniforms: {
        uFill: { value: rgb(c.fill) },
        uBorder: { value: rgb(c.border) },
        uTrack: { value: rgb(c.track) },
        uActive: { value: rgb(c.active) },
        uActiveContrast: { value: rgb(c.activeContrast) },
        uThumb: { value: rgb(c.thumb) },
        uThumbRing: { value: rgb(c.thumbRing) },
        uChevron: { value: rgb(c.chevron) },
        uFillHover: { value: rgb(c.fillHover) },
        uTrackHover: { value: rgb(c.trackHover) },
        uBorderHover: { value: rgb(c.borderHover) },
        uBorderWidth: { value: 1 },
        uInset: { value: WELL_INSET_ALPHA[tokens.appearance] },
        uFocusAlpha: { value: FOCUS_RING_ALPHA[tokens.appearance] },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      // Tests against the bodies (which write depth) so a node in front covers a widget behind;
      // writes nothing, so a track's soft edge cannot punch a hole in what is under it.
      depthWrite: false,
      depthTest: true,
    });
  }, [tokens, c]);
  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { material.dispose(); }, [material]);

  // One buffer set per mesh. A widget is in exactly one of them on any frame, so the capacity
  // is a ceiling on each rather than on their sum — which is what nodes.tsx does too.
  const bgBuffers = useMemo(() => createBuffers(capacity), [capacity]);
  const fgBuffers = useMemo(() => createBuffers(capacity), [capacity]);
  useEffect(() => { initializedRef.current = false; }, [bgBuffers, fgBuffers]);

  // Each mesh needs its OWN geometry: instanced attributes live on the geometry, and two meshes
  // sharing one would fight over which buffer set it carries.
  const bgGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const fgGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { bgGeometry.dispose(); fgGeometry.dispose(); }, [bgGeometry, fgGeometry]);

  useEffect(() => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;
    if (!bgMesh || !fgMesh) return;
    for (const [mesh, buffers] of [[bgMesh, bgBuffers], [fgMesh, fgBuffers]] as const) {
      buffers.sizeAttr = new THREE.InstancedBufferAttribute(buffers.size, 2);
      buffers.radiusAttr = new THREE.InstancedBufferAttribute(buffers.radius, 1);
      buffers.kindAttr = new THREE.InstancedBufferAttribute(buffers.kind, 1);
      buffers.valueAttr = new THREE.InstancedBufferAttribute(buffers.value, 1);
      buffers.tintAttr = new THREE.InstancedBufferAttribute(buffers.tint, 3);
      buffers.hoverAttr = new THREE.InstancedBufferAttribute(buffers.hover, 1);
      for (const a of [buffers.sizeAttr, buffers.radiusAttr, buffers.kindAttr, buffers.valueAttr, buffers.tintAttr, buffers.hoverAttr]) {
        a.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.geometry.setAttribute('aSize', buffers.sizeAttr);
      mesh.geometry.setAttribute('aRadius', buffers.radiusAttr);
      mesh.geometry.setAttribute('aKind', buffers.kindAttr);
      mesh.geometry.setAttribute('aValue', buffers.valueAttr);
      mesh.geometry.setAttribute('aTint', buffers.tintAttr);
      mesh.geometry.setAttribute('aHover', buffers.hoverAttr);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    initializedRef.current = true;
    dirtyRef.current = true;
  }, [bgBuffers, fgBuffers]);

  // Everything that can change what is drawn marks the layer dirty. Deliberately NOT a React
  // re-render: the whole point of this layer is that a pan costs no React work at all.
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubs = [
      store.subscribe((s) => s.viewport, markDirty),
      store.subscribe((s) => s.positionVersion, markDirty),
      store.subscribe((s) => s.topologyVersion, markDirty),
      store.subscribe((s) => s.connectedSockets, markDirty),
      store.subscribe((s) => s.hiddenEntityIds, markDirty),
      // A value is entity DATA, and a data change bumps neither version above. Before this line
      // the layer repainted a changed value only by the accident of `hiddenEntityIds` being a
      // fresh Set on every applyEntityChanges.
      store.subscribe((s) => s.entities, markDirty),
      // Selection moves a widget between the two meshes.
      store.subscribe((s) => s.selectedEntityIds, markDirty),
      // What the person just set, ahead of the consumer echoing it.
      store.subscribe((s) => s.widgetValuesVersion, markDirty),
      // A press moved something to the front.
      store.subscribe((s) => s.stackVersion, markDirty),
      // The pointer moved onto or off a widget. The store dedupes this handle by value, so it
      // arrives exactly twice per hover — on enter and on leave — rather than on every pointermove
      // across the control. That is the same contract sockets.tsx already relies on for
      // `hoveredSocketId`, and without it a pointer resting on a slider would repaint the whole
      // layer sixty times a second.
      store.subscribe((s) => s.hoveredWidget, markDirty),
      // The focused widget wears the ring, and the ring is drawn HERE — the borrowed input over it
      // paints nothing (widget-edit-overlay.tsx). Fires twice per edit: on open and on close.
      store.subscribe((s) => s.editingWidgetKey, markDirty),
      store.subscribe((s) => s.pressedWidgetKey, markDirty),
    ];
    return () => { for (const u of unsubs) u(); };
  }, [store]);

  useFrame(({ size }) => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;
    if (!bgMesh || !fgMesh || !initializedRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;

    const {
      entities, viewport, connectedSockets, hiddenEntityIds, selectedEntityIds, widgetValues, stackOrder,
      hoveredWidget, editingWidgetKey, pressedWidgetKey,
    } = store.getState();
    if (viewport.zoom < minWidgetZoom) {
      bgMesh.count = 0;
      fgMesh.count = 0;
      return;
    }

    // Cull to the viewport, in world units, the way every other layer here does.
    const pad = 200 / viewport.zoom;
    const left = -viewport.x / viewport.zoom - pad;
    const top = -viewport.y / viewport.zoom - pad;
    const right = left + size.width / viewport.zoom + pad * 2;
    const bottom = top + size.height / viewport.zoom + pad * 2;

    let bgCount = 0;
    let fgCount = 0;
    // Counted per mesh, not as one total — see the growth check below for why the sum was wrong.
    let neededBg = 0;
    let neededFg = 0;

    for (const entity of entities) {
      if (hiddenEntityIds.has(entity.id)) continue;
      // Not `entity.inputs ?? []`: that minted an empty array for every entity in the graph that
      // has no inputs, on every frame of a pan, purely to ask its length.
      const inputs = entity.inputs;
      if (!inputs || inputs.length === 0) continue;
      if (
        entity.position.x > right ||
        entity.position.y > bottom ||
        entity.position.x + (entity.width ?? defaultEntityWidth) < left
      ) continue;
      // The fourth side, which this cull was missing while every other layer had it. An entity
      // entirely ABOVE the viewport got all the way into the socket loop, and its widgets were
      // rejected one at a time by the per-widget vertical test further down — but only AFTER
      // being counted as needed, so a downward pan through a tall graph ratcheted the capacity up
      // toward MAX_CAPACITY on widgets that were never drawn, remounting both InstancedMeshes and
      // re-allocating both buffer sets on each step, mid-gesture.
      //
      // The height comes through the layout rather than a default, for the reason geometry.ts
      // states about the hit test: an auto-sized entity is routinely taller than the assumed
      // height, and guessing here would cull widgets that are still on screen. The lookup is a
      // cached O(1) WeakMap hit, and it is paid only by entities that survived the three cheap
      // tests above.
      const entityLayout = getEntitySocketLayout(entity, socketLayout);
      if (entity.position.y + (entity.height ?? entityLayout.computedHeight) < top) continue;

      // Route to the foreground mesh when selected, so the widgets ride above the selected body.
      const isSelected = selectedEntityIds.has(entity.id);
      const mesh = isSelected ? fgMesh : bgMesh;
      const buffers = isSelected ? fgBuffers : bgBuffers;
      const z = entityDepth(entity.id, stackOrder, selectedEntityIds) + DEPTH_LAYER.widget;

      for (let i = 0; i < inputs.length; i++) {
        const socket = inputs[i];
        if (connectedSockets.has(`${entity.id}:${socket.id}:input`)) continue;

        const config = resolveWidgetConfig(socket, socketTypes);
        if (!config) continue;

        const box = getWidgetBox(entity, i, socketLayout, defaultEntityWidth, socketLabelWidth);
        if (!box) continue;
        if (box.y > bottom || box.y + box.height < top) continue;

        // Counted here, below every test, so the count is the number of widgets that were eligible
        // to draw. It used to be taken above the two lines before this one, which handed the
        // growth check below widgets that were culled and never written — the count only ever went
        // up, and so did the capacity.
        if (isSelected) neededFg++;
        else neededBg++;
        const n = isSelected ? fgCount : bgCount;
        if (n >= capacity) continue;

        // A widget's value lives on the ENTITY, keyed by socket id — `entity.data.values[id]` —
        // which is the same place the DOM widgets read it from. A socket carries its shape, not
        // its state. What the person has set and the consumer has not yet echoed back overrides
        // it, by the DOM widgets' own rule (utils/widget-values.ts).
        const values = (entity.data as { values?: Record<string, unknown> } | undefined)?.values;
        const key = widgetKey(entity.id, socket.id);
        const value = readWidgetValue(widgetValues, key, values?.[socket.id] ?? config.defaultValue);
        buffers.size[n * 2] = box.width;
        buffers.size[n * 2 + 1] = box.height;
        // The checkbox's radius is computed in-shader from its own side; this is the well's.
        buffers.radius[n] = WIDGET_RADIUS;
        buffers.kind[n] = kindFor(config.type, value);
        buffers.value[n] = config.type === 'slider' ? sliderFraction(value, config) : 0;
        if (config.type === 'color') {
          writeColor(value, buffers.tint, n * 3);
        } else {
          buffers.tint[n * 3] = 0;
          buffers.tint[n * 3 + 1] = 0;
          buffers.tint[n * 3 + 2] = 0;
        }
        // 0 rest, 1 under the pointer, 2 focused — the widget whose edit is open, which is the
        // one wearing the ring. One key compare and two string compares against handles that are
        // null for all but one widget in the graph. Written unconditionally rather than only when
        // lit, because these buffers are reused across frames and instance `n` is a different
        // widget from one frame to the next — a conditional write would leave the previous
        // occupant's value behind and light the wrong well.
        buffers.hover[n] =
          key === editingWidgetKey || key === pressedWidgetKey
            ? 2
            : hoveredWidget !== null &&
                hoveredWidget.entityId === entity.id &&
                hoveredWidget.socketId === socket.id
              ? 1
              : 0;

        tempMatrix.identity();
        tempMatrix.setPosition(box.x + box.width / 2, -(box.y + box.height / 2), z);
        tempMatrix.toArray(mesh.instanceMatrix.array as unknown as number[], n * 16);
        if (isSelected) fgCount++;
        else bgCount++;
      }
    }

    // The capacity is a ceiling on EACH mesh, not on their sum, so the number to grow against is
    // the larger of the two. This used to add them: forty unselected widgets beside forty selected
    // ones read as eighty and grew buffers that sixty-four already fitted, and every growth is a
    // React re-render that remounts both meshes. Taking the max cannot under-provision — each
    // count is checked against the same per-mesh capacity it will be written into.
    const needed = neededBg > neededFg ? neededBg : neededFg;
    if (needed > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(needed * BUFFER_GROWTH_FACTOR)));
    }

    for (const [mesh, buffers, count] of [
      [bgMesh, bgBuffers, bgCount],
      [fgMesh, fgBuffers, fgCount],
    ] as const) {
      mesh.count = count;
      // Nothing is drawn, so nothing needs sending. Skipped rather than flushed, because a bare
      // `needsUpdate` with no range is a full-array upload — see below — and a zoomed-out or
      // fully-culled frame would have been the most expensive one.
      if (count === 0) continue;

      /**
       * DECLARE THE SPAN, THEN set `needsUpdate`.
       *
       * A bare `needsUpdate` with an empty `updateRanges` makes three fall back to
       * `bufferSubData(bufferType, 0, array)` — the WHOLE array. These arrays are sized to
       * CAPACITY, which grows to 1.5x the peak widget count ever seen on one mesh and never
       * shrinks, so a graph that once had two thousand widgets on screen kept re-uploading two
       * thousand instances' worth of untouched tail on every dirty frame — every frame of a pan —
       * for widgets `mesh.count` was not drawing. Only the first `count` instances were written
       * and only that many are read; whatever stale bytes sit past them in GPU memory are
       * unreachable. Same call edges.tsx and text-renderer.tsx already make. Three clears the
       * ranges once it has uploaded them, so they do not accumulate across frames.
       */
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (buffers.sizeAttr) { buffers.sizeAttr.addUpdateRange(0, count * 2); buffers.sizeAttr.needsUpdate = true; }
      if (buffers.radiusAttr) { buffers.radiusAttr.addUpdateRange(0, count); buffers.radiusAttr.needsUpdate = true; }
      if (buffers.kindAttr) { buffers.kindAttr.addUpdateRange(0, count); buffers.kindAttr.needsUpdate = true; }
      if (buffers.valueAttr) { buffers.valueAttr.addUpdateRange(0, count); buffers.valueAttr.needsUpdate = true; }
      if (buffers.tintAttr) { buffers.tintAttr.addUpdateRange(0, count * 3); buffers.tintAttr.needsUpdate = true; }
      // The one that is easiest to forget, and whose absence is the subtlest failure: hover would
      // then appear only on a frame where some OTHER attribute happened to change.
      if (buffers.hoverAttr) { buffers.hoverAttr.addUpdateRange(0, count); buffers.hoverAttr.needsUpdate = true; }
    }
  });

  // Keyed on capacity so a growth remounts both with fresh InstancedMeshes, as nodes.tsx does.
  return (
    <>
      <instancedMesh
        key={`bg-${capacity}`}
        ref={bgMeshRef}
        // Named so a law can identify this mesh rather than infer it from geometry type and
        // render order — `PlaneGeometry:r3` is shared with the edges' foreground pass, and a
        // probe that matched on it would be reporting whichever mesh it happened to find.
        name="widgets"
        args={[bgGeometry, material, capacity]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER_BG}
      />
      <instancedMesh
        key={`fg-${capacity}`}
        ref={fgMeshRef}
        name="widgets-selected"
        args={[fgGeometry, material, capacity]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER_FG}
      />
    </>
  );
}

export { KIND as WIDGET_KIND, kindFor, sliderFraction, colorOf, writeColor };
