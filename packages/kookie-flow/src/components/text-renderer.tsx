/**
 * TextRenderer - High-performance WebGL text rendering using instanced MSDF
 *
 * Renders all text labels (entity headers, socket labels, edge labels) using
 * Multi-channel Signed Distance Field (MSDF) technique.
 *
 * Supports multiple font weights with separate InstancedMesh per weight
 * for optimal performance (one draw call per weight).
 *
 * Key optimizations:
 * - InstancedMesh per weight = minimal draw calls
 * - Pre-allocated buffers with dirty flags = zero GC pressure
 * - RAF-synchronized updates via useFrame
 * - LOD: hide text below zoom thresholds
 */

import { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback, use } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useEntityStyle, useSocketLayout } from '../contexts/StyleContext';
import { useFont, type LoadedFontWeight } from '../contexts/FontContext';
import { msdfVertexShader, msdfFragmentShader, MSDF_SHADER_DEFAULTS } from '../utils/msdf-shader';
import { rgbToHex } from '../utils/color';
import { THEME_COLORS } from '../core/theme-colors';
import {
  type FontMetrics,
  type TextEntry,
  type GlyphMap,
  type KerningMap,
  buildGlyphMap,
  buildKerningMap,
  populateGlyphBuffers,
  countGlyphs,
  truncateText,
} from '../utils/text-layout';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { TITLE_LINE_BOX } from '../utils/style-resolver';
import { getWidgetBox } from '../utils/widget-geometry';
import { resolveWidgetConfig } from '../utils/widgets';
import { readWidgetValue, widgetKey } from '../utils/widget-values';
import { widgetValueText, WIDGET_VALUE_MIN_ZOOM } from '../utils/widget-text';
import { measureText } from '../utils/text-layout';
import type { EdgeType, EdgeLabelConfig, SocketType } from '../types';
import { getEdgePointAtT, type SocketIndexMap } from '../utils/geometry';
import { type CullRect, inflateViewRect, viewEscaped } from '../utils/viewport-cull';
import { indexConnectedSockets } from './sockets';
import { isSelfDrawn } from '../utils/entity-kind';
import { entityDepth, DEPTH_LAYER } from '../utils/entity-depth';

// Stable empty maps to avoid re-creating on every render when font isn't loaded
const emptyGlyphMap: GlyphMap = new Map();
const emptyKerningMap: KerningMap = new Map();

// Sentinel array — unique reference that never equals any real entries array.
// Used to force buffer re-population after capacity resize.
const SENTINEL_ENTRIES: TextEntry[] = [];

// Buffer capacity management
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;
const MAX_CAPACITY = 250000; // 250k glyphs max per weight

// LOD thresholds
const MIN_TEXT_ZOOM = 0.15; // Below this, hide ALL text
const MIN_SOCKET_ZOOM = 0.35; // Below this, hide socket labels
const MIN_EDGE_ZOOM = 0.25; // Below this, hide edge labels

/**
 * How far past the collected rect a label's own entity is still considered, in world units.
 *
 * Text hangs off its entity — a status line prints under the bottom edge, a socket label to the
 * side — so an entity just outside the rect can still put ink inside it. This is what keeps a
 * label from popping in at the border: it is applied ON TOP of the hysteresis margin, both to the
 * quadtree query that finds the entities and, unchanged, to the per-label test inside the passes,
 * so an entity is collected well before its glyphs could reach the screen.
 *
 * THE MARGIN ITSELF — the fraction of the screen the set is collected for, and the reason a pan
 * does not re-collect at all — is `CULL_HYSTERESIS` in utils/viewport-cull.ts. It was proved here
 * first: this layer's dirty pass re-walks every character of every label, re-counts its glyphs,
 * re-tessellates them into the instance buffers and re-uploads four attributes at FULL capacity —
 * megabytes a frame on a dense graph, for data that had not changed by one bit, because glyph
 * transforms are world space and a pan moves none of them. Every other GL layer was in the same
 * shape and now shares the fix.
 */
const LABEL_CULL_PADDING = 100;

/**
 * Which LOD gates the current zoom passes, as a bitmask.
 *
 * The hysteresis above answers "did the camera leave the rect we collected for"; it says nothing
 * about zoom, and zoom has four cliffs where the ANSWER changes without the rect changing —
 * zooming in past 0.35 has to make socket labels appear even though the visible rect only shrank
 * and is therefore still contained. Comparing the bucket catches every crossing in both
 * directions with one integer compare.
 *
 * THE FOURTH BIT WAS ADDED WITH THE WIDGET VALUES AND IS NOT OPTIONAL. Widget readouts have their
 * own floor at WIDGET_VALUE_MIN_ZOOM, and zooming IN only shrinks the visible rect — which stays
 * inside the rect the set was collected for, so nothing else here would ever ask again. Measured:
 * zoom out past 0.5 and back to 1 and every field on every node stayed blank until something
 * unrelated marked the layer dirty. A gate with no bit is a gate that only closes.
 */
export function lodBucket(zoom: number): number {
  return (
    (zoom >= MIN_TEXT_ZOOM ? 1 : 0) |
    (zoom >= MIN_EDGE_ZOOM ? 2 : 0) |
    (zoom >= MIN_SOCKET_ZOOM ? 4 : 0) |
    (zoom >= WIDGET_VALUE_MIN_ZOOM ? 8 : 0)
  );
}

/**
 * The rect helpers live in utils/viewport-cull.ts now — every GL layer uses them, not just this
 * one — and are re-exported here because this file is where they were proved and where their laws
 * are written.
 */
export { type CullRect, inflateViewRect } from '../utils/viewport-cull';

/**
 * Whether a set collected for `collected` at `collectedLod` still answers this view.
 *
 * The rect half is the shared `viewEscaped`; what this adds is the LOD half, which is specific to
 * text: four thresholds that change WHAT is collected without changing the rect it is collected
 * for. The whole point of the hysteresis is that this returns false for most frames of a pan, so
 * it is the thing worth pinning down in a test: a set stays usable while the screen is inside the
 * rect it was collected for AND the zoom still passes the same LOD gates, and stops the instant
 * either stops being true.
 */
