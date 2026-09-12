/**
 * A widget's floating panel — a select's list, a colour widget's picker — drawn in WebGL.
 *
 * WHAT THIS REPLACED. A select used to borrow the platform's `<select>` for the length of an edit
 * and open its picker with `showPicker()`. The picker is a native popup: it cannot be styled, it
 * does not scale with the node, it opens wherever the platform decides — measured, at the top-left
 * of the window on a scaled canvas — and the switch from GL glyphs to a DOM control and back was
 * visible on both edges. A colour widget borrowed `<input type="color">` for the same reasons and
 * got the same popup. Both are gone: the panel is two draw calls here, positioned in world units
 * off the trigger's own box, and the list scrolls, flips and type-aheads exactly as a platform list
 * does, from the canvas's keyboard handler.
 *
 * TWO DRAW CALLS. One quad for the panel — its shadow, its blurred ground, the glass on top, the
 * lit row, the selected mark, and for a colour picker the saturation square, the hue strip and
 * both cursors, all in one fragment shader — and one instanced MSDF mesh for the text. Both sit in
 * a group scaled about the panel's anchor for the entrance, so opening costs uniform writes and no
 * buffer traffic.
 *
 * THE GROUND IS REAL. Just before the panel draws, the pixels already under it are copied out of
 * the frame (gl/backdrop.ts) and the shader blurs and saturates them the way `backdrop-filter`
 * would. That copy is a few hundred pixels a side and happens only while a panel is open.
 *
 * NOTHING HERE HANDLES INPUT. The pointer and keyboard live in kookie-flow.tsx and write to the
 * store — `popoverIndex`, `popoverScroll`, `popoverHsv` — and this layer repaints from those on
 * its dirty flag, the same way every other GL layer here works.
 */

import { useRef, useMemo, useEffect } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle, useSocketLayout } from '../contexts/StyleContext';
import { useFont } from '../contexts/FontContext';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { msdfVertexShader, msdfFragmentShaderFaded, MSDF_SHADER_DEFAULTS } from '../utils/msdf-shader';
import { populateGlyphBuffers, truncateText, type TextEntry } from '../utils/text-layout';
import {
  popoverLayoutFor,
  POPOVER_PAD,
  ROW_PAD_X,
  ROW_CHECK_RESERVE,
  ROW_CHECK_X,
  ROW_PAD_END,
  POPOVER_SHADOW_PAD,
  type PopoverLayout,
} from '../utils/popover-layout';
import { hsvToHex } from '../utils/hsv';
import {
  SDF_GLSL,
  GLASS_GLSL,
  EASE_GLSL,
  BACKDROP_GLSL,
  BackdropSnapshot,
  motionNow,
  easeOutCubic,
  springElastic,
  MATERIAL,
  MOTION,
  CORNER_K_FLOATING_ROWS,
  type RGBA,
} from '../gl';

/** Above every entity: the depth ladder tops out at 0 (utils/entity-depth.ts). */
const POPOVER_Z = 50;
/** Past the text layer (6) and the resize handles (6.5), so the panel covers them. */
const RENDER_ORDER_PANEL = 20;
const RENDER_ORDER_TEXT = 21;
/** The entrance: v2's `--floating-fall` on its elastic spring. */
const OPEN_DURATION = MOTION.floatingFall;
/** Glyph capacity: eight rows of long options, or one hex readout. Grown if ever exceeded. */
const TEXT_CAPACITY = 1024;
/**
 * The disc blur's radius from v2's gaussian `blur(4px)`: a disc of about two and a half sigma
 * reads as the same softness. In CSS px; scaled by the device pixel ratio at draw time.
 */
