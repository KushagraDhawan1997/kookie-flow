/**
 * TextEditCursor — WebGL cursor line + selection rectangles for text editing.
 *
 * Renders inside the R3F Canvas. Reads editingEntityId, editingContent,
 * and editingCursor from the Zustand store via dirty flags (no React
 * re-renders). Updates every frame via useFrame.
 *
 * - Cursor: single Mesh (thin rectangle, blinking 530ms)
 * - Selection: InstancedMesh (one quad per selected line, max 50)
 */

import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useFont, resolveFontForWeight } from '../contexts/FontContext';
import { THEME_COLORS } from '../core/theme-colors';
import {
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_PADDING,
} from '../core/constants';
import {
  type CharPositionTable,
  type SelectionRect,
  getSharedCharPositionTable,
  clearSharedCharPositionTable,
  getCursorXY,
  getSelectionRects,
} from '../utils/text-cursor-layout';
import type { TextEntityData } from '../types';
import { DEFAULT_TEXT_SIZING_MODE } from '../core/constants';
import { NO_WRAP_WIDTH } from '../utils/text-texture';

const CURSOR_WIDTH = 1.0; // pixels (world units before zoom)
const CURSOR_GAP = 1; // gap between last character and cursor (world units)
const CURSOR_BLINK_MS = 530;
const CURSOR_Z = 0.15; // slightly above text (at 0.1)
const SELECTION_Z = 0.05; // behind text
const MAX_SELECTION_INSTANCES = 50;

const RENDER_ORDER_SELECTION = 3;
const RENDER_ORDER_CURSOR = 4;

// Flat color shaders (no texture, just color + opacity)
const flatVertexShader = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const flatFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

const cursorVertexShader = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const cursorFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