export function collectedSetIsStale(
  collected: CullRect,
  collectedLod: number,
  zoom: number,
  left: number,
  right: number,
  top: number,
  bottom: number
): boolean {
  if (lodBucket(zoom) !== collectedLod) return true;
  return viewEscaped(collected, left, right, top, bottom);
}

/**
 * Font data for a single weight.
 * @deprecated Use LoadedFontWeight from FontContext instead.
 */
export type FontWeightData = LoadedFontWeight;

/**
 * Props for the single-weight text renderer.
 */
interface TextWeightRendererProps {
  fontData: import('../contexts/FontContext').LoadedFontWeight;
  /** Ref to entries array - read directly in useFrame for same-frame updates */
  entriesRef: React.MutableRefObject<TextEntry[]>;
}

/**
 * Renders text for a single font weight using instanced MSDF.
 */
function TextWeightRenderer({ fontData, entriesRef }: TextWeightRendererProps) {
  const { metrics: fontMetrics, texture: atlasTexture, glyphMap, kerningMap } = fontData;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const initializedRef = useRef(false);

  // Create plane geometry (unit quad)
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Create MSDF shader material
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlasTexture },
        uThreshold: { value: MSDF_SHADER_DEFAULTS.threshold },
        uAlphaTest: { value: MSDF_SHADER_DEFAULTS.alphaTest },
      },
      vertexShader: msdfVertexShader,
      fragmentShader: msdfFragmentShader,
      transparent: true,
      // A label tests against the bodies so a node in front hides the text of a node behind;
      // it writes nothing, or every glyph quad's empty corners would punch holes in the scene.
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [atlasTexture]);

  /**
   * Material and geometry only — NEVER `atlasTexture`.
   *
   * The atlas belongs to FontContext, which hands the same texture to up to four mounted weight
   * meshes at once and caches it by URL for every future mount. Disposing it here is a re-upload
   * per mount at best, and permanently black text once the loader closes its bitmaps. The semibold
   * mesh is what makes this effect matter: it mounts and unmounts as bold text appears and
   * disappears during ordinary editing, so its pair leaks on every toggle.
   *
   * See nodes.tsx for why the dep array is the memoised value itself.
   */
  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  // Pre-allocated buffers
  const buffers = useMemo(
    () => ({
      // There is no intermediate matrix buffer any more. `populateGlyphBuffers` used to fill one
      // of these, and the next line copied all of it a second time into the mesh's own array — a
      // full memcpy of 64 bytes per visible glyph, per weight, on every dirty frame, plus a
      // `subarray` view object to do it with. The glyphs are written into the mesh's array
      // directly instead.
      uvOffsets: new Float32Array(capacity * 4),
      colors: new Float32Array(capacity * 3),
      opacities: new Float32Array(capacity),
      uvOffsetAttr: null as THREE.InstancedBufferAttribute | null,
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      opacityAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

  // Track last processed entries ref to skip redundant buffer writes.
  // SENTINEL forces a re-populate after buffer resize (different from any real array).
  const lastEntriesRef = useRef<TextEntry[]>(SENTINEL_ENTRIES);

  // Reset initialized flag when buffers change. A LAYOUT effect like the init below, and declared
  // before it so it runs first: as a passive effect it ran AFTER the layout init had set the flag,
  // cleared it again, and no text drew at all.
  useLayoutEffect(() => {
    initializedRef.current = false;
    lastEntriesRef.current = SENTINEL_ENTRIES; // Force re-populate after resize
  }, [buffers]);

  // Initialize attributes when mesh is ready.
  //
  // A LAYOUT effect, and the difference was a GL error on every capacity growth. The mesh is
  // keyed on `capacity`, so growing it mounts a fresh InstancedMesh whose `instanceMatrix` holds
  // the new capacity — but the geometry is shared and still carries the previous mesh's glyph
  // attributes at the OLD capacity until this effect swaps them. A passive effect runs after the
  // browser has had a chance to paint, and R3F's frame runs on rAF, so one frame drew the new
  // mesh (count = capacity, 1424) against 512-slot aUvOffset/aColor/aOpacity buffers:
  // `glDrawElementsInstanced: Vertex buffer is not big enough for the draw call`, once per
  // growth, in every graph big enough to grow. Layout effects run inside the commit, before any
  // rAF can fire, so the new attributes are on the geometry before the mesh is ever drawn.
  useLayoutEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    buffers.uvOffsetAttr = new THREE.InstancedBufferAttribute(buffers.uvOffsets, 4);
    buffers.uvOffsetAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.colorAttr = new THREE.InstancedBufferAttribute(buffers.colors, 3);
    buffers.colorAttr.setUsage(THREE.DynamicDrawUsage);
    buffers.opacityAttr = new THREE.InstancedBufferAttribute(buffers.opacities, 1);
    buffers.opacityAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aUvOffset', buffers.uvOffsetAttr);
    mesh.geometry.setAttribute('aColor', buffers.colorAttr);
    mesh.geometry.setAttribute('aOpacity', buffers.opacityAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);


    // The glyph matrices go straight into the mesh's own instance array, so the `Float32Array`
    // premise is verified once, here, instead of being asserted with a cast in the frame loop.
    // `InstancedMesh` allocates `new Float32Array(count * 16)`; if that ever stops being true the
    // text stops drawing and says so, rather than drawing garbage.
    if (
      !(mesh.instanceMatrix.array instanceof Float32Array) ||
      mesh.instanceMatrix.array.length !== capacity * 16
    ) {
      console.warn(
        '[kookie-flow] instanceMatrix is not a Float32Array of capacity*16 — text not drawn'
      );
      return;
    }

    initializedRef.current = true;
  }, [buffers, capacity]);

  // Update on frame - read from ref for same-frame updates (no React batching delay).
  // Skip buffer population when entries ref hasn't changed (parent didn't re-collect).
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current) return;

    // Read off the mesh every frame rather than cached once: `args` changing — a new atlas
    // texture rebuilds both geometry and material — reconstructs the mesh without changing
    // `buffers`, so a cached array would be the previous mesh's and the text would quietly stop
    // moving. The assertion costs nothing at runtime and its premise is checked in the init
    // effect above, which refuses to initialise (and says so) if three ever stops allocating
    // `instanceMatrix` as a Float32Array of capacity * 16.
    const matrices = mesh.instanceMatrix.array as Float32Array;

    const entries = entriesRef.current;

    // Same reference as last frame → parent didn't re-collect, nothing changed
    if (entries === lastEntriesRef.current) return;
    lastEntriesRef.current = entries;

    if (entries.length === 0) {
      mesh.count = 0;
      return;
    }

    // Check capacity
    const estimatedGlyphs = countGlyphs(entries, glyphMap);
    if (estimatedGlyphs > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(estimatedGlyphs * BUFFER_GROWTH_FACTOR)));
      return;
    }

    // Populate buffers
    const glyphCount = populateGlyphBuffers(
      entries,
      fontMetrics,
      glyphMap,
      kerningMap,
      matrices,
      buffers.uvOffsets,
      buffers.colors,
      buffers.opacities,
      capacity
    );

    // Update instance matrices (cap to capacity to prevent buffer overflow)
    const safeGlyphCount = Math.min(glyphCount, capacity);

    // A bare `needsUpdate` with no update range makes three upload the WHOLE array: its
    // WebGLAttributes.updateBuffer falls back to `bufferSubData(bufferType, 0, array)` when
    // `updateRanges` is empty. These arrays are sized to CAPACITY, which grows to 1.5x the peak
    // glyph count ever collected and never shrinks — so after one zoom-out the four attributes
    // kept re-uploading megabytes of untouched tail on every dirty frame, for glyphs that
    // `mesh.count` was not even drawing. Only the first `safeGlyphCount` glyphs were written by
    // `populateGlyphBuffers` and only that many are drawn, so that is the only range worth
    // sending; whatever stale bytes sit past it in GPU memory are unreachable. Same call
    // edges.tsx already uses for its partial edge rewrites. Three clears the ranges itself once
    // it has uploaded them, so they do not accumulate.
    if (safeGlyphCount > 0) {
      mesh.instanceMatrix.addUpdateRange(0, safeGlyphCount * 16);
      if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
        buffers.uvOffsetAttr.addUpdateRange(0, safeGlyphCount * 4);
        buffers.colorAttr.addUpdateRange(0, safeGlyphCount * 3);
        buffers.opacityAttr.addUpdateRange(0, safeGlyphCount);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
      buffers.uvOffsetAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.opacityAttr.needsUpdate = true;
    }

    mesh.count = safeGlyphCount;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      renderOrder={6}
    />
  );
}