const BLUR_RADIUS_PER_SIGMA = 2.5;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uRowRadius;
  uniform float uCornerK;
  uniform float uShadowPad;
  uniform float uKind;
  uniform float uOpen;
  uniform float uBlur;

  // The material (gl/material.ts): the floating surface's fill over the filtered ground, its
  // ring, its border, its grain and its three-layer cast.
  uniform vec3 uTint;
  uniform float uTintA;
  uniform float uSaturate;
  uniform float uBrightness;
  uniform vec4 uRingTop;
  uniform vec4 uRingUpper;
  uniform vec4 uRingSide;
  uniform vec4 uRingBottom;
  uniform vec4 uBorder;
  uniform vec2 uWash;
  uniform float uPool;
  uniform float uTopLine;
  uniform float uGrain;
  uniform vec4 uCast[3];
  uniform vec4 uCastColor[3];
  uniform vec4 uRow;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec3 uRowInk;
  uniform float uRowSolid;

  // Select: the row band, and which rows are lit and chosen (in visible-row units, -1 for none).
  uniform float uRowHeight;
  uniform float uPad;
  uniform float uCheckX;
  uniform float uHighlight;
  uniform float uSelected;

  // Colour: the picker's two controls in panel-local top-left coordinates, and its value.
  uniform vec4 uSvRect;
  uniform vec4 uHueRect;
  uniform vec3 uHsv;

  varying vec2 vUv;

  ${SDF_GLSL}
  ${GLASS_GLSL}
  ${EASE_GLSL}
  ${BACKDROP_GLSL}

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  // A picker cursor: the colour under it, a white ring, a faint dark ring outside that so it
  // reads on a white square as well as a black one.
  vec4 cursor(vec4 acc, vec2 p, vec3 fill, float aa) {
    float d = sdCircle(p, 6.0);
    acc = over(acc, vec3(0.0), fillSDF(d - 1.0, aa) * 0.25);
    acc = over(acc, vec3(1.0), fillSDF(d, aa));
    acc = over(acc, fill, fillSDF(d + 2.0, aa));
    return acc;
  }

  void main() {
    vec2 hs = uSize * 0.5;
    vec2 p = (vUv - 0.5) * (uSize + 2.0 * uShadowPad);
    // Panel-local, top-left origin, y down: what the layout is written in.
    vec2 l = vec2(p.x + hs.x, hs.y - p.y);
    float aa = fwidth(p.x) * 0.75 + 1e-5;
    // The squircle v2 draws a floating-rows surface with: the corner token times its k.
    float r = uRadius * uCornerK;
    float d = sdSquircleBox(p, hs, r);
    float inside = fillSDF(d, aa);

    vec4 acc = vec4(0.0);

    // --shadow-3: three layers, each the shape moved down, grown by its spread, and blurred.
    for (int i = 0; i < 3; i++) {
      float dc = sdSquircleBox(p - vec2(0.0, -uCast[i].x), hs + uCast[i].z, r + uCast[i].z);
      acc = glassCast(acc, dc, d, uCast[i].y, uCastColor[i]);
    }

    // The ground, blurred, saturated and lifted as backdrop-filter does it, under the fill.
    vec3 ground = filterGround(blurBackdrop(gl_FragCoord.xy, uBlur), uSaturate, uBrightness);
    acc = over(acc, mix(ground, uTint, uTintA), inside);
    // The floating wash: the radial glint at the top-left and the top-down white.
    acc = glassWash(acc, inside, l / uSize, uWash.x, uWash.y);
    // inset 0 -10px 20px -14px: the hole is the panel moved up 10 and grown by 14.
    acc = glassInset(acc, inside, sdSquircleBox(p - vec2(0.0, 10.0), hs + 14.0, r + 14.0), 20.0, uPool);
    // inset 0 1px 0 white, dark only: the one pixel the panel's own shape moved down leaves bare.
    float dDown = sdSquircleBox(p + vec2(0.0, 1.0), hs, r);
    acc = over(acc, vec3(1.0), inside * uTopLine * (1.0 - fillSDF(dDown, aa)));
    acc = glassGrain(acc, inside, gl_FragCoord.xy, uGrain);

    if (uKind < 0.5) {
      // ---- the list: pill rows, one lit, one marked ----
      if (uHighlight >= 0.0) {
        float top = uPad + uHighlight * uRowHeight;
        vec2 rb = vec2((uSize.x - 2.0 * uPad) * 0.5, uRowHeight * 0.5);
        vec2 rc = vec2(uPad + rb.x, top + rb.y);
        // A row is a control, and a control's corner is round — only the panel is a squircle.
        float dr = sdRoundedBox(l - rc, rb, uRowRadius);
        acc = overC(acc, uRow, fillSDF(dr, aa) * inside);
        // A solid row hides the grain and the wash under it, as a painted row does.
        acc = over(acc, uRow.rgb, fillSDF(dr, aa) * inside * uRowSolid);
      }
      if (uSelected >= 0.0) {
        float cy = uPad + (uSelected + 0.5) * uRowHeight;
        // v2 puts the tick in a leading gutter, in the accent.
        vec2 cp = vec2(l.x - (uPad + uCheckX), cy - l.y);
        float dt = sdTick(cp, 20.0, 1.0);
        acc = over(acc, uAccent, fillSDF(dt, aa) * inside);
      }
    } else {
      // ---- the picker ----
      vec2 svc = uSvRect.xy + uSvRect.zw * 0.5;
      float dsv = sdRoundedBox(l - svc, uSvRect.zw * 0.5, uRowRadius);
      vec2 st = clamp((l - uSvRect.xy) / uSvRect.zw, 0.0, 1.0);
      vec3 svColor = hsv2rgb(vec3(uHsv.x, st.x, 1.0 - st.y));
      acc = over(acc, svColor, fillSDF(dsv, aa));
      acc = overC(acc, uBorder, ringSDF(dsv, 1.0, aa));

      vec2 hc = uHueRect.xy + uHueRect.zw * 0.5;
      float dh = sdRoundedBox(l - hc, uHueRect.zw * 0.5, uHueRect.w * 0.5);
      float ht = clamp((l.x - uHueRect.x) / uHueRect.z, 0.0, 1.0);
      acc = over(acc, hsv2rgb(vec3(ht, 1.0, 1.0)), fillSDF(dh, aa));
      acc = overC(acc, uBorder, ringSDF(dh, 1.0, aa));

      vec3 current = hsv2rgb(uHsv);
      vec2 svCursor = uSvRect.xy + vec2(uHsv.y, 1.0 - uHsv.z) * uSvRect.zw;
      acc = cursor(acc, l - svCursor, current, aa);
      vec2 hueCursor = vec2(uHueRect.x + uHsv.x * uHueRect.z, hc.y);
      acc = cursor(acc, l - hueCursor, hsv2rgb(vec3(uHsv.x, 1.0, 1.0)), aa);
    }

    // The edge: v2's ::after ring at the floating opacity, on the outermost pixel. A floating panel
    // has no border of its own — the ring is the whole edge.
    acc = glassRing(acc, d, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 0.6);

    acc.a *= uOpen;
    if (acc.a < 0.004) discard;
    gl_FragColor = acc;
  }
