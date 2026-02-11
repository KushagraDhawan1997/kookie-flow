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
import { useFont } from '../contexts/FontContext';
import { THEME_COLORS } from '../core/theme-colors';
import {
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_PADDING,
} from '../core/constants';
import {
  type GlyphMap,
  type KerningMap,
  buildGlyphMap,
  buildKerningMap,
} from '../utils/text-layout';
import {
  buildCharPositionsForEntity,
  getCursorXY,
  getSelectionRects,
} from '../utils/text-cursor-layout';
import type { TextEntityData } from '../types';

const CURSOR_WIDTH = 1.5; // pixels (world units before zoom)
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

  const glyphMap = useMemo<GlyphMap>(
    () => (regularFont ? buildGlyphMap(regularFont.metrics) : new Map()),
    [regularFont]
  );
  const kerningMap = useMemo<KerningMap>(
    () => (regularFont ? buildKerningMap(regularFont.metrics) : new Map()),
    [regularFont]
  );

  const cursorMeshRef = useRef<THREE.Mesh>(null);
  const selectionMeshRef = useRef<THREE.InstancedMesh>(null);
  const blinkTimerRef = useRef(0);
  const blinkVisibleRef = useRef(true);
  const dirtyRef = useRef(true);
  const lastCursorRef = useRef<{ start: number; end: number } | null>(null);

  // Accent color for cursor
  const accentColor = tokens[THEME_COLORS.entitySelection.selected];

  // Cursor material (single mesh, not instanced)
  const cursorMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) }, // white cursor
        uOpacity: { value: 1.0 },
      },
      vertexShader: cursorVertexShader,
      fragmentShader: cursorFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, []);

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
    const unsubViewport = store.subscribe((s) => s.viewport, markDirty);
    return () => { unsubEntity(); unsubContent(); unsubCursor(); unsubViewport(); };
  }, [store]);

  useFrame(({ clock }) => {
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

    // Build character position table (only when dirty)
    // In practice this runs every frame during editing — acceptable since
    // buildCharPositionsForEntity is fast (no GPU work, just array math)
    const table = buildCharPositionsForEntity(
      content, fontSize, lineHeightMul, textAlign,
      w, pad, entity.position.x, entity.position.y,
      regularFont.metrics, glyphMap, kerningMap, letterSpacing
    );

    const hasSelection = editingCursor.start !== editingCursor.end;

    if (hasSelection) {
      // --- Selection rendering ---
      cursorMesh.visible = false;

      const rects = getSelectionRects(
        editingCursor.start, editingCursor.end, table
      );

      const count = Math.min(rects.length, MAX_SELECTION_INSTANCES);
      const matrix = new THREE.Matrix4();

      for (let i = 0; i < count; i++) {
        const rect = rects[i];
        // Position at rect center, scale to rect size
        matrix.makeScale(rect.width, rect.height, 1);
        matrix.setPosition(
          rect.x + rect.width / 2,
          -(rect.y + rect.height / 2), // flip Y for Three.js
          SELECTION_Z
        );
        selectionMesh.setMatrixAt(i, matrix);
      }

      selectionMesh.count = count;
      if (count > 0) {
        selectionMesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      // --- Cursor rendering (blinking) ---
      selectionMesh.count = 0;

      // Blink timer
      const dt = clock.getDelta() * 1000;
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

        // Scale: CURSOR_WIDTH wide, lineHeight tall
        cursorMesh.scale.set(CURSOR_WIDTH, cursorPos.height, 1);
        cursorMesh.position.set(
          cursorPos.x + CURSOR_WIDTH / 2,
          -(cursorPos.y + cursorPos.height / 2), // flip Y
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