/**
 * Props for the multi-weight text renderer.
 */
export interface MultiWeightTextRendererProps {
  /** Font data for regular weight (optional - uses FontContext if not provided) */
  regularFont?: LoadedFontWeight;
  /** Font data for semibold weight (optional - uses FontContext if not provided) */
  semiboldFont?: LoadedFontWeight;
  /** Show socket labels */
  showSocketLabels?: boolean;
  /** Show edge labels */
  showEdgeLabels?: boolean;
  /** Default edge type for label positioning */
  defaultEdgeType?: EdgeType;
  /**
   * Socket type definitions, for resolving which widget a socket gets.
   *
   * Widget chrome is drawn by `widgets-gl.tsx` and its VALUES are drawn here, so both layers have
   * to resolve the same widget from the same socket. Optional only so the legacy single-weight
   * API below can mount without one; with none, no widget prints a value.
   */
  socketTypes?: Record<string, SocketType>;
  /** Print each unconnected widget's value. Follows `showWidgets` on the canvas. */
  showWidgetValues?: boolean;
  /** Default entity width when the entity does not state one. Must match the widget layer's. */
  defaultEntityWidth?: number;
  /** Width reserved for a socket's label before its widget starts. Must match the widget layer's. */
  socketLabelWidth?: number;
}

/**
 * Helper to normalize edge label to full config.
 */
function normalizeEdgeLabel(label: string | EdgeLabelConfig): EdgeLabelConfig {
  if (typeof label === 'string') {
    return { text: label };
  }
  return label;
}

/**
 * Multi-weight TextRenderer - renders text with multiple font weights.
 * Each weight gets its own InstancedMesh for optimal performance.
 *
 * Font resolution priority:
 * 1. Props (regularFont, semiboldFont) - for explicit control
 * 2. FontContext - for preset/configured fonts
 * 3. Returns null if no fonts available
 */
