/**
 * TextEntities - Renders text entities using instanced MSDF glyph rendering.
 * Phase 10B: MSDF-based text (replaces Canvas2D texture approach)
 *
 * Supports multiple font weights with separate InstancedMesh per weight
 * (one draw call per weight). Uses the same MSDF pipeline as node/socket/edge
 * labels but with multi-line word-wrap support.
 *
 * Key advantages over Canvas2D textures:
 * - Crisp at any zoom level (resolution-independent SDF)
 * - Correct colors (raw gl_FragColor, no Three.js color management)
 * - No position shift between WebGL and DOM overlay
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useFont, type LoadedFontWeight } from '../contexts/FontContext';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { msdfVertexShader, msdfFragmentShader, MSDF_SHADER_DEFAULTS } from '../utils/msdf-shader';
import type { TextEntityData, EntityChange } from '../types';
import {
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_PADDING,
  DEFAULT_TEXT_SIZING_MODE,
} from '../core/constants';
import { NO_WRAP_WIDTH } from '../utils/text-texture';
import {
  type MultiLineTextEntry,
  wrapTextMSDF,
  measureTextBlockMSDF,
  countMultiLineGlyphs,
  populateMultiLineGlyphBuffers,
} from '../utils/text-layout';


// Buffer capacity management
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;
const MAX_CAPACITY = 250000;

const RENDER_ORDER_BG = 1; // Non-selected (same as entities)
const RENDER_ORDER_FG = 4; // Selected (same as entities)

// Sentinel array — unique reference that never equals any real entries array.
// Used to force buffer re-population after capacity resize.
const SENTINEL_ENTRIES: MultiLineTextEntry[] = [];

// ============================================================================
// TextEntityWeightMesh — renders one font weight's text entities
// ============================================================================

interface TextEntityWeightMeshProps {
  fontData: LoadedFontWeight;
  entriesRef: React.MutableRefObject<MultiLineTextEntry[]>;
  storeRef: React.MutableRefObject<ReturnType<typeof useFlowStoreApi>>;
}

/**
 * Renders text entities for a single font weight using instanced MSDF.
 * Manages its own GPU buffers and capacity.
 */