`;

const SCREEN_ORIGIN = new THREE.Vector2();

export function WidgetPopoverGL() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const socketLayout = useSocketLayout();
  const resolvedStyle = useResolvedStyle();
  const font = useFont().regular;
  const { gl, size } = useThree();

  const groupRef = useRef<THREE.Group>(null);
  const panelRef = useRef<THREE.Mesh>(null);
  const textRef = useRef<THREE.InstancedMesh>(null);
  const dirtyRef = useRef(true);
  const layoutRef = useRef<PopoverLayout | null>(null);
  const entriesRef = useRef<TextEntry[]>([]);
  const snapshot = useMemo(() => new BackdropSnapshot(), []);
  useEffect(() => () => snapshot.dispose(), [snapshot]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const textGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { geometry.dispose(); textGeometry.dispose(); }, [geometry, textGeometry]);

  const appearance = tokens.appearance;
  const reducedMotion = usePrefersReducedMotion();
  const material = useMemo(() => {
    const m = MATERIAL[appearance];
    const rgb = (v: readonly number[]) => new THREE.Color(v[0], v[1], v[2]);
    const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
    const highContrast = tokens.contrast === 'high';
    const canvasBg = resolveColor(THEME_COLORS.canvas.background, tokens);
    // The floating fill: v2's `--color-surface` in light, and in dark that surface mixed twelve
    // percent toward white — a floating panel sits a step above the card it floats over.
    const surface = resolveColor(THEME_COLORS.widget.thumb, tokens);
    const tint = appearance === 'dark'
      ? resolveColor({ light: '--neutral-1', dark: '--neutral-2' }, tokens).map((v) => v * 0.88 + 0.12)
      : surface;
    return new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 8 },
        uRowRadius: { value: 8 },
        uCornerK: { value: CORNER_K_FLOATING_ROWS },
        uShadowPad: { value: POPOVER_SHADOW_PAD },
        uKind: { value: 0 },
        uOpen: { value: 0 },
        uBlur: { value: m.surfaceBlur * BLUR_RADIUS_PER_SIGMA },
        uTint: { value: rgb(tint) },
        uTintA: { value: m.floatingAlpha },
        uSaturate: { value: m.surfaceSaturate },
        uBrightness: { value: m.surfaceBrightness },
        uRingTop: { value: rgba(m.surfaceRing.top) },
        uRingUpper: { value: rgba(m.surfaceRing.upper) },
        uRingSide: { value: rgba(m.surfaceRing.side) },
        uRingBottom: { value: rgba(m.surfaceRing.bottom) },
        uBorder: { value: rgba(m.glassBorder) },
        uWash: { value: new THREE.Vector2(m.floatingWashRadial, m.floatingWashLinear) },
        uPool: { value: m.floatingPool },
        uTopLine: { value: m.floatingTopLine },
        uGrain: { value: m.grain },
        uCast: { value: m.floatingCast.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)) },
        uCastColor: { value: m.floatingCast.map((l) => rgba(l.color)) },
        uRow: {
          value: highContrast
            ? new THREE.Vector4(...resolveColor(THEME_COLORS.widget.active, tokens), 1)
            : rgba(m.rowWash),
        },
        uInk: { value: rgb(resolveColor(THEME_COLORS.text.primary, tokens)) },
        // The selected row's tick: v2's `--accent-glyph`, not the solid accent.
        uAccent: { value: rgb(resolveColor(THEME_COLORS.widget.glyph, tokens)) },
        // High contrast turns the lit row into a solid fill with contrast ink under it.
        uRowInk: { value: rgb(resolveColor(THEME_COLORS.widget.activeContrast, tokens)) },
        uRowSolid: { value: highContrast ? 1 : 0 },
        uRowHeight: { value: 28 },
        uPad: { value: POPOVER_PAD },
        uCheckX: { value: ROW_CHECK_X },
        uHighlight: { value: -1 },
        uSelected: { value: -1 },
        uSvRect: { value: new THREE.Vector4() },
        uHueRect: { value: new THREE.Vector4() },
        uHsv: { value: new THREE.Vector3() },
        uBackdrop: { value: null },
        uBackdropOrigin: { value: new THREE.Vector2() },
        uBackdropSize: { value: new THREE.Vector2(1, 1) },
        uCanvasBg: { value: rgb(canvasBg) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }, [tokens, appearance]);
  useEffect(() => () => { material.dispose(); }, [material]);

  const textMaterial = useMemo(() => {
    if (!font) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: font.texture },
        uThreshold: { value: MSDF_SHADER_DEFAULTS.threshold },
        uAlphaTest: { value: MSDF_SHADER_DEFAULTS.alphaTest },
        uOpacity: { value: 0 },
      },
      vertexShader: msdfVertexShader,
      fragmentShader: msdfFragmentShaderFaded,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [font]);
  useEffect(() => () => { textMaterial?.dispose(); }, [textMaterial]);

  const textBuffers = useMemo(
    () => ({
      uvOffsets: new Float32Array(TEXT_CAPACITY * 4),
      colors: new Float32Array(TEXT_CAPACITY * 3),
      opacities: new Float32Array(TEXT_CAPACITY),
      uvOffsetAttr: null as THREE.InstancedBufferAttribute | null,
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      opacityAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    []
  );

  useEffect(() => {
    const mesh = textRef.current;
    if (!mesh) return;
    textBuffers.uvOffsetAttr = new THREE.InstancedBufferAttribute(textBuffers.uvOffsets, 4);
    textBuffers.colorAttr = new THREE.InstancedBufferAttribute(textBuffers.colors, 3);
    textBuffers.opacityAttr = new THREE.InstancedBufferAttribute(textBuffers.opacities, 1);
    for (const a of [textBuffers.uvOffsetAttr, textBuffers.colorAttr, textBuffers.opacityAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.geometry.setAttribute('aUvOffset', textBuffers.uvOffsetAttr);
    mesh.geometry.setAttribute('aColor', textBuffers.colorAttr);
    mesh.geometry.setAttribute('aOpacity', textBuffers.opacityAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dirtyRef.current = true;
  }, [textBuffers, textMaterial]);

  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubs = [
      store.subscribe((s) => s.widgetPopover, markDirty),
      store.subscribe((s) => s.popoverIndex, markDirty),
      store.subscribe((s) => s.popoverScroll, markDirty),
      store.subscribe((s) => s.popoverVersion, markDirty),
      store.subscribe((s) => s.viewport, markDirty),
    ];
    return () => { for (const u of unsubs) u(); };
  }, [store]);
  useEffect(() => { dirtyRef.current = true; }, [size.width, size.height, material, font]);

  const inkHex = rgbToHex(resolveColor(THEME_COLORS.text.primary, tokens));
  const rowInkHex = rgbToHex(resolveColor(THEME_COLORS.widget.activeContrast, tokens));
  const highContrast = tokens.contrast === 'high';

  /**
   * The copy of the ground, taken right before the panel draws — see gl/backdrop.ts. Bound as
   * `onBeforeRender` so it reads the frame with everything under the panel already in it.
   */
  const capture = useMemo(
    () => () => {
      const layout = layoutRef.current;
      if (!layout) return;
      const { viewport } = store.getState();
      const dpr = gl.getPixelRatio();
      const pad = POPOVER_SHADOW_PAD;
      const x0 = ((layout.x - pad) * viewport.zoom + viewport.x) * dpr;
      const x1 = ((layout.x + layout.width + pad) * viewport.zoom + viewport.x) * dpr;
      const yTop = ((layout.y - pad) * viewport.zoom + viewport.y) * dpr;
      const yBot = ((layout.y + layout.height + pad) * viewport.zoom + viewport.y) * dpr;
      const fbH = gl.getSize(SCREEN_ORIGIN).y * dpr;
      const tex = snapshot.ensure(x1 - x0, yBot - yTop);
      snapshot.capture(gl, x0, fbH - yBot);
      material.uniforms.uBackdrop.value = tex;
      (material.uniforms.uBackdropOrigin.value as THREE.Vector2).set(snapshot.x, snapshot.y);
      (material.uniforms.uBackdropSize.value as THREE.Vector2).set(snapshot.width, snapshot.height);
      material.uniforms.uBlur.value = MATERIAL[appearance].surfaceBlur * BLUR_RADIUS_PER_SIGMA * dpr;
    },
    [gl, material, snapshot, store]
  );

  useFrame(() => {
    const group = groupRef.current;
    const panel = panelRef.current;
    const text = textRef.current;
    if (!group || !panel || !text) return;
    const s = store.getState();
    const pop = s.widgetPopover;
    if (!pop) {
      if (group.visible) {
        group.visible = false;
        layoutRef.current = null;
        text.count = 0;
      }
      return;
    }

    // The entrance: uniforms only, on the frames it lasts.
    // The entrance: v2's elastic spring on the size — it overshoots by a few percent and
    // settles — with the fade done in the first third of it.
    // Reduced motion: v2 turns a panel's animation off, so it is simply there.
    const t = reducedMotion ? 1 : (motionNow() - pop.openedAt) / OPEN_DURATION;
    const entering = t < 1;
    if (entering || dirtyRef.current) {
      const fade = easeOutCubic(t * 3);
      material.uniforms.uOpen.value = fade;
      if (textMaterial) textMaterial.uniforms.uOpacity.value = fade;
      group.scale.setScalar(0.92 + 0.08 * springElastic(t));
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;

    const layout = popoverLayoutFor(
      pop,
      socketLayout.listRowHeight,
      resolvedStyle.widgetRadius,
      resolvedStyle.widgetPad,
      s.viewport,
      size
    );
    layoutRef.current = layout;
    group.visible = true;

    // v2 grows a panel out of its trigger's own box, so the scale is about the trigger's centre.
    const ax = layout.anchorX;
    const ay = layout.anchorY;
    group.position.set(ax, -ay, POPOVER_Z);
    panel.position.set(layout.x + layout.width / 2 - ax, -(layout.y + layout.height / 2) + ay, 0);
    panel.scale.set(layout.width + 2 * POPOVER_SHADOW_PAD, layout.height + 2 * POPOVER_SHADOW_PAD, 1);

    const u = material.uniforms;
    (u.uSize.value as THREE.Vector2).set(layout.width, layout.height);
    u.uRadius.value = layout.radius;
    u.uRowRadius.value = layout.kind === 'select' ? layout.rowRadius : 8;
    u.uCornerK.value = CORNER_K_FLOATING_ROWS;

    const entries = entriesRef.current;
    entries.length = 0;

    if (layout.kind === 'select') {
      u.uKind.value = 0;
      u.uRowHeight.value = layout.rowHeight;
      const scroll = s.popoverScroll;
      const hi = s.popoverIndex - scroll;
      u.uHighlight.value = hi >= 0 && hi < layout.visible ? hi : -1;
      const selected = pop.options.indexOf(pop.value) - scroll;
      u.uSelected.value = selected >= 0 && selected < layout.visible ? selected : -1;

      if (font) {
        const rowFont = resolvedStyle.widgetFontSize;
        const maxWidth = layout.width - 2 * POPOVER_PAD - ROW_PAD_X - ROW_CHECK_RESERVE - ROW_PAD_END;
        const x = layout.x + POPOVER_PAD + ROW_PAD_X + ROW_CHECK_RESERVE - ax;
        for (let i = 0; i < layout.visible; i++) {
          const row = scroll + i;
          if (row >= pop.options.length) break;
          const top = layout.y + POPOVER_PAD + i * layout.rowHeight;
          entries.push({
            text: truncateText(pop.options[row], maxWidth, rowFont, font.metrics.info.size, font.glyphMap, font.kerningMap),
            // The same visual centring the widget readouts use.
            position: [x, top + layout.rowHeight / 2 - (rowFont * 7) / 12 - ay, 0.5],
            fontSize: rowFont,
            // Under high contrast the lit row is a solid fill, so its label takes the contrast ink.
            color: highContrast && row === s.popoverIndex ? rowInkHex : inkHex,
            anchor: 'left',
          });
        }
      }
    } else {
      u.uKind.value = 1;
      const hsv = s.popoverHsv;
      (u.uHsv.value as THREE.Vector3).set(hsv[0], hsv[1], hsv[2]);
      (u.uSvRect.value as THREE.Vector4).set(layout.sv.x - layout.x, layout.sv.y - layout.y, layout.sv.width, layout.sv.height);
      (u.uHueRect.value as THREE.Vector4).set(layout.hue.x - layout.x, layout.hue.y - layout.y, layout.hue.width, layout.hue.height);
      if (font) {
        entries.push({
          text: hsvToHex(hsv[0], hsv[1], hsv[2]).toUpperCase(),
          position: [0, layout.hexY - (resolvedStyle.widgetFontSize * 7) / 12 - ay, 0.5],
          fontSize: resolvedStyle.widgetFontSize,
          color: inkHex,
          anchor: 'center',
        });
      }
    }

    if (!font || !textBuffers.uvOffsetAttr || !textBuffers.colorAttr || !textBuffers.opacityAttr) {
      text.count = 0;
      return;
    }
    const count = Math.min(
      populateGlyphBuffers(
        entries,
        font.metrics,
        font.glyphMap,
        font.kerningMap,
        text.instanceMatrix.array as Float32Array,
        textBuffers.uvOffsets,
        textBuffers.colors,
        textBuffers.opacities,
        TEXT_CAPACITY
      ),
      TEXT_CAPACITY
    );
    text.count = count;
    if (count > 0) {
      text.instanceMatrix.addUpdateRange(0, count * 16);
      text.instanceMatrix.needsUpdate = true;
      textBuffers.uvOffsetAttr.addUpdateRange(0, count * 4);
      textBuffers.uvOffsetAttr.needsUpdate = true;
      textBuffers.colorAttr.addUpdateRange(0, count * 3);
      textBuffers.colorAttr.needsUpdate = true;
      textBuffers.opacityAttr.addUpdateRange(0, count);
      textBuffers.opacityAttr.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh
        ref={panelRef}
        name="widget-popover"
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={RENDER_ORDER_PANEL}
        onBeforeRender={capture}
      />
      {textMaterial ? (
        <instancedMesh
          ref={textRef}
          name="widget-popover-text"
          args={[textGeometry, textMaterial, TEXT_CAPACITY]}
          frustumCulled={false}
          renderOrder={RENDER_ORDER_TEXT}
        />
      ) : null}
    </group>
  );
}