export function MultiWeightTextRenderer({
  regularFont: regularFontProp,
  semiboldFont: semiboldFontProp,
  showSocketLabels = true,
  showEdgeLabels = true,
  defaultEdgeType = 'bezier',
  socketTypes,
  showWidgetValues = true,
  defaultEntityWidth = DEFAULT_ENTITY_WIDTH,
  socketLabelWidth = SOCKET_LABEL_WIDTH,
}: MultiWeightTextRendererProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const { resolved: style, config } = useEntityStyle();
  const socketLayout = useSocketLayout();

  /**
   * Where a node's own text starts, measured from the body's outer edge.
   *
   * This was the literal 12 in four places, which happened to equal the size-2 body padding and
   * tracked nothing: at size 1 or 4 the body padded 8 or 24 and the labels still printed at 12,
   * while the WIDGETS beside them did follow the padding — so the two layers disagreed the moment
   * a consumer set `size`. It is `padding + borderWidth` because the body is border-box, the same
   * inset `widget-geometry` gives the widget boxes on the same rows.
   */
  const contentInset = socketLayout.padding + socketLayout.borderWidth;
  const fontContext = useFont();

  // Resolve fonts: props take precedence, then context
  const regularFont = regularFontProp ?? fontContext.regular;
  const semiboldFont = semiboldFontProp ?? fontContext.semibold;

  // Derive text colors from theme tokens
  const primaryTextColor = rgbToHex(tokens[THEME_COLORS.text.primary]);
  const secondaryTextColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);
  // The same red an invalid edge draws in: one hue for "this is wrong" across the graph.
  const errorTextColor = rgbToHex(tokens[THEME_COLORS.edge.invalid]);

  // Glyph/kerning maps from FontContext (shared, built once)
  const regularGlyphMap = regularFont?.glyphMap ?? emptyGlyphMap;
  const regularKerningMap = regularFont?.kerningMap ?? emptyKerningMap;
  // The title is drawn in semibold where there is one, so it must be MEASURED in semibold too:
  // measuring a bold string against the regular face truncates it a character or two late.
  const titleGlyphMap = semiboldFont?.glyphMap ?? regularGlyphMap;
  const titleKerningMap = semiboldFont?.kerningMap ?? regularKerningMap;

  // Socket index map for edge label positioning
  const socketIndexMapRef = useRef<SocketIndexMap>(new Map());

  // Entries by weight - use refs for same-frame updates (avoid React batching delay)
  const regularEntriesRef = useRef<TextEntry[]>([]);
  const semiboldEntriesRef = useRef<TextEntry[]>([]);

  // Dirty flag — only re-collect when something relevant changes
  const dirtyRef = useRef(true);

  // The camera moved. Unlike `dirtyRef` this is a QUESTION, not a verdict: the frame loop still
  // has to decide whether the move took the screen outside the rect the current set was
  // collected for. See CULL_HYSTERESIS.
  const viewMovedRef = useRef(false);

  // The world rect the current entry set was collected for, and the LOD gates the zoom passed
  // when it was collected. Mutated in place — this is read and written every frame and must not
  // allocate. The zeroed rect plus an impossible bucket makes the first frame always collect.
  const collectedRectRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });
  const collectedLodRef = useRef(-1);

  // Canvas size in CSS pixels as of the last collect. A resize changes the visible world rect
  // without touching `viewport`, so nothing in the store would report it and labels would simply
  // be missing from the newly revealed strip until something else marked the set dirty.
  const collectedWidthRef = useRef(0);
  const collectedHeightRef = useRef(0);

  /** The quadtree's answer for the collected rect, and the box it is asked with. Both reused. */
  const visibleIdsRef = useRef<string[]>([]);
  const visibleQueryRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  /**
   * Which input sockets carry an edge, by entity then by socket id — the same index widgets-gl
   * keeps, for the same reason: the store answers this through a joined `"id:socket:input"` key,
   * and building that string once per widget row per rebuild is the cost, not the lookup.
   */
  const connectedInputsRef = useRef<Map<string, Set<string>>>(new Map());
  const connectedOutputsRef = useRef<Map<string, Set<string>>>(new Map());

  // Build socket index map
  const rebuildSocketIndexMap = useCallback(() => {
    const { entities } = store.getState();
    socketIndexMapRef.current.clear();
    for (const n of entities) {
      if (n.inputs) {
        for (let i = 0; i < n.inputs.length; i++) {
          const s = n.inputs[i];
          socketIndexMapRef.current.set(`${n.id}:${s.id}:input`, { index: i, socket: s });
        }
      }
      if (n.outputs) {
        for (let i = 0; i < n.outputs.length; i++) {
          const s = n.outputs[i];
          socketIndexMapRef.current.set(`${n.id}:${s.id}:output`, { index: i, socket: s });
        }
      }
    }
  }, [store]);

  // Collect and split text entries
  const collectTextEntries = useCallback(
    (
      zoom: number,
      viewLeft: number,
      viewRight: number,
      viewTop: number,
      viewBottom: number,
      /**
       * The entities inside the collected rect, from the quadtree, and how many of `visibleIds`
       * is live. Three of the four passes below used to walk the WHOLE graph and reject entities
       * one box test at a time; on a drag, which marks this layer dirty every frame, that was
       * three full sweeps of the graph per frame to lay out a screenful of labels.
       */
      visibleIds: readonly string[],
      visibleCount: number
    ): { regular: TextEntry[]; semibold: TextEntry[] } => {
      const regular: TextEntry[] = [];
      const semibold: TextEntry[] = [];

      if (!regularFont) return { regular, semibold };

      const {
        edges,
        entityMap,
        selectedEntityIds,
        stackOrder,
        hiddenEntityIds,
        widgetValues,
        editingWidgetKey,
        getEvaluationRecord,
      } = store.getState();

      if (zoom < MIN_TEXT_ZOOM) return { regular, semibold };

      const cullPadding = LABEL_CULL_PADDING;

      // Entity headers (semibold) — skip types that render their own content.
      // `header="none"` draws no title at all; the layout reserves no band for one either.
      for (let vi = 0; vi < visibleCount; vi++) {
        if (config.header === 'none') break;
        const entity = entityMap.get(visibleIds[vi]);
        if (!entity) continue;
        if (isSelfDrawn(entity.type)) continue;

        // Collapsing a frame hides everything inside it, and this layer was the one place that
        // never asked. nodes.tsx, widgets-gl.tsx, sockets.tsx, image-entities.tsx, text-entities.tsx
        // and edges.tsx all skip on `hiddenEntityIds`; text did not, so collapsing a frame took
        // away the children's bodies, sockets and widgets and left their titles and every socket
        // label floating over the collapsed box, through every subsequent pan and zoom.
        if (hiddenEntityIds.has(entity.id)) continue;

        const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const entityLayout = getEntitySocketLayout(entity, socketLayout);
        const height = entity.height ?? entityLayout.computedHeight;

        const entityRight = entity.position.x + width;
        const entityBottom = entity.position.y + height;
        if (
          entityRight < viewLeft - cullPadding ||
          entity.position.x > viewRight + cullPadding ||
          entityBottom < viewTop - cullPadding ||
          entity.position.y > viewBottom + cullPadding
        ) {
          continue;
        }

        const rawLabel = entity.data.label ?? entity.type;
        /**
         * A title is truncated to the card, like every other label here.
         *
         * It was the one string on a node that ran as long as it liked, so a node called
         * "Denoise and upscale (fast)" printed its name straight out through its own right edge
         * and over whatever was behind it. The width available is the body minus its insets, and
         * minus the gutter a title shares with nothing — there is no second column on this row.
         */
        const titleWidth = (entity.width ?? DEFAULT_ENTITY_WIDTH) - contentInset * 2;
        const label =
          titleGlyphMap.size > 0
            ? truncateText(
                rawLabel,
                titleWidth,
                12,
                (semiboldFont ?? regularFont)?.metrics.info.size ?? 12,
                titleGlyphMap,
                titleKerningMap
              )
            : rawLabel;
        /*
         * The title is centred in its OWN BAND, and the band starts at the content inset.
         *
         * It used to be centred on `[0, headerHeight)` — measured from the body's outer edge — so
         * it sat `(headerHeight - lineBox) / 2` from the top however much the body was padded, and
         * a node with a large corner had its name inside the curve. Inside the body the band is
         * `[contentInset, contentInset + titleBand)`, the same band `resolveSocketLayout` reserves
         * above the first socket row.
         *
         * `outside` is unchanged: the band is above the body, where no inset applies.
         */
        const outside = config.header === 'outside';
        const bandTop = outside
          ? entity.position.y - style.headerHeight
          : entity.position.y + contentInset;
        const bandHeight = outside ? style.headerHeight : socketLayout.titleBand;
        const labelY = bandTop + (bandHeight - TITLE_LINE_BOX) / 2;
        const entry: TextEntry = {
          text: label,
          position: [entity.position.x + contentInset, labelY, entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.label)],
          fontSize: 12,
          color: primaryTextColor,
          anchor: 'left',
          fontWeight: 'semibold',
        };

        // Use semibold if available, otherwise fall back to regular
        if (semiboldFont) {
          semibold.push(entry);
        } else {
          regular.push(entry);
        }
      }

      // Socket labels (regular)
      if (showSocketLabels && zoom >= MIN_SOCKET_ZOOM) {
        for (let vi = 0; vi < visibleCount; vi++) {
          const entity = entityMap.get(visibleIds[vi]);
          if (!entity) continue;
          if (hiddenEntityIds.has(entity.id)) continue;

          const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
          const entityLayout = getEntitySocketLayout(entity, socketLayout);
          const height = entity.height ?? entityLayout.computedHeight;

          const entityRight = entity.position.x + width;
          const entityBottom = entity.position.y + height;
          if (
            entityRight < viewLeft - cullPadding ||
            entity.position.x > viewRight + cullPadding ||
            entityBottom < viewTop - cullPadding ||
            entity.position.y > viewBottom + cullPadding
          ) {
            continue;
          }

          // A failed entity says why, under its bottom edge, in the invalid hue. The consumer's
          // own `statusMessage` wins; the engine's message shows only when the engine's status is
          // the one being drawn — a consumer overriding status has overridden its explanation too.
          {
            const data = entity.data;
            const record = data?.status === undefined ? getEvaluationRecord(entity.id) : undefined;
            const message =
              data?.statusMessage ?? (record?.status === 'error' ? record.message : undefined);
            if (message) {
              const maxWidth = width - 2 * contentInset;
              const shown =
                regularGlyphMap.size > 0
                  ? truncateText(message, maxWidth, 11, regularFont.metrics.info.size, regularGlyphMap, regularKerningMap)
                  : message;
              regular.push({
                text: shown,
                position: [
                  entity.position.x + contentInset,
                  entity.position.y + height + 4,
                  entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.label),
                ],
                fontSize: 11,
                color: errorTextColor,
                anchor: 'left',
                fontWeight: 'regular',
              });
            }
          }

          // Center sockets vertically within entity height (bidirectional)
          const centerOffset = (height - entityLayout.computedHeight) / 2;

          // Output sockets (first in layout order)
          if (entity.outputs) {
            for (let i = 0; i < entity.outputs.length; i++) {
              const socket = entity.outputs[i];
              // Use cached position (supports variable row heights and stacked layouts)
              const cachedPos = entityLayout.outputs[i];
              const socketY = entity.position.y + (cachedPos?.labelY ?? socketLayout.marginTop + socketLayout.rowHeight / 2) + centerOffset;
              const textY = socketY - 7; // adjust for visual centering
              // Truncate output labels to fit available space (mirror of input label width)
              // The PROP, not the constant. Widget geometry lays the row out against the prop, so
              // truncating against the constant left a consumer who widened the gutter with text
              // cut short in the middle of the space they had asked for — and one who narrowed it
              // with labels running under their own controls.
              const outputLabelMaxWidth = socketLabelWidth - 12; // padding
              const truncatedName =
                regularGlyphMap.size > 0
                  ? truncateText(
                      socket.name,
                      outputLabelMaxWidth,
                      12,
                      regularFont.metrics.info.size,
                      regularGlyphMap,
                      regularKerningMap
                    )
                  : socket.name;
              regular.push({
                text: truncatedName,
                position: [entity.position.x + width - contentInset, textY, entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.label)],
                fontSize: 12,
                color: secondaryTextColor,
                anchor: 'right',
                fontWeight: 'regular',
              });
            }
          }

          // Input sockets (after outputs in layout order)
          if (entity.inputs) {
            for (let i = 0; i < entity.inputs.length; i++) {
              const socket = entity.inputs[i];
              // Use cached position (supports variable row heights and stacked layouts)
              const cachedPos = entityLayout.inputs[i];
              const socketY = entity.position.y + (cachedPos?.labelY ?? socketLayout.marginTop + socketLayout.rowHeight / 2) + centerOffset;
              const textY = socketY - 7; // adjust for visual centering
              // Truncate input labels to fit before widget area
              const inputLabelMaxWidth = socketLabelWidth - 12; // padding, as above
              const truncatedName =
                regularGlyphMap.size > 0
                  ? truncateText(
                      socket.name,
                      inputLabelMaxWidth,
                      12,
                      regularFont.metrics.info.size,
                      regularGlyphMap,
                      regularKerningMap
                    )
                  : socket.name;
              regular.push({
                text: truncatedName,
                position: [entity.position.x + contentInset, textY, entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.label)],
                fontSize: 12,
                color: secondaryTextColor,
                anchor: 'left',
                fontWeight: 'regular',
              });
            }
          }
        }
      }

      /**
       * Widget values.
       *
       * `widgets-gl.tsx` draws a widget's chrome — the well, the track, the tick, the chevron —
       * and says in its own docstring that the value belongs here rather than re-implemented in
       * its shader. This is that contribution, and until it was written every field on every node
       * showed an empty box: the DOM controls that used to print their own values were deleted
       * with the migration and nothing replaced them.
       *
       * A FOURTH BLOCK rather than folded into the socket-label loop above, even though both walk
       * the same inputs. The names are gated on `showSocketLabels` and MIN_SOCKET_ZOOM; the values
       * have their own flag and a HIGHER floor, and fusing them would tie a value to whether its
       * name is shown and print 12px readouts at a zoom where they are 4px of mush.
       *
       * The floor is the glyph budget's main lever: this adds text to every widget on every
       * visible node, and the frames with the most visible nodes are exactly the zoomed-out ones.
       * See WIDGET_VALUE_MIN_ZOOM.
       */
      if (
        showWidgetValues &&
        socketTypes &&
        zoom >= WIDGET_VALUE_MIN_ZOOM &&
        regularGlyphMap.size > 0
      ) {
        // v2 prints a control's value at the size's own type step — 14px at size 2, not a constant.
        const widgetFont = style.widgetFontSize;
        const glyphScale = widgetFont / regularFont.metrics.info.size;
        for (let vi = 0; vi < visibleCount; vi++) {
          const entity = entityMap.get(visibleIds[vi]);
          if (!entity) continue;
          if (hiddenEntityIds.has(entity.id)) continue;
          // Not `entity.inputs ?? []` — that mints an empty array for every input-less entity in
          // the graph, on every dirty frame, purely to ask its length. Same note widgets-gl carries.
          const inputs = entity.inputs;
          if (!inputs || inputs.length === 0) continue;

          const width = entity.width ?? defaultEntityWidth;
          const entityLayout = getEntitySocketLayout(entity, socketLayout);
          const height = entity.height ?? entityLayout.computedHeight;
          if (
            entity.position.x + width < viewLeft - cullPadding ||
            entity.position.x > viewRight + cullPadding ||
            entity.position.y + height < viewTop - cullPadding ||
            entity.position.y > viewBottom + cullPadding
          ) {
            continue;
          }

          const depth =
            entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.label);
          const values = (entity.data as { values?: Record<string, unknown> } | undefined)?.values;

          for (let i = 0; i < inputs.length; i++) {
            const socket = inputs[i];
            // A connected socket has no widget — its value comes down the edge. The store keys
            // this set per direction, so the suffix is part of the key.
            if (connectedInputsRef.current.get(entity.id)?.has(socket.id)) continue;
            const key = widgetKey(entity.id, socket.id);
            // The borrowed input owns this box for the length of an edit and prints the value
            // itself; see the store field for why the suppression is stated rather than left to
            // the overlay's opacity.
            if (key === editingWidgetKey) continue;
            const config = resolveWidgetConfig(socket, socketTypes);
            if (!config) continue;
            const box = getWidgetBox(entity, i, socketLayout, defaultEntityWidth, socketLabelWidth);
            if (!box) continue;
            const value = readWidgetValue(
              widgetValues,
              key,
              values?.[socket.id] ?? config.defaultValue
            );
            const placed = widgetValueText(config, value, box, style.widgetPad);
            if (!placed) continue;

            /**
             * MEASURE FIRST, TRUNCATE ONLY IF IT DOES NOT FIT — and that order is load-bearing
             * rather than a micro-optimisation. `truncateText` memoises on
             * `text:maxWidth:fontSize` and, at a thousand entries, evicts by building an array of
             * every key. A slider drag mints a new value string on every pointermove, so routing
             * readouts through that cache churns it and puts an array-of-1000 allocation inside a
             * gesture. `measureText` allocates nothing, and a numeric readout never needs cutting.
             */
            const fits =
              measureText(placed.text, regularGlyphMap, regularKerningMap) * glyphScale <=
              placed.maxWidth;
            const text = fits
              ? placed.text
              : truncateText(
                  placed.text,
                  placed.maxWidth,
                  widgetFont,
                  regularFont.metrics.info.size,
                  regularGlyphMap,
                  regularKerningMap
                );

            regular.push({
              text,
              // Centred on the FIRST row of a multi-row widget rather than on the whole box, so a
              // three-row textarea reads from its top line like the input that replaces it. The -7
              // is the same visual centring the socket labels above use.
              position: [
                placed.x,
                box.y + Math.min(box.height, socketLayout.widgetHeight) / 2 - (widgetFont * 7) / 12,
                depth,
              ],
              fontSize: widgetFont,
              // The value is CONTENT, like the entity header, not chrome like the socket's name —
              // and neutral-12 is exactly what the borrowed input paints with, so opening an edit
              // does not change the ink. A placeholder is not content, and takes the muted ink.
              color: placed.muted ? secondaryTextColor : primaryTextColor,
              anchor: placed.anchor,
              fontWeight: 'regular',
            });
          }
        }
      }

      // Edge labels (regular)
      if (showEdgeLabels && zoom >= MIN_EDGE_ZOOM) {
        for (const edge of edges) {
          if (!edge.label) continue;

          // Both endpoints, matching edges.tsx: an edge crossing a collapse boundary is not drawn
          // on either side, so its label must not be either.
          if (hiddenEntityIds.has(edge.source) || hiddenEntityIds.has(edge.target)) continue;

          const labelConfig = normalizeEdgeLabel(edge.label);
          const t = labelConfig.position ?? 0.5;

          const pointResult = getEdgePointAtT(
            edge,
            entityMap,
            t,
            defaultEdgeType,
            socketIndexMapRef.current
          );
          if (!pointResult) continue;

          const { position } = pointResult;

          if (
            position.x < viewLeft - cullPadding ||
            position.x > viewRight + cullPadding ||
            position.y < viewTop - cullPadding ||
            position.y > viewBottom + cullPadding
          ) {
            continue;
          }

          // Every other entry here sits on the depth ladder; the edge label used to be pinned at
          // a hardcoded z of 0.15. The camera is orthographic at z=100 and bodies write depth
          // from -850 upward, so 0.15 was nearer than anything in the scene could ever be and the
          // depth test always passed — an edge label routed under a node drew straight through
          // it, as if the node were transparent. A label belongs to its edge, and an edge belongs
          // to the higher of its two endpoints, so it takes that endpoint's slice: it now covers
          // the nodes its edge is in front of and is covered by the ones it is behind.
          const labelDepth =
            Math.max(
              entityDepth(edge.source, stackOrder, selectedEntityIds, DEPTH_LAYER.label),
              entityDepth(edge.target, stackOrder, selectedEntityIds, DEPTH_LAYER.label)
            );

          regular.push({
            text: labelConfig.text,
            position: [position.x, position.y, labelDepth],
            fontSize: labelConfig.fontSize ?? 11,
            color: labelConfig.textColor ?? primaryTextColor,
            anchor: 'center',
            fontWeight: 'regular',
          });
        }
      }

      return { regular, semibold };
    },
    [
      store,
      showSocketLabels,
      showEdgeLabels,
      defaultEdgeType,
      primaryTextColor,
      secondaryTextColor,
      semiboldFont,
      regularFont,
      regularGlyphMap,
      regularKerningMap,
      config,
      style,
      socketLayout,
      showWidgetValues,
      socketTypes,
      defaultEntityWidth,
      socketLabelWidth,
    ]
  );

  // Subscribe to store changes that affect text labels
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };

    // Rebuild socket index map when entity count changes (add/remove)
    rebuildSocketIndexMap();
    const unsubEntityCount = store.subscribe(
      (state) => state.entities.length,
      () => {
        rebuildSocketIndexMap();
        markDirty();
      }
    );

    // Entity positions/dimensions/data affect header + socket label positions
    const unsubPositions = store.subscribe((s) => s.positionVersion, markDirty);
    // A pan or zoom is the one change that does NOT necessarily invalidate the entry list, so it
    // gets its own flag: the frame loop tests the new view rect against the margin the set was
    // collected for and only re-collects once the camera has actually escaped it. See
    // CULL_HYSTERESIS. Marking `dirtyRef` here instead would rebuild and re-upload every glyph on
    // every pointermove of a pan.
    const unsubViewport = store.subscribe((s) => s.viewport, () => { viewMovedRef.current = true; });
    // Collapsing a frame changes which labels exist. `applyEntityChanges` rebuilds derived state
    // into a fresh Set on every collapse, and — unlike a topology change — bumps no version
    // counter, so this identity subscription is the only signal that fires. Same subscription
    // nodes.tsx uses.
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markDirty);
    // Edge labels
    const unsubEdges = store.subscribe((s) => s.edges, markDirty);
    // Depth is per entity and selection boosts it, so both of these move the labels in z.
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markDirty);
    const unsubStack = store.subscribe((s) => s.stackVersion, markDirty);

    /**
     * Widget values, which are ENTITY DATA and therefore invisible to every subscription above.
     *
     * `applyEntityChanges` bumps no version counter for a data-only change — it swaps the entities
     * array and nothing else — and `setWidgetValue` bumps only `widgetValuesVersion`. So before
     * these four lines a value typed into a field, or dragged on a slider, or written by the
     * consumer, never repainted: the glyphs stayed on whatever the last position change had
     * collected. The list is copied from widgets-gl.tsx, which subscribes to exactly the same set
     * for exactly the same reason — the two layers draw two halves of one widget and must not
     * disagree about when it changed.
     *
     * The entities subscription fires on every frame of a drag as well, since the store rebuilds
     * the array there — but `positionVersion` has already set the flag on that frame, so it costs
     * one boolean write and no extra collect.
     */
    const unsubEntities = store.subscribe((s) => s.entities, markDirty);
    // What the person just set, ahead of the consumer echoing it back.
    const unsubWidgetValues = store.subscribe((s) => s.widgetValuesVersion, markDirty);
    // A value stops being shown the moment an edge lands on its socket.
    const reindexConnected = () => {
      connectedInputsRef.current.clear();
      connectedOutputsRef.current.clear();
      indexConnectedSockets(store.getState().edges, connectedInputsRef.current, connectedOutputsRef.current);
    };
    reindexConnected();
    const unsubConnected = store.subscribe((s) => s.connectedSockets, () => {
      reindexConnected();
      markDirty();
    });
    // Suppression under a borrowed input, on and off.
    const unsubEditingWidget = store.subscribe((s) => s.editingWidgetKey, markDirty);
    // An error message appears or clears with the engine's records, which are entity-external.
    const unsubEvaluation = store.subscribe((s) => s.evaluationVersion, markDirty);

    return () => {
      unsubEntityCount();
      unsubPositions();
      unsubViewport();
      unsubHidden();
      unsubEdges();
      unsubSelection();
      unsubStack();
      unsubEntities();
      unsubWidgetValues();
      unsubConnected();
      unsubEditingWidget();
      unsubEvaluation();
    };
  }, [store, rebuildSocketIndexMap]);

  /**
   * Re-collect whenever any input to collection changes.
   *
   * This used to list the theme colours and the style config by hand, which left out the fonts —
   * and the fonts load asynchronously. Before the hysteresis below that hole was invisible,
   * because the first pan marked the set dirty and collected the labels that the font-less first
   * pass had skipped. Now a pan inside the collected margin is deliberately free, so nothing
   * would ever ask again and the graph would stay silently unlabelled until the user dragged a
   * node. Depending on the memoised callback instead of on a hand-written list means the deps of
   * `collectTextEntries` are the single place that has to be right.
   */
  useEffect(() => {
    dirtyRef.current = true;
  }, [collectTextEntries]);

  // Collect entries on frame — only when dirty (avoids allocations on idle frames)
  useFrame(({ size }) => {
    const resized =
      size.width !== collectedWidthRef.current || size.height !== collectedHeightRef.current;

    if (!dirtyRef.current && !viewMovedRef.current && !resized) return;

    const { viewport, entities } = store.getState();

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;

    const rect = collectedRectRef.current;

    if (!dirtyRef.current) {
      // Nothing about the graph changed — only the camera, or the canvas. Glyph transforms are
      // world space, so the set already on the GPU is still the right answer as long as the
      // screen has not slid out of the margin it was collected for and the zoom has not crossed
      // an LOD cliff. This is the branch that makes a pan free.
      viewMovedRef.current = false;
      if (
        !collectedSetIsStale(
          rect,
          collectedLodRef.current,
          viewport.zoom,
          viewLeft,
          viewRight,
          viewTop,
          viewBottom
        )
      ) {
        collectedWidthRef.current = size.width;
        collectedHeightRef.current = size.height;
        return;
      }
    }

    if (entities.length > 0 && socketIndexMapRef.current.size === 0) {
      rebuildSocketIndexMap();
    }

    // Collect for a rect wider than the screen so the next several frames of a pan can reuse it.
    inflateViewRect(rect, viewLeft, viewRight, viewTop, viewBottom);

    /**
     * Which entities that rect holds, from the quadtree — not from a sweep of the graph.
     *
     * The query box carries `LABEL_CULL_PADDING` on top of the rect because the passes below
     * apply the same padding again when they test an individual label; querying for the bare rect
     * would drop an entity whose title or error line reaches into view from just outside it.
     *
     * `visibleIdsRef` is caller-owned and reused, so this allocates nothing per collect, and
     * `count` rather than `length` says how much of it is live.
     */
    const visibleQuery = visibleQueryRef.current;
    visibleQuery.x = rect.left - LABEL_CULL_PADDING;
    visibleQuery.y = rect.top - LABEL_CULL_PADDING;
    visibleQuery.width = rect.right - rect.left + LABEL_CULL_PADDING * 2;
    visibleQuery.height = rect.bottom - rect.top + LABEL_CULL_PADDING * 2;
    const visibleCount = store
      .getState()
      .quadtree.queryRangeInto(visibleQuery, visibleIdsRef.current);

    const { regular, semibold } = collectTextEntries(
      viewport.zoom,
      rect.left,
      rect.right,
      rect.top,
      rect.bottom,
      visibleIdsRef.current,
      visibleCount
    );

    // Update refs directly - available immediately to child useFrame calls
    regularEntriesRef.current = regular;
    semiboldEntriesRef.current = semibold;

    collectedLodRef.current = lodBucket(viewport.zoom);
    collectedWidthRef.current = size.width;
    collectedHeightRef.current = size.height;
    dirtyRef.current = false;
    viewMovedRef.current = false;
  });

  // If no fonts available, render nothing (graceful degradation to DOM mode)
  if (!regularFont) {
    return null;
  }

  return (
    <>
      <TextWeightRenderer
        fontData={regularFont}
        entriesRef={regularEntriesRef}
      />
      {/*
        The semibold mesh used to be gated on a piece of React state set from inside useFrame,
        flipped by whether any semibold entry survived the cull. Entity headers are the only
        semibold source and they are viewport-culled, so panning the last titled node off screen
        and back was a setState per crossing, mid-pan: a React re-render that unmounted this
        child, ran its disposal effects on the geometry and material, and then rebuilt an
        InstancedMesh and three attribute buffers on the way back in. That is the exact thing
        CLAUDE.md forbids during an interaction, bought for one idle draw call. Mounting it
        whenever the font exists costs that draw call and nothing else — the child already sets
        `mesh.count = 0` when its entries are empty, which draws no instances, and one mesh per
        weight is still one draw call per weight.
      */}
      {semiboldFont && (
        <TextWeightRenderer
          fontData={semiboldFont}
          entriesRef={semiboldEntriesRef}
        />
      )}
    </>
  );
}