function TextEntityWeightMesh({ fontData, entriesRef, storeRef }: TextEntityWeightMeshProps) {
  const { metrics, texture, glyphMap, kerningMap } = fontData;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const initializedRef = useRef(false);
  const lastEntriesRef = useRef<MultiLineTextEntry[]>(SENTINEL_ENTRIES);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: texture },
        uThreshold: { value: MSDF_SHADER_DEFAULTS.threshold },
        uAlphaTest: { value: MSDF_SHADER_DEFAULTS.alphaTest },
      },
      vertexShader: msdfVertexShader,
      fragmentShader: msdfFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }, [texture]);

  /**
   * Material and geometry only — NEVER the atlas texture.
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

  useEffect(() => {
    initializedRef.current = false;
    lastEntriesRef.current = SENTINEL_ENTRIES;
  }, [buffers]);

  useEffect(() => {
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

    // Same reference as last frame — parent didn't re-collect, nothing changed
    if (entries === lastEntriesRef.current) return;
    lastEntriesRef.current = entries;

    if (entries.length === 0) {
      mesh.count = 0;
      return;
    }

    // Check capacity
    const estimatedGlyphs = countMultiLineGlyphs(entries, glyphMap);
    if (estimatedGlyphs > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(estimatedGlyphs * BUFFER_GROWTH_FACTOR)));
      return;
    }

    // Populate buffers
    const glyphCount = populateMultiLineGlyphBuffers(
      entries,
      metrics,
      glyphMap,
      kerningMap,
      matrices,
      buffers.uvOffsets,
      buffers.colors,
      buffers.opacities,
      capacity
    );

    // Update GPU buffers
    const safeGlyphCount = Math.min(glyphCount, capacity);
    mesh.instanceMatrix.needsUpdate = true;

    if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
      buffers.uvOffsetAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.opacityAttr.needsUpdate = true;
    }

    mesh.count = safeGlyphCount;

    // renderOrder: use foreground for selected text entities
    const { selectedEntityIds } = storeRef.current.getState();
    let hasSelected = false;
    for (const entry of entries) {
      if (entry.id !== undefined && selectedEntityIds.has(entry.id)) {
        hasSelected = true;
        break;
      }
    }
    mesh.renderOrder = hasSelected ? RENDER_ORDER_FG : RENDER_ORDER_BG;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      renderOrder={RENDER_ORDER_BG}
    />
  );
}

// ============================================================================
// TextEntities — orchestrator that splits entities by font weight
// ============================================================================

interface TextEntitiesProps {
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function TextEntities({ onEntitiesChange }: TextEntitiesProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const fontContext = useFont();
  const regularFont = fontContext.regular;
  const semiboldFont = fontContext.semibold;

  const dirtyRef = useRef(true);

  // Stable ref for onEntitiesChange to avoid stale closures in microtasks
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  onEntitiesChangeRef.current = onEntitiesChange;

  // Stable store ref for children
  const storeRef = useRef(store);
  storeRef.current = store;

  // Deferred dimension updates — batched via queueMicrotask to avoid store
  // mutations (array spread + quadtree update) inside the render loop.
  const pendingDimUpdatesRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const dimFlushScheduledRef = useRef(false);

  // Entries by weight — refs for same-frame child reads
  const regularEntriesRef = useRef<MultiLineTextEntry[]>([]);
  const semiboldEntriesRef = useRef<MultiLineTextEntry[]>([]);

  // Track whether semibold entries exist (for conditional mount)
  const [hasSemiboldEntries, setHasSemiboldEntries] = useState(false);

  // Derive text color from theme tokens — raw RGB, no color pipeline issues
  const primaryTextColor = rgbToHex(tokens[THEME_COLORS.text.primary]);

  // Subscribe to relevant store slices for dirty flagging.
  // We subscribe to the full `entities` array (not just `entities.length`) to catch
  // text property changes (fontWeight, fontSize, textAlign, etc.) from the toolbar.
  // During drag, positionVersion already triggers dirty — the entities subscription
  // fires too but is a no-op (idempotent boolean set). The only extra cost is
  // one O(n) scan when non-text entities change data, which is rare and cheap.
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubPositions = store.subscribe((s) => s.positionVersion, markDirty);
    const unsubEntities = store.subscribe((s) => s.entities, markDirty);
    const unsubViewport = store.subscribe((s) => s.viewport, markDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markDirty);
    const unsubEditing = store.subscribe((s) => s.editingEntityId, markDirty);
    const unsubEditContent = store.subscribe((s) => s.editingContent, markDirty);

    return () => {
      unsubPositions();
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubHidden();
      unsubEditing();
      unsubEditContent();
    };
  }, [store]);

  // Re-render when theme changes
  useEffect(() => {
    dirtyRef.current = true;
  }, [primaryTextColor]);

  useFrame(({ size }) => {
    if (!regularFont || !dirtyRef.current) return;

    const {
      entities,
      viewport,
      hiddenEntityIds,
      editingEntityId,
      editingContent,
    } = store.getState();

    // Viewport frustum bounds for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 100;

    // Collect multi-line text entries, split by weight
    const regularEntries: MultiLineTextEntry[] = [];
    const semiboldEntries: MultiLineTextEntry[] = [];

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity.type !== 'text') continue;
      if (hiddenEntityIds.has(entity.id)) continue;

      let w = entity.width ?? DEFAULT_TEXT_WIDTH;
      let h = entity.height ?? DEFAULT_TEXT_HEIGHT;
      const data = entity.data as TextEntityData;

      const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
      const lineHeight = data.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
      const padding = DEFAULT_TEXT_PADDING;
      const letterSpacing = data.letterSpacing ?? 0;
      const textAlign = data.textAlign ?? 'left';
      const sizingMode = data.sizingMode ?? DEFAULT_TEXT_SIZING_MODE;
      // Use live editing content when this entity is being edited
      const content = (editingEntityId === entity.id && editingContent !== null)
        ? editingContent
        : (data.content ?? '');

      // Resolve font weight — use semibold atlas for weight >= 600
      const fontWeight = data.fontWeight ?? 400;
      const useSemibold = fontWeight >= 600 && semiboldFont != null;
      const font = useSemibold ? semiboldFont! : regularFont;
      const glyphMap = font.glyphMap;
      const kerningMap = font.kerningMap;
      const baseFontSize = font.metrics.info.size;

      // Mode-aware dimension logic
      let measurement;
      let expectedW = w;
      let expectedH = h;

      if (sizingMode === 'auto-width') {
        // No word wrap — measure at effectively infinite width
        measurement = measureTextBlockMSDF(
          content, fontSize, lineHeight, NO_WRAP_WIDTH, padding,
          baseFontSize, glyphMap, kerningMap, letterSpacing
        );
        expectedW = Math.max(measurement.width + 2 * padding, fontSize + 2 * padding);
        expectedH = Math.max(
          measurement.height + 2 * padding,
          fontSize * lineHeight + 2 * padding
        );
      } else {
        // auto-height + fixed: wrap at entity width
        measurement = measureTextBlockMSDF(
          content, fontSize, lineHeight, w, padding,
          baseFontSize, glyphMap, kerningMap, letterSpacing
        );
        if (sizingMode === 'auto-height') {
          expectedH = Math.max(
            measurement.height + 2 * padding,
            fontSize * lineHeight + 2 * padding
          );
        }
        // fixed: expectedH stays as stored entity.height
      }

      // Defer store writes to avoid entities array spread + quadtree update
      // inside the render loop. Use the correct dimensions locally for this frame.
      // Skip the entity being edited — no store/quadtree writes during editing.
      // commitAndExit handles the final dimension + onEntitiesChange update.
      if (editingEntityId !== entity.id) {
        const wChanged = sizingMode === 'auto-width' && Math.abs(w - expectedW) > 0.5;
        const hChanged = sizingMode !== 'fixed' && Math.abs(h - expectedH) > 0.5;
        if (wChanged || hChanged) {
          pendingDimUpdatesRef.current.set(entity.id, {
            w: wChanged ? expectedW : w,
            h: hChanged ? expectedH : h,
          });
          if (wChanged) w = expectedW;
          if (hChanged) h = expectedH;
        }
      } else {
        // Editing entity: use expected dimensions locally but don't write to store
        if (sizingMode === 'auto-width') w = expectedW;
        if (sizingMode !== 'fixed') h = expectedH;
      }

      // Frustum culling
      const entityRight = entity.position.x + w;
      const entityBottom = entity.position.y + h;
      if (
        entityRight < viewLeft - cullPadding ||
        entity.position.x > viewRight + cullPadding ||
        entityBottom < viewTop - cullPadding ||
        entity.position.y > viewBottom + cullPadding
      ) continue;

      // Resolve text color
      const textColor = data.textColor ?? primaryTextColor;

      // Target entry list based on weight
      const targetEntries = useSemibold ? semiboldEntries : regularEntries;

      // Handle empty content — show placeholder
      if (!content || !content.trim()) {
        const placeholderLines = wrapTextMSDF(
          'Type something...',
          (Math.max(1, w - 2 * padding)) * baseFontSize / fontSize,
          glyphMap, kerningMap, 0
        );
        targetEntries.push({
          id: entity.id,
          lines: placeholderLines,
          position: [entity.position.x + padding, entity.position.y + padding, 0.1],
          fontSize,
          lineHeight,
          textAlign: 'left',
          constrainedWidth: Math.max(1, w - 2 * padding),
          color: textColor,
          opacity: 0.3,
          letterSpacing,
        });
        continue;
      }

      // Overflow clipping: only in fixed mode when content exceeds bounds
      const clipHeight = (sizingMode === 'fixed' && h < (measurement.height + 2 * padding))
        ? h - 2 * padding
        : undefined;

      targetEntries.push({
        id: entity.id,
        lines: measurement.lines,
        position: [entity.position.x + padding, entity.position.y + padding, 0.1],
        fontSize,
        lineHeight,
        textAlign,
        constrainedWidth: sizingMode === 'auto-width'
          ? Math.max(1, expectedW - 2 * padding)
          : Math.max(1, w - 2 * padding),
        color: textColor,
        opacity: 1,
        letterSpacing,
        maxHeight: clipHeight,
      });
    }

    // Write new arrays to refs — children detect change via reference identity
    regularEntriesRef.current = regularEntries;
    semiboldEntriesRef.current = semiboldEntries;

    dirtyRef.current = false;

    // Update hasSemiboldEntries only when presence changes (avoids React re-renders)
    const hasSemibold = semiboldEntries.length > 0;
    if (hasSemibold !== hasSemiboldEntries) {
      setHasSemiboldEntries(hasSemibold);
    }

    // Flush pending dimension updates via microtask — runs after useFrame
    // completes but before the next paint. The store update triggers subscribers
    // which re-set dirtyRef, so the next frame sees the corrected heights and
    // the condition becomes false (convergence in 2 frames).
    if (pendingDimUpdatesRef.current.size > 0 && !dimFlushScheduledRef.current) {
      dimFlushScheduledRef.current = true;
      queueMicrotask(() => {
        dimFlushScheduledRef.current = false;
        const pending = pendingDimUpdatesRef.current;
        if (pending.size === 0) return;
        // Collect dimension changes for parent propagation
        const dimChanges: EntityChange[] = [];
        for (const [id, { w, h }] of pending) {
          store.getState().updateEntityDimensions(id, w, h);
          dimChanges.push({ type: 'dimensions', id, dimensions: { width: w, height: h } });
        }
        pending.clear();
        // Propagate to parent so controlled state stays in sync —
        // prevents setEntities from wiping auto-computed heights
        onEntitiesChangeRef.current?.(dimChanges);
      });
    }
  });

  // Don't render if font not loaded
  if (!regularFont) return null;

  return (
    <>
      <TextEntityWeightMesh
        fontData={regularFont}
        entriesRef={regularEntriesRef}
        storeRef={storeRef}
      />
      {semiboldFont && hasSemiboldEntries && (
        <TextEntityWeightMesh
          fontData={semiboldFont}
          entriesRef={semiboldEntriesRef}
          storeRef={storeRef}
        />
      )}
    </>
  );
}
