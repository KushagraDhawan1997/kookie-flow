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
 * contributed to it rather than re-implemented. A select's list and a colour widget's picker are
 * `widget-popover.tsx`, drawn in GL over everything. And nothing here handles a keystroke — a
 * text edit borrows a real DOM input for its caret and IME, which is `widget-edit-overlay.tsx`.
 *
 * THE LOOK IS GLASS, from `gl/glass.ts`: a well is the card showing through a tint, lit along
 * its top edge, with a hairline; a checked box and a slider's fill are the accent under the same
 * light. Every state fades — see `gl/motion.ts` for how that costs nothing per frame.
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle, useSocketLayout } from '../contexts/StyleContext';
import { sliderTrackWidth, wellRadius, getWidgetBox } from '../utils/widget-geometry';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { resolveWidgetConfig } from '../utils/widgets';
import { readWidgetValue, widgetKey } from '../utils/widget-values';
import { MIN_WIDGET_ZOOM as HIT_MIN_WIDGET_ZOOM } from '../utils/widget-hit';
import { entityDepth, DEPTH_LAYER } from '../utils/entity-depth';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import {
  SDF_GLSL,
  GLASS_GLSL,
  EASE_GLSL,
  TransitionTracker,
  motionNow,
  SETTLED,
  MATERIAL,
  MOTION,
  PRESS_SQUASH,
  FOCUS_RING,
  easeColor,
  springStiff,
  springLively,
  type RGBA,
  type CastLayer,
} from '../gl';
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

/**
 * Room around the box for the focus ring, in world px each side of the quad. The hit box, the
 * instance matrix and every row metric are untouched — the quad alone grows, so a ring drawn
 * just outside the hairline has somewhere to land instead of being cut at the box edge.
 */
export const WIDGET_GLOW_PAD = 12;


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
  attribute vec4 aAnim;
  attribute vec3 aMotion;
  attribute vec2 aRing;

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;
  varying float vRadius;
  varying float vHover;
  varying vec4 vAnim;
  varying vec3 vMotion;
  varying vec2 vRing;

  void main() {
    vUv = uv;
    vSize = aSize;
    vKind = aKind;
    vValue = aValue;
    vTint = aTint;
    vRadius = aRadius;
    vHover = aHover;
    vAnim = aAnim;
    vMotion = aMotion;
    vRing = aRing;
    // The quad is WIDGET_GLOW_PAD wider than the box on every side: the focus ring lives there.
    vec3 pos = vec3(position.xy * (aSize + ${(2 * WIDGET_GLOW_PAD).toFixed(1)}), position.z);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  }