// ============================================================================
// Legacy single-weight API (for backwards compatibility)
// ============================================================================

export interface TextRendererProps {
  /** Font metrics JSON */
  fontMetrics: FontMetrics;
  /** Font atlas texture */
  atlasTexture: THREE.Texture;
  /** Show socket labels */
  showSocketLabels?: boolean;
  /** Show edge labels */
  showEdgeLabels?: boolean;
  /** Default edge type for label positioning */
  defaultEdgeType?: EdgeType;
}

/**
 * Single-weight TextRenderer (legacy API).
 * @deprecated Use MultiWeightTextRenderer for multi-weight support.
 */
export function TextRenderer({ fontMetrics, atlasTexture, ...props }: TextRendererProps) {
  // Build maps for legacy callers that pass raw metrics/texture
  const fontData = useMemo<LoadedFontWeight>(() => ({
    metrics: fontMetrics,
    texture: atlasTexture,
    glyphMap: buildGlyphMap(fontMetrics),
    kerningMap: buildKerningMap(fontMetrics),
  }), [fontMetrics, atlasTexture]);

  return (
    <MultiWeightTextRenderer
      regularFont={fontData}
      {...props}
    />
  );
}

// Module-level caches — deduplicates concurrent requests for the same URL
const fontMetricsCache = new Map<string, Promise<FontMetrics>>();
const atlasTextureCache = new Map<string, Promise<THREE.Texture>>();