export function TextEditCursor() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const fontContext = useFont();
  const regularFont = fontContext.regular;

  const cursorMeshRef = useRef<THREE.Mesh>(null);
  const selectionMeshRef = useRef<THREE.InstancedMesh>(null);
  const blinkTimerRef = useRef(0);
  const blinkVisibleRef = useRef(true);
  const dirtyRef = useRef(true);
  const lastCursorRef = useRef<{ start: number; end: number } | null>(null);

  // Selection caching (avoid per-frame allocations)
  const lastTableRef = useRef<CharPositionTable | null>(null);
  const cachedRectsRef = useRef<SelectionRect[]>([]);
  const lastSelKeyRef = useRef({ start: -1, end: -1, tableChanged: false });
  const matrixTmpRef = useRef(new THREE.Matrix4());

  // Theme colors
  const accentColor = tokens[THEME_COLORS.entitySelection.selected];
  const primaryTextColor = tokens[THEME_COLORS.text.primary];

  // Cursor material (single mesh, not instanced)
  const cursorMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(primaryTextColor[0], primaryTextColor[1], primaryTextColor[2]) },
        uOpacity: { value: 1.0 },
      },
      vertexShader: cursorVertexShader,
      fragmentShader: cursorFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [primaryTextColor]);

  // Selection material (instanced)
  const selectionMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(accentColor[0], accentColor[1], accentColor[2]) },
        uOpacity: { value: 0.3 },
      },
      vertexShader: flatVertexShader,
      fragmentShader: flatFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [accentColor]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Subscribe to editing state changes for dirty flagging
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsubEntity = store.subscribe((s) => s.editingEntityId, markDirty);
    const unsubContent = store.subscribe((s) => s.editingContent, markDirty);
    const unsubCursor = store.subscribe((s) => s.editingCursor, markDirty);
    return () => { unsubEntity(); unsubContent(); unsubCursor(); };
  }, [store]);

  useFrame((_state, delta) => {
    const cursorMesh = cursorMeshRef.current;
    const selectionMesh = selectionMeshRef.current;
    if (!cursorMesh || !selectionMesh || !regularFont) return;

    const {
      editingEntityId,
      editingContent,
      editingCursor,
      entityMap,
    } = store.getState();

    // Not editing: hide everything
    if (!editingEntityId || editingCursor === null) {
      cursorMesh.visible = false;
      selectionMesh.count = 0;
      blinkTimerRef.current = 0;
      blinkVisibleRef.current = true;
      lastCursorRef.current = null;
      lastTableRef.current = null;
      clearSharedCharPositionTable();
      return;
    }

    const entity = entityMap.get(editingEntityId);
    if (!entity || entity.type !== 'text') {
      cursorMesh.visible = false;
      selectionMesh.count = 0;
      return;
    }

    // Reset blink when cursor moves
    if (
      !lastCursorRef.current ||
      lastCursorRef.current.start !== editingCursor.start ||
      lastCursorRef.current.end !== editingCursor.end
    ) {
      blinkTimerRef.current = 0;
      blinkVisibleRef.current = true;
      lastCursorRef.current = { ...editingCursor };
      dirtyRef.current = true;
    }

    const data = entity.data as TextEntityData;
    const content = editingContent ?? data.content ?? '';
    const w = entity.width ?? DEFAULT_TEXT_WIDTH;
    const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const lineHeightMul = data.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
    const letterSpacing = data.letterSpacing ?? 0;
    const textAlign = data.textAlign ?? 'left';
    const pad = DEFAULT_TEXT_PADDING;
    const sizingMode = data.sizingMode ?? DEFAULT_TEXT_SIZING_MODE;

    // Resolve font for this entity's weight
    const font = resolveFontForWeight(fontContext, data.fontWeight ?? 400);
    if (!font || font.glyphMap.size === 0) {
      cursorMesh.visible = false;
      selectionMesh.count = 0;
      return;
    }

    // Sync cursor color with entity text color (custom or theme default)
    if (data.textColor) {
      const c = cursorMaterial.uniforms.uColor.value as THREE.Color;
      c.set(data.textColor);
    } else {
      const c = cursorMaterial.uniforms.uColor.value as THREE.Color;
      c.setRGB(primaryTextColor[0], primaryTextColor[1], primaryTextColor[2]);
    }

    // Use NO_WRAP_WIDTH for auto-width mode to match the text renderer
    // (prevents floating-point precision mismatches that cause unexpected wrapping)
    const layoutWidth = sizingMode === 'auto-width' ? NO_WRAP_WIDTH : w;
    const fontId = (data.fontWeight ?? 400) >= 600 ? 'semibold' : 'regular';

    // Get character position table (shared cache with TextEditOverlay)
    const table = getSharedCharPositionTable(
      content, fontSize, lineHeightMul, textAlign,
      layoutWidth, pad, entity.position.x, entity.position.y,
      font.metrics, font.glyphMap, font.kerningMap, letterSpacing, fontId
    );
    const tableChanged = table !== lastTableRef.current;
    lastTableRef.current = table;

    const hasSelection = editingCursor.start !== editingCursor.end;

    if (hasSelection) {
      // --- Selection rendering ---
      cursorMesh.visible = false;

      // Cache selection rects — only rebuild when range or table changed
      const sk = lastSelKeyRef.current;
      const selChanged = (
        editingCursor.start !== sk.start ||
        editingCursor.end !== sk.end ||
        tableChanged
      );

      if (selChanged) {
        cachedRectsRef.current = getSelectionRects(
          editingCursor.start, editingCursor.end, table
        );
        sk.start = editingCursor.start;
        sk.end = editingCursor.end;

        const rects = cachedRectsRef.current;
        const count = Math.min(rects.length, MAX_SELECTION_INSTANCES);
        const matrix = matrixTmpRef.current;

        for (let i = 0; i < count; i++) {
          const rect = rects[i];
          matrix.makeScale(rect.width, rect.height, 1);
          matrix.setPosition(
            rect.x + rect.width / 2,
            -(rect.y + rect.height / 2),
            SELECTION_Z
          );
          selectionMesh.setMatrixAt(i, matrix);
        }

        selectionMesh.count = count;
        if (count > 0) {
          selectionMesh.instanceMatrix.needsUpdate = true;
        }
      }
    } else {
      // --- Cursor rendering (blinking) ---
      selectionMesh.count = 0;

      // Blink timer — use R3F's delta (seconds) instead of clock.getDelta()
      // which can return 0 if another component calls it first
      const dt = delta * 1000;
      blinkTimerRef.current += dt;
      if (blinkTimerRef.current >= CURSOR_BLINK_MS) {
        blinkVisibleRef.current = !blinkVisibleRef.current;
        blinkTimerRef.current = 0;
      }

      cursorMesh.visible = blinkVisibleRef.current;

      if (cursorMesh.visible || dirtyRef.current) {
        const cursorPos = getCursorXY(
          editingCursor.start, table,
          entity.position.x, entity.position.y, pad
        );

        // Add gap when cursor is after a character (not at position 0 on empty text)
        const gap = (editingCursor.start > 0 || content.length > 0) ? CURSOR_GAP : 0;

        // Use actual BMFont glyph height (not full lineHeight which includes leading)
        // cursorPos.y already starts at halfLeading offset, so this aligns with glyphs
        const scale = fontSize / font.metrics.info.size;
        let glyphHeight = font.metrics.common.lineHeight * scale;

        // Clamp cursor to entity bounds in fixed mode only.
        // In auto-height/auto-width, entity.height in the store may be stale
        // during editing (dimensions update on commitAndExit, not per keystroke).
        if (sizingMode === 'fixed') {
          const h = entity.height ?? DEFAULT_TEXT_HEIGHT;
          const entityBottom = entity.position.y + h;
          const cursorBottom = cursorPos.y + glyphHeight;
          if (cursorBottom > entityBottom) {
            glyphHeight = Math.max(1, entityBottom - cursorPos.y);
          }
        }

        cursorMesh.scale.set(CURSOR_WIDTH, glyphHeight, 1);
        cursorMesh.position.set(
          cursorPos.x + gap + CURSOR_WIDTH / 2,
          -(cursorPos.y + glyphHeight / 2), // flip Y, center on glyph height
          CURSOR_Z
        );
      }
    }

    dirtyRef.current = false;
  });

  if (!regularFont) return null;

  return (
    <>
      {/* Cursor line */}
      <mesh
        ref={cursorMeshRef}
        geometry={geometry}
        material={cursorMaterial}
        visible={false}
        frustumCulled={false}
        renderOrder={RENDER_ORDER_CURSOR}
      />
      {/* Selection rectangles */}
      <instancedMesh
        ref={selectionMeshRef}
        args={[geometry, selectionMaterial, MAX_SELECTION_INSTANCES]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER_SELECTION}
      />
    </>
  );
}
