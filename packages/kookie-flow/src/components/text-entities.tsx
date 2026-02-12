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
import type { TextEntityData } from '../types';
import {
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_PADDING,
} from '../core/constants';
import {
  type GlyphMap,
  type KerningMap,
  type MultiLineTextEntry,
  buildGlyphMap,
  buildKerningMap,
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

export function TextEntities() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const fontContext = useFont();
  const regularFont = fontContext.regular;

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const initializedRef = useRef(false);
  const dirtyRef = useRef(true);

  // Pre-built lookup maps (memoized on font change)
  const glyphMap = useMemo<GlyphMap>(
    () => (regularFont ? buildGlyphMap(regularFont.metrics) : new Map()),
    [regularFont]
  );
  const kerningMap = useMemo<KerningMap>(
    () => (regularFont ? buildKerningMap(regularFont.metrics) : new Map()),
    [regularFont]
  );

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

  // Subscribe to relevant store slices for dirty flagging
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubEntities = store.subscribe((s) => s.entities, markDirty);
    const unsubViewport = store.subscribe((s) => s.viewport, markDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markDirty);
    const unsubEditing = store.subscribe((s) => s.editingEntityId, markDirty);
    const unsubEditContent = store.subscribe((s) => s.editingContent, markDirty);

    return () => {
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

      const w = entity.width ?? DEFAULT_TEXT_WIDTH;
      let h = entity.height ?? DEFAULT_TEXT_HEIGHT;
      const data = entity.data as TextEntityData;

      const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
      const lineHeight = data.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
      const padding = DEFAULT_TEXT_PADDING;
      const letterSpacing = data.letterSpacing ?? 0;
      const textAlign = data.textAlign ?? 'left';
      // Use live editing content when this entity is being edited
      const content = (editingEntityId === entity.id && editingContent !== null)
        ? editingContent
        : (data.content ?? '');

      // Auto-correct height to match text content
      const measurement = measureTextBlockMSDF(
        content, fontSize, lineHeight, w, padding,
        baseFontSize, glyphMap, kerningMap, letterSpacing
      );
      const expectedH = Math.max(
        measurement.height + 2 * padding,
        fontSize * lineHeight + 2 * padding
      );
      // Skip store write for the entity being edited — its height is already
      // maintained by TextEditOverlay.handleInput, avoiding a redundant
      // entities array spread + quadtree update inside the render loop.
      if (editingEntityId !== entity.id && Math.abs(h - expectedH) > 0.5) {
        store.getState().updateEntityDimensions(entity.id, w, expectedH);
        h = expectedH;
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

      // Overflow clipping: if entity has user-controlled height (not auto-height),
      // clip text that exceeds the entity bounds
      const isAutoHeight = typeof entity.resizable === 'object'
        ? !(entity.resizable.height ?? false)
        : true;
      const clipHeight = (!isAutoHeight && h < expectedH)
        ? h - 2 * padding
        : undefined;

      mlEntries.push({
        id: entity.id,
        lines: measurement.lines,
        position: [entity.position.x + padding, entity.position.y + padding, 0.1],
        fontSize,
        lineHeight,
        textAlign,
        constrainedWidth: Math.max(1, w - 2 * padding),
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