function fetchFontMetrics(url: string): Promise<FontMetrics> {
  let cached = fontMetricsCache.get(url);
  if (!cached) {
    cached = fetch(url).then((res) => res.json());
    fontMetricsCache.set(url, cached);
  }
  return cached;
}

function loadAtlasTexture(url: string): Promise<THREE.Texture> {
  let cached = atlasTextureCache.get(url);
  if (!cached) {
    cached = new Promise<THREE.Texture>((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.flipY = false;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          resolve(texture);
        },
        undefined,
        reject
      );
    });
    atlasTextureCache.set(url, cached);
  }
  return cached;
}

/**
 * Wrapper component that loads font atlas and metrics.
 * Uses React 19 `use()` — parent must wrap in <Suspense>.
 */
export interface TextRendererLoaderProps {
  /** Path to font metrics JSON */
  fontMetricsUrl: string;
  /** Path to font atlas PNG */
  atlasUrl: string;
  /** Show socket labels */
  showSocketLabels?: boolean;
  /** Show edge labels */
  showEdgeLabels?: boolean;
  /** Default edge type */
  defaultEdgeType?: EdgeType;
}

export function TextRendererLoader({
  fontMetricsUrl,
  atlasUrl,
  ...props
}: TextRendererLoaderProps) {
  const fontMetrics = use(fetchFontMetrics(fontMetricsUrl));
  const atlasTexture = use(loadAtlasTexture(atlasUrl));

  return <TextRenderer fontMetrics={fontMetrics} atlasTexture={atlasTexture} {...props} />;
}
