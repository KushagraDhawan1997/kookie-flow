/**
 * TextEntities - Renders text entities using instanced MSDF glyph rendering.
 * Phase 10B: MSDF-based text (replaces Canvas2D texture approach)
 *
 * Uses the same MSDF pipeline as node/socket/edge labels but with multi-line
 * word-wrap support. Single InstancedMesh = one draw call for all text entities.
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
import { useFont } from '../contexts/FontContext';
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

import type { GlyphMap, KerningMap } from '../utils/text-layout';

// Stable empty maps to avoid re-creating on every render when font isn't loaded
const emptyGlyphMap: GlyphMap = new Map();
const emptyKerningMap: KerningMap = new Map();

// Buffer capacity management
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;
const MAX_CAPACITY = 250000;

const RENDER_ORDER_BG = 1; // Non-selected (same as entities)
const RENDER_ORDER_FG = 4; // Selected (same as entities)

interface TextEntitiesProps {
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function TextEntities({ onEntitiesChange }: TextEntitiesProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const fontContext = useFont();
  const regularFont = fontContext.regular;

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const initializedRef = useRef(false);
  const dirtyRef = useRef(true);

  // Stable ref for onEntitiesChange to avoid stale closures in microtasks
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  onEntitiesChangeRef.current = onEntitiesChange;

  // Deferred dimension updates — batched via queueMicrotask to avoid store
  // mutations (array spread + quadtree update) inside the render loop.
  const pendingDimUpdatesRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const dimFlushScheduledRef = useRef(false);

  // Pre-built lookup maps from FontContext (shared across all text components)
  const glyphMap = regularFont?.glyphMap ?? emptyGlyphMap;
  const kerningMap = regularFont?.kerningMap ?? emptyKerningMap;

  // Derive text color from theme tokens — raw RGB, no color pipeline issues
  const primaryTextColor = rgbToHex(tokens[THEME_COLORS.text.primary]);

  // Create unit quad geometry
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Create MSDF shader material
  const material = useMemo(() => {
    if (!regularFont) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: regularFont.texture },
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
  }, [regularFont]);

  // Pre-allocated buffers
  const buffers = useMemo(
    () => ({
      matrices: new Float32Array(capacity * 16),
      uvOffsets: new Float32Array(capacity * 4),
      colors: new Float32Array(capacity * 3),
      opacities: new Float32Array(capacity),
      uvOffsetAttr: null as THREE.InstancedBufferAttribute | null,
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      opacityAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

  // Reset initialized flag when buffers change
  useEffect(() => {
    initializedRef.current = false;
  }, [buffers]);

  // Initialize attributes when mesh is ready.
  // Depends on material so this re-runs when font loads and mesh first mounts
  // (buffers alone won't change since it only depends on capacity).
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

    initializedRef.current = true;
    dirtyRef.current = true;
  }, [buffers, material]);

  // Subscribe to relevant store slices for dirty flagging.
  // Use positionVersion + entities.length instead of the full entities array
  // to avoid marking dirty when non-text entities change data (collapse, parent, etc.).
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubPositions = store.subscribe((s) => s.positionVersion, markDirty);
    const unsubTopology = store.subscribe((s) => s.entities.length, markDirty);
    const unsubViewport = store.subscribe((s) => s.viewport, markDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markDirty);
    const unsubEditing = store.subscribe((s) => s.editingEntityId, markDirty);
    const unsubEditContent = store.subscribe((s) => s.editingContent, markDirty);

    return () => {
      unsubPositions();
      unsubTopology();
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
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current || !regularFont || !dirtyRef.current) return;

    const {
      entities,
      viewport,
      selectedEntityIds,
      hiddenEntityIds,
      editingEntityId,
      editingContent,
    } = store.getState();

    const baseFontSize = regularFont.metrics.info.size;

    // Viewport frustum bounds for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 100;

    // Collect multi-line text entries
    const mlEntries: MultiLineTextEntry[] = [];

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

      // Handle empty content — show placeholder
      if (!content || !content.trim()) {
        const placeholderLines = wrapTextMSDF(
          'Type something...',
          (Math.max(1, w - 2 * padding)) * baseFontSize / fontSize,
          glyphMap, kerningMap, 0
        );
        mlEntries.push({
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

      mlEntries.push({
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

    if (mlEntries.length === 0) {
      mesh.count = 0;
      dirtyRef.current = false;
      return;
    }

    // Check capacity
    const estimatedGlyphs = countMultiLineGlyphs(mlEntries, glyphMap);
    if (estimatedGlyphs > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(estimatedGlyphs * BUFFER_GROWTH_FACTOR)));
      return;
    }

    // Populate buffers
    const glyphCount = populateMultiLineGlyphBuffers(
      mlEntries,
      regularFont.metrics,
      glyphMap,
      kerningMap,
      buffers.matrices,
      buffers.uvOffsets,
      buffers.colors,
      buffers.opacities,
      capacity
    );

    // Update GPU buffers
    const safeGlyphCount = Math.min(glyphCount, capacity);
    mesh.instanceMatrix.array.set(buffers.matrices.subarray(0, safeGlyphCount * 16));
    mesh.instanceMatrix.needsUpdate = true;

    if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
      buffers.uvOffsetAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.opacityAttr.needsUpdate = true;
    }

    mesh.count = safeGlyphCount;

    // renderOrder: use foreground for selected text entities
    // For simplicity, use the higher render order if any text entity is selected
    let hasSelected = false;
    for (const entry of mlEntries) {
      if (selectedEntityIds.has(entry.id)) {
        hasSelected = true;
        break;
      }
    }
    mesh.renderOrder = hasSelected ? RENDER_ORDER_FG : RENDER_ORDER_BG;

    dirtyRef.current = false;

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
  if (!regularFont || !material) return null;

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