`;

/**
 * The control shader: KookieUI v2's controls, from `gl/glass.ts` and the numbers in
 * `gl/material.ts`, animated the way v2 animates them.
 *
 * THREE CLOCKS, AS v2 KEEPS THEM. Colour and movement never share a clock in v2, and neither do
 * they here:
 *  - COLOUR (`vHover`: 0 rest, 1 hover or open, 2 pressed) arrives on hover in 80ms, leaves in
 *    220ms, and lands at once on a press, on `--motion-easing`.
 *  - MOVEMENT (`vMotion`: pressed or not) goes into a press on the stiff spring over 140ms and
 *    recovers on the lively spring over 550ms. Only a mark and a slider's grip move — they squash.
 *    A field never moves, and a select trigger holds still too: its value is drawn by the text
 *    layer, and a well that sank under still text would read as broken.
 *  - THE FOCUS RING (`vRing`) appears and leaves at once. On a mark or a trigger it lands from 6px
 *    out to 2px over `--motion-ring`; on a field and on a slider's grip it does not travel.
 * A checkbox's fill changes as a colour does; its tick draws on over `--motion-mark` and clears at
 * once. Under reduced motion `uMotion` is 0 and every one of these lands immediately.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uFill;
  uniform vec3 uFillHover;
  uniform vec3 uFillActive;
  uniform vec3 uMarkFill;
  uniform vec3 uMarkFillHover;
  uniform vec3 uMarkFillActive;
  uniform vec4 uMarkEdge;
  uniform vec3 uTrack;
  uniform vec3 uActive;
  uniform vec3 uActiveHover;
  uniform vec3 uActivePressed;
  uniform vec3 uActiveContrast;
  uniform vec3 uThumb;
  uniform vec3 uChevron;
  uniform vec3 uRing;
  uniform float uMarkSize;
  uniform float uMarkRadius;
  uniform float uTrackHeight;

  // The material (gl/material.ts).
  uniform float uControlAlpha;
  uniform vec4 uRingTop;
  uniform vec4 uRingUpper;
  uniform vec4 uRingSide;
  uniform vec4 uRingBottom;
  uniform float uPoolAlpha;
  uniform float uMarkLight;
  uniform float uChevronAlpha;
  uniform vec4 uGripCast[2];
  uniform vec4 uGripCastColor[2];
  uniform float uGrain;
  uniform float uPressSquash;
  uniform vec3 uFocusRing;

  // Motion: the clock, v2's durations (hover in, hover out, mark, ring; press, rise), and 0 under
  // reduced motion.
  uniform float uTime;
  uniform float uMotion;
  uniform vec4 uColourDur;
  uniform vec2 uMoveDur;

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;
  varying float vRadius;
  varying float vHover;
  varying vec4 vAnim;
  varying vec3 vMotion;
  varying vec2 vRing;

  ${SDF_GLSL}
  ${GLASS_GLSL}
  ${EASE_GLSL}

  // How far through a step that started at \`start\` and lasts \`dur\`; a step of no length, or any
  // step under reduced motion, has already arrived.
  float progress(float start, float dur) {
    float d = dur * uMotion;
    return d <= 0.0 ? 1.0 : clamp((uTime - start) / d, 0.0, 1.0);
  }

  // The focus ring: 2px wide at a 2px offset, landing from \`land\` = 0 (6px out) to 1.
  vec4 focusRing(vec4 acc, float d, float aa, float on, float land) {
    float offset = uFocusRing.y + uFocusRing.z * (1.0 - land);
    float band = ringSDF(d - offset - uFocusRing.x, uFocusRing.x, aa);
    return over(acc, uRing, band * on);
  }

  void main() {
    vec2 p = (vUv - 0.5) * (vSize + ${(2 * WIDGET_GLOW_PAD).toFixed(1)});
    vec2 halfSize = vSize * 0.5;
    float aa = fwidth(p.x) * 0.75 + 1e-5;
    vec2 px = gl_FragCoord.xy;

    float colDur = vHover > 1.5 ? 0.0 : (vHover > 0.5 ? uColourDur.x : uColourDur.y);
    float col = mix(vAnim.x, vHover, easeColor(progress(vAnim.y, colDur)));
    float hov = clamp(col, 0.0, 1.0);
    float act = clamp(col - 1.0, 0.0, 1.0);

    float pressedTo = vMotion.z;
    float pt = progress(vMotion.y, pressedTo > 0.5 ? uMoveDur.x : uMoveDur.y);
    float press = mix(vMotion.x, pressedTo, pressedTo > 0.5 ? springStiff(pt) : springLively(pt));

    float ringOn = vRing.x;
    float land = springStiff(progress(vRing.y, uColourDur.w));

    vec4 acc = vec4(0.0);

    if (vKind < 2.5 && vKind > 0.5) {
      // ---- the mark: v2's .kui-checkbox. No material — a 20px square of blur is a 20px square ----
      float side = min(vSize.y, uMarkSize);
      float squash = 1.0 - (1.0 - uPressSquash) * press;
      vec2 b = vec2(side * 0.5);
      vec2 cp = (p - vec2(-halfSize.x + side * 0.5, 0.0)) / squash;
      float r = min(uMarkRadius, side * 0.5);
      float d = sdRoundedBox(cp, b, r);
      float inside = fillSDF(d, aa);
      float on = step(1.5, vKind);
      float onV = mix(vAnim.z, on, easeColor(progress(vAnim.w, uColourDur.x)));
      float tick = on > 0.5 ? springMark(progress(vAnim.w, uColourDur.z)) : 0.0;

      vec3 rest = mix(mix(uMarkFill, uMarkFillHover, hov), uMarkFillActive, act);
      vec3 checkedFill = mix(mix(uActive, uActiveHover, hov), uActivePressed, act);
      acc = over(acc, mix(rest, checkedFill, onV), inside);
      acc = glassLight(acc, inside * onV, (b.y - cp.y) / side, uMarkLight);
      // Checked, the edge melts into the fill.
      vec4 edge = mix(uMarkEdge, vec4(checkedFill, 1.0), onV);
      acc = overC(acc, edge, ringSDF(d, 1.0, aa));

      if (tick > 0.001) {
        float dt = sdTick(cp, side, min(tick, 1.0));
        acc = over(acc, uActiveContrast, fillSDF(dt, aa) * inside);
      }
      acc = focusRing(acc, d * squash, aa, ringOn, land);
    } else if (vKind > 2.5 && vKind < 3.5) {
      // ---- the slider: v2's .kui-slider ----
      float trackH = min(uTrackHeight, vSize.y * 0.25);
      // The track's corner follows the control's, so it squares at radius none.
      float tr = min(trackH * 0.5, vRadius);
      float d = sdRoundedBox(p, vec2(halfSize.x, trackH * 0.5), tr);
      float fillEdge = -halfSize.x + vSize.x * vValue;
      acc = over(acc, uTrack, fillSDF(d, aa));
      float filled = fillSDF(d, aa) * (1.0 - smoothstep(fillEdge - aa, fillEdge + aa, p.x));
      acc = over(acc, uActive, filled);

      float gr = min(uMarkSize, vSize.y) * 0.5;
      float gx = clamp(fillEdge, -halfSize.x + gr, halfSize.x - gr);
      float squash = 1.0 - (1.0 - uPressSquash) * press;
      vec2 gp = (p - vec2(gx, 0.0)) / squash;
      float gd = sdCircle(gp, gr);
      for (int i = 0; i < 2; i++) {
        float dc = sdCircle(gp - vec2(0.0, -uGripCast[i].x), gr + uGripCast[i].z);
        acc = glassCast(acc, dc, gd, uGripCast[i].y, uGripCastColor[i]);
      }
      acc = over(acc, uThumb, fillSDF(gd, aa));
      // The ring sits on the grip and does not travel.
      acc = focusRing(acc, gd * squash, aa, ringOn, 1.0);
    } else {
      // ---- field, select, colour: v2's .kui-field in the regular material ----
      float r = min(vRadius, min(halfSize.x, halfSize.y));
      float d = sdRoundedBox(p, halfSize, r);
      float inside = fillSDF(d, aa);

      vec3 fill = mix(mix(uFill, uFillHover, hov), uFillActive, act);
      acc = over(acc, fill, uControlAlpha * inside);
      // inset 0 -6px 12px -10px: the hole is the box moved up 6 and grown by 10.
      float dHole = sdRoundedBox(p - vec2(0.0, 6.0), halfSize + 10.0, r + 10.0);
      acc = glassInset(acc, inside, dHole, 12.0, uPoolAlpha);
      acc = glassGrain(acc, inside, px, uGrain);
      acc = glassRing(acc, d + 1.0, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 1.0);

      if (vKind > 4.5) {
        float ds = d + 4.0;
        float sw = fillSDF(ds, aa);
        acc = over(acc, vTint, sw);
        acc = glassLight(acc, sw, (halfSize.y - 4.0 - p.y) / (vSize.y - 8.0), uMarkLight);
        acc = overC(acc, uMarkEdge, ringSDF(ds, 1.0, aa) * 0.6);
      }

      if (vKind > 3.5 && vKind < 4.5) {
        // v2's chevron: 7 by 3.5, a 1.17px stroke, muted ink, centred 18px in; it turns over while
        // the list is open.
        vec2 c = p - vec2(halfSize.x - 18.0, 0.0);
        float dc = sdChevron(c, 7.0, 3.5, 0.58, press * 3.14159265);
        acc = over(acc, uChevron, fillSDF(dc, aa) * inside * uChevronAlpha);
      }

      // A field rings whenever it has the caret, at once; a trigger rings for the keyboard and lands.
      float trigger = step(3.5, vKind);
      acc = focusRing(acc, d, aa, ringOn, mix(1.0, land, trigger));
    }

    if (acc.a < 0.004) discard;
    gl_FragColor = acc;
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
    /**
     * Where each instance's two transitions started, and when: (hoverFrom, hoverStart,
     * checkedFrom, checkedStart). The shader eases from these to `hover` and to the checked
     * kind against the clock uniform, so a fade costs one write here when the state changes
     * and nothing per frame. See gl/motion.ts.
     */
    anim: new Float32Array(capacity * 4),
    /**
     * The press, on its own clock: (pressFrom, pressStart, pressedTo). v2 never lets colour and
     * movement share a clock, so a squash cannot ride the colour's fade.
     */
    motion: new Float32Array(capacity * 3),
    /** The focus ring: (on, landStart). */
    ring: new Float32Array(capacity * 2),
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
    radiusAttr: null as THREE.InstancedBufferAttribute | null,
    kindAttr: null as THREE.InstancedBufferAttribute | null,
    valueAttr: null as THREE.InstancedBufferAttribute | null,
    tintAttr: null as THREE.InstancedBufferAttribute | null,
    hoverAttr: null as THREE.InstancedBufferAttribute | null,
    animAttr: null as THREE.InstancedBufferAttribute | null,
    motionAttr: null as THREE.InstancedBufferAttribute | null,
    ringAttr: null as THREE.InstancedBufferAttribute | null,
  };
}

/**
 * What the shader is told about a widget, from the four store fields that name one.
 *
 * COLOUR is v2's fill ladder: 2 pressed, 1 under the pointer or holding its list open (an open
 * trigger holds its hover fill), 0 at rest. PRESS is the pose: pressed, or open. RING is focus:
 * the widget whose edit is open has the caret, and the one the keyboard is on through the
 * accessibility mirror is `:focus-visible` — a pointer press rings neither a mark nor a trigger.
 */
interface WidgetStateSource {
  hoveredWidget: { entityId: string; socketId: string } | null;
  editingWidgetKey: string | null;
  pressedWidgetKey: string | null;
  focusVisibleWidgetKey: string | null;
  widgetPopover: { key: string } | null;
}
function colourLevel(key: string, entityId: string, socketId: string, s: WidgetStateSource): number {
  if (key === s.pressedWidgetKey) return 2;
  if (key === s.widgetPopover?.key) return 1;
  const h = s.hoveredWidget;
  return h !== null && h.entityId === entityId && h.socketId === socketId ? 1 : 0;
}
/**
 * The same, from a key alone — for the event path, which has a key and not the ids. One
 * concatenation per event rather than a split: an entity id may itself contain a colon.
 */
function colourLevelOfKey(key: string, s: WidgetStateSource): number {
  if (key === s.pressedWidgetKey) return 2;
  if (key === s.widgetPopover?.key) return 1;
  const h = s.hoveredWidget;
  return h !== null && widgetKey(h.entityId, h.socketId) === key ? 1 : 0;
}
function pressLevel(key: string, s: WidgetStateSource): number {
  return key === s.pressedWidgetKey || key === s.widgetPopover?.key ? 1 : 0;
}
function ringLevel(key: string, s: WidgetStateSource): number {
  return key === s.editingWidgetKey || key === s.focusVisibleWidgetKey ? 1 : 0;
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
  const resolvedStyle = useResolvedStyle();

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
    const m = MATERIAL[tokens.appearance];
    const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
    const cast = (l: CastLayer) => new THREE.Vector4(l.y, l.blur, l.spread, 0);
    const castColor = (l: CastLayer) => rgba(l.color);
    const highContrast = tokens.contrast === 'high';
    // v2's solid hover and active steps (#0094fc, #0088e8, #007cd4): the same accent, darker. A
    // press darkens the colour; it is never a brightness filter.
    const accent = resolveColor(c.active, tokens);
    const shade = (k: number) => new THREE.Color(accent[0] * k, accent[1] * k, accent[2] * k);
    return new THREE.ShaderMaterial({
      uniforms: {
        uFill: { value: rgb(c.fill) },
        uFillHover: { value: rgb(c.fillHover) },
        uFillActive: { value: rgb(c.fillActive) },
        uMarkFill: { value: rgb(c.markFill) },
        uMarkFillHover: { value: rgb(c.markFillHover) },
        uMarkFillActive: { value: rgb(c.markFillActive) },
        uMarkEdge: { value: rgba(highContrast ? m.markEdgeHighContrast : m.markEdge) },
        uTrack: { value: rgb(highContrast ? c.trackHighContrast : c.track) },
        uActive: { value: rgb(c.active) },
        uActiveHover: { value: shade(0.92) },
        uActivePressed: { value: shade(0.845) },
        uRing: { value: rgb(c.ring) },
        uActiveContrast: { value: rgb(c.activeContrast) },
        uThumb: { value: rgb(c.thumb) },
        uChevron: { value: rgb(c.chevron) },
        uMarkSize: { value: socketLayout.markSize },
        uMarkRadius: { value: resolvedStyle.markRadius },
        uTrackHeight: { value: socketLayout.trackHeight },
        uControlAlpha: { value: m.controlAlpha },
        uRingTop: { value: rgba(m.controlRing.top) },
        uRingUpper: { value: rgba(m.controlRing.upper) },
        uRingSide: { value: rgba(m.controlRing.side) },
        uRingBottom: { value: rgba(m.controlRing.bottom) },
        uPoolAlpha: { value: m.poolAlpha },
        uMarkLight: { value: m.markLight },
        uChevronAlpha: { value: m.chevronAlpha },
        uGripCast: { value: m.gripCast.map(cast) },
        uGripCastColor: { value: m.gripCast.map(castColor) },
        uGrain: { value: m.grain },
        uPressSquash: { value: PRESS_SQUASH },
        uFocusRing: { value: new THREE.Vector3(FOCUS_RING.width, FOCUS_RING.offset, FOCUS_RING.land) },
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uColourDur: { value: new THREE.Vector4(MOTION.hoverIn, MOTION.hoverOut, MOTION.mark, MOTION.ring) },
        uMoveDur: { value: new THREE.Vector2(MOTION.press, MOTION.rise) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      // Tests against the bodies (which write depth) so a node in front covers a widget behind;
      // writes nothing, so a track's soft edge cannot punch a hole in what is under it.
      depthWrite: false,
      depthTest: true,
    });
  }, [tokens, c, resolvedStyle.markRadius]);
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
      buffers.animAttr = new THREE.InstancedBufferAttribute(buffers.anim, 4);
      buffers.motionAttr = new THREE.InstancedBufferAttribute(buffers.motion, 3);
      buffers.ringAttr = new THREE.InstancedBufferAttribute(buffers.ring, 2);
      for (const a of [buffers.sizeAttr, buffers.radiusAttr, buffers.kindAttr, buffers.valueAttr, buffers.tintAttr, buffers.hoverAttr, buffers.animAttr, buffers.motionAttr, buffers.ringAttr]) {
        a.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.geometry.setAttribute('aSize', buffers.sizeAttr);
      mesh.geometry.setAttribute('aRadius', buffers.radiusAttr);
      mesh.geometry.setAttribute('aKind', buffers.kindAttr);
      mesh.geometry.setAttribute('aValue', buffers.valueAttr);
      mesh.geometry.setAttribute('aTint', buffers.tintAttr);
      mesh.geometry.setAttribute('aHover', buffers.hoverAttr);
      mesh.geometry.setAttribute('aAnim', buffers.animAttr);
      mesh.geometry.setAttribute('aMotion', buffers.motionAttr);
      mesh.geometry.setAttribute('aRing', buffers.ringAttr);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    initializedRef.current = true;
    dirtyRef.current = true;
  }, [bgBuffers, fgBuffers]);

  /**
   * A radius level change repaints the wells.
   *
   * The frame loop reads `widgetRadius` out of this closure, and a new closure alone does not
   * repaint anything: without this the loop early-returns on a clean dirty flag and the wells keep
   * the previous level's corners until something else moves. Keyed on the number rather than on
   * the style object, which is a fresh identity on every theme read.
   */
  useEffect(() => { dirtyRef.current = true; }, [resolvedStyle.widgetRadius]);

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
      // The keyboard moved onto or off a control through the accessibility mirror.
      store.subscribe((s) => s.focusVisibleWidgetKey, markDirty),
      // The open panel's trigger is lit the same way. Fires on open and on close.
      store.subscribe((s) => s.widgetPopover, markDirty),
    ];
    return () => { for (const u of unsubs) u(); };
  }, [store]);

  /**
   * The transitions. Each of the four state fields above fires exactly on a change, and the
   * change names the widget that left a state and the one that entered it — so those two keys,
   * and only those two, are re-stated to the tracker at the moment it happened. This is the
   * ONLY place a fade is started; the frame loop just copies the tracker's answer into the
   * instance buffer. Value changes animate a checkbox by the key `setWidgetValue` last wrote.
   */
  // Reduced motion reaches the trackers through a ref, so flipping it rebuilds nothing; the
  // shader hears it through `uMotion`.
  const reducedMotion = usePrefersReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  useEffect(() => {
    material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
    dirtyRef.current = true;
  }, [material, reducedMotion]);

  const colourTrack = useMemo(
    () => new TransitionTracker(
      (to) => (reducedRef.current || to >= 2 ? 0 : to >= 1 ? MOTION.hoverIn : MOTION.hoverOut),
      easeColor
    ),
    []
  );
  const pressTrack = useMemo(
    () => new TransitionTracker(
      (to) => (reducedRef.current ? 0 : to >= 1 ? MOTION.press : MOTION.rise),
      (t, to) => (to >= 1 ? springStiff(t) : springLively(t))
    ),
    []
  );
  const ringTrack = useMemo(
    () => new TransitionTracker(() => (reducedRef.current ? 0 : MOTION.ring), springStiff),
    []
  );
  // Held for the tick's whole draw so the clock keeps running, but answering where the FILL is,
  // which changes as a colour does and lands in `hoverIn`.
  const checkTrack = useMemo(
    () => new TransitionTracker(
      (to) => (reducedRef.current ? 0 : to >= 1 ? MOTION.mark : MOTION.hoverIn),
      (t, to) => easeColor(to >= 1 ? (t * MOTION.mark) / MOTION.hoverIn : t)
    ),
    []
  );
  useEffect(() => {
    const restate = (key: string | null | undefined) => {
      if (!key) return;
      const s = store.getState();
      const now = motionNow();
      colourTrack.set(key, colourLevelOfKey(key, s), now);
      pressTrack.set(key, pressLevel(key, s), now);
      ringTrack.set(key, ringLevel(key, s), now);
    };
    const handleKey = (h: { entityId: string; socketId: string } | null) =>
      h ? widgetKey(h.entityId, h.socketId) : null;
    const unsubs = [
      store.subscribe((s) => s.hoveredWidget, (next, prev) => { restate(handleKey(prev)); restate(handleKey(next)); }),
      store.subscribe((s) => s.editingWidgetKey, (next, prev) => { restate(prev); restate(next); }),
      store.subscribe((s) => s.pressedWidgetKey, (next, prev) => { restate(prev); restate(next); }),
      store.subscribe((s) => s.focusVisibleWidgetKey, (next, prev) => { restate(prev); restate(next); }),
      store.subscribe((s) => s.widgetPopover, (next, prev) => { restate(prev?.key); restate(next?.key); }),
      store.subscribe((s) => s.widgetValuesVersion, () => {
        const s = store.getState();
        const key = s.lastChangedWidgetKey;
        if (!key) return;
        const value = s.widgetValues.get(key)?.value;
        if (typeof value === 'boolean') checkTrack.set(key, value ? 1 : 0, motionNow());
      }),
    ];
    return () => {
      for (const u of unsubs) u();
      colourTrack.clear();
      pressTrack.clear();
      ringTrack.clear();
      checkTrack.clear();
    };
  }, [store, colourTrack, pressTrack, ringTrack, checkTrack]);

  useFrame(({ size }) => {
    const bgMesh = bgMeshRef.current;
    const fgMesh = fgMeshRef.current;
    if (!bgMesh || !fgMesh || !initializedRef.current) return;
    // The clock reaches the shader only while something is fading or the buffers are being
    // rewritten; a still layer never re-uploads. `active` also sweeps settled transitions.
    const now = motionNow();
    // Each is swept on its own: `||` would stop at the first one moving and leave the rest unswept.
    const colourMoving = colourTrack.active(now);
    const pressMoving = pressTrack.active(now);
    const ringMoving = ringTrack.active(now);
    const checkMoving = checkTrack.active(now);
    const moving = colourMoving || pressMoving || ringMoving || checkMoving;
    if (moving || dirtyRef.current) material.uniforms.uTime.value = now;
    if (!dirtyRef.current) return;
    dirtyRef.current = false;

    const state = store.getState();
    const {
      entities, viewport, connectedSockets, hiddenEntityIds, selectedEntityIds, widgetValues, stackOrder,
    } = state;
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
      const z = entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.widget);

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
        // A slider's instance is its TRACK, which stops short of the readout (widget-geometry.ts).
        const drawWidth = config.type === 'slider' ? sliderTrackWidth(box) : box.width;
        buffers.size[n * 2] = drawWidth;
        buffers.size[n * 2 + 1] = box.height;
        // The control half of the entity's radius level; the checkbox's radius is computed
        // in-shader from its own side, so this is the well's alone. The shader clamps it to half
        // the box, which is what turns the `full` level's 9999 into a pill rather than an
        // overflow — the same `calc(height / 2)` v2 gives a control at that level.
        buffers.radius[n] = wellRadius(config.type, resolvedStyle.widgetRadius, socketLayout.widgetHeight);
        buffers.kind[n] = kindFor(config.type, value);
        buffers.value[n] = config.type === 'slider' ? sliderFraction(value, config) : 0;
        if (config.type === 'color') {
          writeColor(value, buffers.tint, n * 3);
        } else {
          buffers.tint[n * 3] = 0;
          buffers.tint[n * 3 + 1] = 0;
          buffers.tint[n * 3 + 2] = 0;
        }
        // Written unconditionally rather than only when lit, because these buffers are reused across
        // frames and instance `n` is a different widget from one frame to the next — a conditional
        // write would leave the previous occupant's state behind and light the wrong well. A key a
        // tracker does not hold is at its state and has been for ever: SETTLED is a start every
        // duration has long since elapsed from, so the shader's ease clamps to 1 and nothing moves.
        const colour = colourLevel(key, entity.id, socket.id, state);
        buffers.hover[n] = colour;
        const colourT = colourTrack.read(key);
        buffers.anim[n * 4] = colourT ? colourT.from : colour;
        buffers.anim[n * 4 + 1] = colourT ? colourT.start : SETTLED;
        const checked = buffers.kind[n] === KIND.checkboxOn ? 1 : 0;
        const checkT = config.type === 'checkbox' ? checkTrack.read(key) : undefined;
        buffers.anim[n * 4 + 2] = checkT ? checkT.from : checked;
        buffers.anim[n * 4 + 3] = checkT ? checkT.start : SETTLED;
        const pressed = pressLevel(key, state);
        const pressT = pressTrack.read(key);
        buffers.motion[n * 3] = pressT ? pressT.from : pressed;
        buffers.motion[n * 3 + 1] = pressT ? pressT.start : SETTLED;
        buffers.motion[n * 3 + 2] = pressed;
        const ringT = ringTrack.read(key);
        buffers.ring[n * 2] = ringLevel(key, state);
        buffers.ring[n * 2 + 1] = ringT ? ringT.start : SETTLED;

        tempMatrix.identity();
        tempMatrix.setPosition(box.x + drawWidth / 2, -(box.y + box.height / 2), z);
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
      if (buffers.animAttr) { buffers.animAttr.addUpdateRange(0, count * 4); buffers.animAttr.needsUpdate = true; }
      if (buffers.motionAttr) { buffers.motionAttr.addUpdateRange(0, count * 3); buffers.motionAttr.needsUpdate = true; }
      if (buffers.ringAttr) { buffers.ringAttr.addUpdateRange(0, count * 2); buffers.ringAttr.needsUpdate = true; }
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
