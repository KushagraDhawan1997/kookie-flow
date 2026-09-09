/**
 * On-node widget chrome, drawn in WebGL.
 *
 * THE RULE THIS IMPLEMENTS: everything persistent renders in GL; the DOM appears only
 * transiently, for one field, during an active edit, and then vanishes. Widgets were the last
 * persistent DOM in the graph — seven React components per socket, each a real design-system
 * control, mounted for every visible entity. At a thousand nodes that is thousands of composited
 * layers, which is the measured reason the label path was deleted before it.
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
import { useSocketLayout, useResolvedStyle } from '../contexts/StyleContext';
import { getWidgetBox } from '../utils/widget-geometry';
import { resolveWidgetConfig } from '../utils/widgets';
import { THEME_COLORS } from '../core/theme-colors';
import { resolveTokenColor } from '../utils/style-resolver';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import type { SocketType, ResolvedWidgetConfig, WidgetType } from '../types';

const BUFFER_GROWTH_FACTOR = 1.5;
const INITIAL_CAPACITY = 64;
const MAX_CAPACITY = 20000;

/** Widgets stop drawing below this zoom — at that size they are noise, not controls. */
const MIN_WIDGET_ZOOM = 0.4;

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

/** Parse a widget's colour value to RGB, falling back to mid-grey rather than throwing. */
function colorOf(value: unknown): [number, number, number] {
  if (typeof value !== 'string') return [0.5, 0.5, 0.5];
  const hex = value.trim().replace('#', '');
  if (hex.length !== 6) return [0.5, 0.5, 0.5];
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

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

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;

  void main() {
    vUv = uv;
    vSize = aSize;
    vKind = aKind;
    vValue = aValue;
    vTint = aTint;
    vec3 pos = vec3(position.xy * aSize, position.z);
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
  uniform float uBorderWidth;

  varying vec2 vUv;
  varying vec2 vSize;
  varying float vKind;
  varying float vValue;
  varying vec3 vTint;

  // Clamped exactly as nodes.tsx clamps it, and for the same reason: past r = min(b.x, b.y)
  // every fragment lands outside the shape and the box erases itself.
  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vSize;
    vec2 half = vSize * 0.5;

    vec3 color = uFill;
    float alpha = 0.0;
    // One pixel of the world, so the antialiasing is the same width at every zoom.
    float aa = fwidth(p.x) * 0.75 + 1e-5;

    if (vKind < 2.5 && vKind > 0.5) {
      // ---- checkbox: a square mark at the left of the row, not the whole row ----
      float side = min(vSize.y, 18.0);
      vec2 b = vec2(side * 0.5);
      vec2 cp = p - vec2(-half.x + side * 0.5, 0.0);
      float d = roundedBoxSDF(cp, b, min(4.0, side * 0.25));
      float inside = 1.0 - smoothstep(-aa, aa, d);
      float on = step(1.5, vKind);
      vec3 boxFill = mix(uTrack, uActive, on);
      float ring = 1.0 - smoothstep(-aa, aa, d + uBorderWidth);
      color = mix(uBorder, boxFill, ring);
      alpha = inside;

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
    } else if (vKind > 2.5 && vKind < 3.5) {
      // ---- slider: a channel, a filled portion, and a grip ----
      float trackH = min(4.0, vSize.y * 0.25);
      float d = roundedBoxSDF(p, vec2(half.x, trackH * 0.5), trackH * 0.5);
      alpha = 1.0 - smoothstep(-aa, aa, d);
      float fillEdge = -half.x + vSize.x * vValue;
      color = mix(uActive, uTrack, step(fillEdge, p.x));

      // The grip rides the fill edge, inset by its own radius so it never leaves the channel —
      // the same wall rule a segmented control's thumb obeys.
      float gr = min(vSize.y * 0.5, 8.0);
      float gx = clamp(fillEdge, -half.x + gr, half.x - gr);
      float gd = length(p - vec2(gx, 0.0)) - gr;
      float grip = 1.0 - smoothstep(-aa, aa, gd);
      float gripRing = 1.0 - smoothstep(-aa, aa, gd + uBorderWidth);
      color = mix(color, mix(uBorder, uThumb, gripRing), grip);
      alpha = max(alpha, grip);
    } else {
      // ---- field, select, colour: a well with a hairline ----
      float d = roundedBoxSDF(p, half, min(aaRadius(), min(half.x, half.y)));
      float inside = 1.0 - smoothstep(-aa, aa, d);
      float ring = 1.0 - smoothstep(-aa, aa, d + uBorderWidth);
      // A colour widget's fill IS its value; everything else takes the field well.
      vec3 base = vKind > 4.5 ? vTint : uFill;
      color = mix(uBorder, base, ring);
      alpha = inside;

      if (vKind > 3.5 && vKind < 4.5) {
        // The select's chevron, at the trailing edge. Two segments, same construction as the tick.
        vec2 c = p - vec2(half.x - 10.0, 0.0);
        float a1 = abs(dot(c - vec2(-2.0, -1.0), normalize(vec2(1.0, 1.0))));
        float s1 = step(-4.0, c.x) * step(c.x, 0.0);
        float a2 = abs(dot(c - vec2(2.0, -1.0), normalize(vec2(1.0, -1.0))));
        float s2 = step(0.0, c.x) * step(c.x, 4.0);
        float chev = max(s1 * (1.0 - smoothstep(0.0, 1.1, a1)),
                         s2 * (1.0 - smoothstep(0.0, 1.1, a2)));
        color = mix(color, uBorder, chev * inside);
      }
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`
  // `aaRadius` is written as a call so the radius stays one expression; GLSL has no default
  // arguments, so it is substituted here rather than passed as a seventh attribute.
  .replace(/aaRadius\(\)/g, 'aRadiusV');

function createBuffers(capacity: number) {
  return {
    size: new Float32Array(capacity * 2),
    radius: new Float32Array(capacity),
    kind: new Float32Array(capacity),
    value: new Float32Array(capacity),
    tint: new Float32Array(capacity * 3),
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
    radiusAttr: null as THREE.InstancedBufferAttribute | null,
    kindAttr: null as THREE.InstancedBufferAttribute | null,
    valueAttr: null as THREE.InstancedBufferAttribute | null,
    tintAttr: null as THREE.InstancedBufferAttribute | null,
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
  const resolved = useResolvedStyle();

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);
  const [capacity, setCapacity] = useState(INITIAL_CAPACITY);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  const c = THEME_COLORS.widget;
  const material = useMemo(() => {
    const rgb = (key: (typeof THEME_COLORS)['widget'][keyof (typeof THEME_COLORS)['widget']]) => {
      const v = resolveTokenColor(key, tokens);
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
        uBorderWidth: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [tokens, c]);
  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { material.dispose(); }, [material]);

  const buffers = useMemo(() => createBuffers(capacity), [capacity]);
  useEffect(() => { initializedRef.current = false; }, [buffers]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    buffers.sizeAttr = new THREE.InstancedBufferAttribute(buffers.size, 2);
    buffers.radiusAttr = new THREE.InstancedBufferAttribute(buffers.radius, 1);
    buffers.kindAttr = new THREE.InstancedBufferAttribute(buffers.kind, 1);
    buffers.valueAttr = new THREE.InstancedBufferAttribute(buffers.value, 1);
    buffers.tintAttr = new THREE.InstancedBufferAttribute(buffers.tint, 3);
    for (const a of [buffers.sizeAttr, buffers.radiusAttr, buffers.kindAttr, buffers.valueAttr, buffers.tintAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.geometry.setAttribute('aSize', buffers.sizeAttr);
    mesh.geometry.setAttribute('aRadiusV', buffers.radiusAttr);
    mesh.geometry.setAttribute('aKind', buffers.kindAttr);
    mesh.geometry.setAttribute('aValue', buffers.valueAttr);
    mesh.geometry.setAttribute('aTint', buffers.tintAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    initializedRef.current = true;
    dirtyRef.current = true;
  }, [buffers]);

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
    ];
    return () => { for (const u of unsubs) u(); };
  }, [store]);

  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;

    const { entities, viewport, connectedSockets, hiddenEntityIds } = store.getState();
    if (viewport.zoom < minWidgetZoom) {
      mesh.count = 0;
      return;
    }

    // Cull to the viewport, in world units, the way every other layer here does.
    const pad = 200 / viewport.zoom;
    const left = -viewport.x / viewport.zoom - pad;
    const top = -viewport.y / viewport.zoom - pad;
    const right = left + size.width / viewport.zoom + pad * 2;
    const bottom = top + size.height / viewport.zoom + pad * 2;

    const m = new THREE.Matrix4();
    let n = 0;
    let needed = 0;

    for (const entity of entities) {
      if (hiddenEntityIds.has(entity.id)) continue;
      const inputs = entity.inputs ?? [];
      if (inputs.length === 0) continue;
      if (
        entity.position.x > right ||
        entity.position.y > bottom ||
        entity.position.x + (entity.width ?? defaultEntityWidth) < left
      ) continue;

      for (let i = 0; i < inputs.length; i++) {
        const socket = inputs[i];
        if (connectedSockets.has(`${entity.id}:${socket.id}:input`)) continue;
        const config = resolveWidgetConfig(socket, socketTypes);
        if (!config) continue;

        needed++;
        if (n >= capacity) continue;

        const box = getWidgetBox(entity, i, socketLayout, defaultEntityWidth, socketLabelWidth);
        if (!box) continue;
        if (box.y > bottom || box.y + box.height < top) continue;

        // A widget's value lives on the ENTITY, keyed by socket id — `entity.data.values[id]` —
        // which is the same place the DOM widgets read it from. A socket carries its shape, not
        // its state.
        const values = (entity.data as { values?: Record<string, unknown> } | undefined)?.values;
        const value = values?.[socket.id] ?? config.defaultValue;
        buffers.size[n * 2] = box.width;
        buffers.size[n * 2 + 1] = box.height;
        buffers.radius[n] = Math.min(resolved.borderRadius, box.height * 0.5);
        buffers.kind[n] = kindFor(config.type, value);
        buffers.value[n] = config.type === 'slider' ? sliderFraction(value, config) : 0;
        const tint = config.type === 'color' ? colorOf(value) : [0, 0, 0];
        buffers.tint[n * 3] = tint[0];
        buffers.tint[n * 3 + 1] = tint[1];
        buffers.tint[n * 3 + 2] = tint[2];

        m.identity();
        m.setPosition(box.x + box.width / 2, -(box.y + box.height / 2), 0.05);
        m.toArray(mesh.instanceMatrix.array as unknown as number[], n * 16);
        n++;
      }
    }

    if (needed > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(needed * BUFFER_GROWTH_FACTOR)));
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (buffers.sizeAttr) buffers.sizeAttr.needsUpdate = true;
    if (buffers.radiusAttr) buffers.radiusAttr.needsUpdate = true;
    if (buffers.kindAttr) buffers.kindAttr.needsUpdate = true;
    if (buffers.valueAttr) buffers.valueAttr.needsUpdate = true;
    if (buffers.tintAttr) buffers.tintAttr.needsUpdate = true;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      // Named so a law can identify this mesh rather than infer it from geometry type and render
      // order — `PlaneGeometry:r3` is shared with the edges' foreground pass, and a probe that
      // matched on it would be reporting whichever mesh it happened to find.
      name="widgets"
      args={[geometry, material, capacity]}
      frustumCulled={false}
      renderOrder={3}
    />
  );
}

export { KIND as WIDGET_KIND, kindFor, sliderFraction, colorOf };
