import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { squircleBoxSDF, CORNER_K } from '../utils/corner-shader';
import {
  DEFAULT_ENTITY_WIDTH,
  SELECTION_OUTLINE_WIDTH,
  SELECTION_OUTLINE_PADDING,
  HOVER_OUTLINE_WIDTH,
  RESIZE_HANDLE_SIZE,
} from '../core/constants';
import { getInteractionMode } from './interaction-state';

// Pre-allocated objects to avoid GC
const tempMatrix = new THREE.Matrix4();
const tempScale = new THREE.Vector3();

// Buffer sizes
const OUTLINE_MIN_CAPACITY = 64;
const HANDLE_MIN_CAPACITY = 4; // the four corners of the one selected entity under the pointer
const BUFFER_GROWTH_FACTOR = 1.5;

/**
 * The selection halo: accent light falling OUTSIDE the ring, never inside the card. Screen px,
 * so it is divided by zoom where `uZoom` is written. The alpha is a pair because the same light
 * on a dark floor reads twice as bright as on a light one.
 */
const SELECTION_GLOW_PX = 12;
const SELECTION_GLOW_ALPHA = { dark: 0.18, light: 0.12 } as const;

/** Drawn radius of a resize handle, in screen px. The quad and the hit test stay RESIZE_HANDLE_SIZE. */
const HANDLE_DOT_RADIUS_PX = 3;

/**
 * Universal selection outline + resize handle renderer.
 *
 * Renders:
 * 1. Selection outlines: a 1px accent hairline plus a soft halo outside it on selected entities,
 *    a gray hairline on hovered entities. Constant screen-space thickness.
 * 2. Resize handles: four accent corner dots, drawn only while the selected entity is also the
 *    hovered one. The mid-edge handles are still hit-testable (kookie-flow.tsx) and the cursor
 *    is their affordance. Hidden during drag/connect/box-select operations.
 */
export function EntitySelection() {
  const store = useFlowStoreApi();
  const resolvedStyle = useResolvedStyle();
  const socketLayout = useSocketLayout();
  const tokens = useTheme();

  // --- Outline mesh ---
  const outlineMeshRef = useRef<THREE.InstancedMesh>(null);
  const outlineDirtyRef = useRef(true);
  const outlineInitializedRef = useRef(false);
  const [outlineCapacity, setOutlineCapacity] = useState(OUTLINE_MIN_CAPACITY);

  // --- Handle mesh ---
  const handleMeshRef = useRef<THREE.InstancedMesh>(null);
  const handleDirtyRef = useRef(true);
  const handleInitializedRef = useRef(false);
  const [handleCapacity, setHandleCapacity] = useState(HANDLE_MIN_CAPACITY);

  // ============================================================================
  // Outline material (SDF outline-only, no fill)
  // ============================================================================

  const outlineGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { outlineGeometry.dispose(); }, [outlineGeometry]);

  // Resolve theme colors
  const selectedColor = tokens[THEME_COLORS.entitySelection.selected];
  const hoverColor = tokens[THEME_COLORS.entitySelection.hover];

  const glowAlpha = SELECTION_GLOW_ALPHA[tokens.appearance];

  const outlineMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uSelectedColor: { value: new THREE.Color(selectedColor[0], selectedColor[1], selectedColor[2]) },
        uHoverColor: { value: new THREE.Color(hoverColor[0], hoverColor[1], hoverColor[2]) },
        // The card radius, so the ring and its halo follow the corners. This was left at 0 and
        // never written: every selection and hover outline drew square around a rounded card.
        uCornerRadius: { value: resolvedStyle.borderRadius * CORNER_K },
        uZoom: { value: 1.0 },
        // The halo's reach in world units (SELECTION_GLOW_PX / zoom), written beside uZoom.
        uGlow: { value: SELECTION_GLOW_PX },
        uGlowAlpha: { value: glowAlpha },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSize;
        attribute float aType; // 0 = hover, 1 = selected
        attribute float aOutlineWidth; // screen-space width (pre-divided by zoom)
        attribute float aPadding; // screen-space padding (pre-divided by zoom)

        uniform float uGlow;

        varying vec2 vUv;
        varying vec2 vSize;
        varying float vType;
        varying float vOutlineWidth;
        varying float vPadding;
        varying vec2 vExpandedSize;

        void main() {
          vUv = uv;
          vSize = aSize;
          vType = aType;
          vOutlineWidth = aOutlineWidth;
          vPadding = aPadding;

          // Expand geometry to include outline + padding, and the halo for selected only:
          // hover is a hairline and pays for no halo fragments.
          float expand = aPadding + aOutlineWidth + uGlow * aType;
          vec2 expandedSize = aSize + vec2(expand * 2.0);
          vExpandedSize = expandedSize;

          vec3 pos = position;
          pos.x *= expandedSize.x;
          pos.y *= expandedSize.y;

          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform vec3 uSelectedColor;
        uniform vec3 uHoverColor;
        uniform float uCornerRadius;
        uniform float uZoom;
        uniform float uGlow;
        uniform float uGlowAlpha;

        varying vec2 vUv;
        varying vec2 vSize;
        varying float vType;
        varying float vOutlineWidth;
        varying float vPadding;
        varying vec2 vExpandedSize;

        ${squircleBoxSDF}

        void main() {
          // Map UV to expanded coordinate space
          vec2 p = (vUv - 0.5) * vExpandedSize;

          // SDF for the outline boundary (entity size + padding)
          vec2 outerHalf = vSize * 0.5 + vec2(vPadding);
          float outerD = roundedBoxSDF(p, outerHalf, uCornerRadius + vPadding);

          // Inner boundary (entity size + padding - outline width)
          float innerD = roundedBoxSDF(p, outerHalf - vec2(vOutlineWidth), uCornerRadius + vPadding - vOutlineWidth);

          // AA
          float aa = fwidth(outerD) * 1.5;

          // Outline mask: inside outer, outside inner
          float outerMask = 1.0 - smoothstep(-aa, aa, outerD);
          float innerMask = 1.0 - smoothstep(-aa, aa, innerD);
          float outlineMask = outerMask - innerMask;

          // The halo: quadratic falloff from the ring outward, outside only, selected only. It
          // lands on neighbours (no depth test, order 7) — that is what a halo does.
          float glow = 1.0 - smoothstep(0.0, uGlow, outerD);
          glow = glow * glow * step(0.0, outerD) * uGlowAlpha * vType;

          float a = max(outlineMask, glow);
          if (a < 0.004) discard;

          vec3 color = mix(uHoverColor, uSelectedColor, vType);
          gl_FragColor = vec4(color, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [selectedColor, hoverColor, glowAlpha, resolvedStyle.borderRadius]);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { outlineMaterial.dispose(); }, [outlineMaterial]);

  // Outline buffers
  const outlineBuffers = useMemo(() => ({
    sizes: new Float32Array(outlineCapacity * 2),
    types: new Float32Array(outlineCapacity),
    outlineWidths: new Float32Array(outlineCapacity),
    paddings: new Float32Array(outlineCapacity),
    sizeAttr: null as THREE.InstancedBufferAttribute | null,
    typeAttr: null as THREE.InstancedBufferAttribute | null,
    outlineWidthAttr: null as THREE.InstancedBufferAttribute | null,
    paddingAttr: null as THREE.InstancedBufferAttribute | null,
  }), [outlineCapacity]);

  /**
   * Initialise on ATTACH — the third instance of this bug, and the one a person would notice.
   *
   * `outlineMaterial` is memoised on the theme (selectedColor, hoverColor, borderRadius), and
   * `args={[geometry, material, capacity]}` makes R3F reconstruct the mesh when it changes, while
   * this effect was keyed on [outlineBuffers]. So a theme change left the selection outline's
   * instance attributes unset — measured through a light -> dark -> light round trip, the outline
   * came back as a partial rectangle and never recovered.
   *
   * The round trip is what caught it: comparing ink across a single flip cannot separate "the
   * geometry is gone" from "the colours legitimately changed", and a null control proved the
   * measurement itself was stable.
   */
  const attachOutline = useCallback((mesh: THREE.InstancedMesh | null) => {
    outlineMeshRef.current = mesh;
    if (!mesh) {
      outlineInitializedRef.current = false;
      return;
    }

    outlineBuffers.sizeAttr = new THREE.InstancedBufferAttribute(outlineBuffers.sizes, 2);
    outlineBuffers.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    outlineBuffers.typeAttr = new THREE.InstancedBufferAttribute(outlineBuffers.types, 1);
    outlineBuffers.typeAttr.setUsage(THREE.DynamicDrawUsage);
    outlineBuffers.outlineWidthAttr = new THREE.InstancedBufferAttribute(outlineBuffers.outlineWidths, 1);
    outlineBuffers.outlineWidthAttr.setUsage(THREE.DynamicDrawUsage);
    outlineBuffers.paddingAttr = new THREE.InstancedBufferAttribute(outlineBuffers.paddings, 1);
    outlineBuffers.paddingAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.geometry.setAttribute('aSize', outlineBuffers.sizeAttr);
    mesh.geometry.setAttribute('aType', outlineBuffers.typeAttr);
    mesh.geometry.setAttribute('aOutlineWidth', outlineBuffers.outlineWidthAttr);
    mesh.geometry.setAttribute('aPadding', outlineBuffers.paddingAttr);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    outlineInitializedRef.current = true;
    outlineDirtyRef.current = true;
  }, [outlineBuffers]);

  // ============================================================================
  // Handle material (filled rounded square)
  // ============================================================================

  const handleGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { handleGeometry.dispose(); }, [handleGeometry]);

  // Memoised on the tokens: resolveColor returns a fresh tuple, and as bare render-time calls
  // these defeated the material memo below — a shader compile and a mesh rebuild per render.
  const handleFillColor = useMemo(() => resolveColor(THEME_COLORS.entitySelection.handleFill, tokens), [tokens]);
  const handleBorderColor = useMemo(() => resolveColor(THEME_COLORS.entitySelection.handleBorder, tokens), [tokens]);

  const handleMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uFillColor: { value: new THREE.Color(handleFillColor[0], handleFillColor[1], handleFillColor[2]) },
        uBorderColor: { value: new THREE.Color(handleBorderColor[0], handleBorderColor[1], handleBorderColor[2]) },
        uZoom: { value: 1.0 },
        uHandleSize: { value: RESIZE_HANDLE_SIZE },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform vec3 uFillColor;
        uniform vec3 uBorderColor;
        uniform float uZoom;
        uniform float uHandleSize;

        varying vec2 vUv;

        void main() {
          // The quad is the hit size; the dot sits inside it, a 6px accent disc ringed in the
          // card's own body colour so it reads on the hairline it straddles.
          float halfSize = uHandleSize * 0.5 / uZoom;
          vec2 p = (vUv - 0.5) * vec2(halfSize * 2.0);
          float borderWidth = 1.0 / uZoom;

          float d = length(p) - ${HANDLE_DOT_RADIUS_PX.toFixed(1)} / uZoom;

          float aa = fwidth(d) * 1.5;
          float fillMask = 1.0 - smoothstep(-aa, aa, d);
          float borderD = d + borderWidth;
          float borderMask = smoothstep(-aa, aa, borderD) - smoothstep(-aa, aa, d);

          if (fillMask < 0.01) discard;

          vec3 color = mix(uFillColor, uBorderColor, borderMask);
          gl_FragColor = vec4(color, fillMask);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [handleFillColor, handleBorderColor]);

  /** Free the GPU resources this component owns; see nodes.tsx for why the dep array is the value itself. */
  useEffect(() => () => { handleMaterial.dispose(); }, [handleMaterial]);

  // Handle buffer — no per-instance attributes, just instance matrices
  // (all handles same size/color, determined by uniform)

  /** Same reconstruction hazard as the outline mesh above. */
  const attachHandle = useCallback((mesh: THREE.InstancedMesh | null) => {
    handleMeshRef.current = mesh;
    if (!mesh) {
      handleInitializedRef.current = false;
      return;
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    handleInitializedRef.current = true;
    handleDirtyRef.current = true;
  }, []);

  // ============================================================================
  // Store subscriptions
  // ============================================================================

  useEffect(() => {
    const markBothDirty = () => {
      outlineDirtyRef.current = true;
      handleDirtyRef.current = true;
    };
    const markHandleDirty = () => {
      handleDirtyRef.current = true;
    };

    // These affect both outline and handle meshes
    const unsubEntities = store.subscribe((state) => state.entities, markBothDirty);
    const unsubViewport = store.subscribe((state) => state.viewport, markBothDirty);
    const unsubSelection = store.subscribe((state) => state.selectedEntityIds, markBothDirty);
    const unsubHovered = store.subscribe((state) => state.hoveredEntityId, markBothDirty);
    const unsubHidden = store.subscribe((state) => state.hiddenEntityIds, markBothDirty);
    // These only affect handle visibility (hide during connection/box-select)
    // Presence, not the draft: the handles are hidden while a connection is in flight and shown
    // when it is not, so the boolean is the whole question. Subscribing to the object fires on
    // every pointermove for an answer that changes twice.
    const unsubConnection = store.subscribe((state) => state.connectionDraft !== null, markHandleDirty);
    const unsubSelectionBox = store.subscribe((state) => state.selectionBox, markHandleDirty);

    return () => {
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubHovered();
      unsubHidden();
      unsubConnection();
      unsubSelectionBox();
    };
  }, [store]);

  // ============================================================================
  // useFrame — update both meshes
  // ============================================================================

  useFrame(({ size }) => {
    const outlineMesh = outlineMeshRef.current;
    const handleMesh = handleMeshRef.current;

    // --- Outline mesh ---
    if (outlineMesh && outlineInitializedRef.current && outlineDirtyRef.current) {
      const {
        viewport,
        selectedEntityIds,
        hoveredEntityId,
        hiddenEntityIds,
        entityMap,
      } = store.getState();

      // Viewport culling bounds
      const invZoom = 1 / viewport.zoom;
      const viewLeft = -viewport.x * invZoom;
      const viewRight = (size.width - viewport.x) * invZoom;
      const viewTop = -viewport.y * invZoom;
      const viewBottom = (size.height - viewport.y) * invZoom;
      const cullPadding = 300;

      const selOutlineWidth = SELECTION_OUTLINE_WIDTH / viewport.zoom;
      const hoverOutlineWidth = HOVER_OUTLINE_WIDTH / viewport.zoom;
      const padding = SELECTION_OUTLINE_PADDING / viewport.zoom;

      let outlineCount = 0;
      const maxOutline = outlineCapacity;

      /**
       * Does this entity contribute an outline instance?
       *
       * Split out of the writer so the capacity can be sized from the TRUE need in one step. The
       * old code learned its need from `outlineCount`, which the writer clamps at capacity — so it
       * could only ever discover "I need at least what I have", grow 1.5x, and discover it again
       * next frame. Selecting a thousand entities with a 32-slot buffer took the ramp about nine
       * frames to converge, and the outlines painted in growing batches while it did.
       */
      const contributes = (entity: import('../types').Entity): boolean => {
        if (hiddenEntityIds.has(entity.id)) return false;
        const w = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const h = entity.height ?? getEntitySocketLayout(entity, socketLayout).computedHeight;
        return !(
          entity.position.x + w < viewLeft - cullPadding ||
          entity.position.x > viewRight + cullPadding ||
          entity.position.y + h < viewTop - cullPadding ||
          entity.position.y > viewBottom + cullPadding
        );
      };

      // Helper to write one outline instance — shared by selected + hovered paths
      const writeOutline = (entity: import('../types').Entity, isSelected: boolean) => {
        if (outlineCount >= maxOutline) return;
        if (!contributes(entity)) return;

        const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const entityLayout = getEntitySocketLayout(entity, socketLayout);
        const height = entity.height ?? entityLayout.computedHeight;

        tempMatrix.identity();
        tempMatrix.setPosition(
          entity.position.x + width / 2,
          -(entity.position.y + height / 2),
          0.5
        );
        outlineMesh.setMatrixAt(outlineCount, tempMatrix);

        outlineBuffers.sizes[outlineCount * 2] = width;
        outlineBuffers.sizes[outlineCount * 2 + 1] = height;
        outlineBuffers.types[outlineCount] = isSelected ? 1.0 : 0.0;
        outlineBuffers.outlineWidths[outlineCount] = isSelected ? selOutlineWidth : hoverOutlineWidth;
        outlineBuffers.paddings[outlineCount] = padding;

        outlineCount++;
      };

      // O(selected) — iterate only selected entities via entityMap lookup
      for (const entityId of selectedEntityIds) {
        const entity = entityMap.get(entityId);
        if (entity) writeOutline(entity, true);
      }

      // O(1) — single hovered entity (only if not already selected)
      if (hoveredEntityId && !selectedEntityIds.has(hoveredEntityId)) {
        const hovered = entityMap.get(hoveredEntityId);
        if (hovered) writeOutline(hovered, false);
      }

      // Size to what is actually needed, in ONE step. Counting is a second pass over the same
      // small set (selected entities plus at most one hovered), and it only runs when the buffer
      // is already full — so the common case pays nothing and the growing case converges at once
      // instead of over nine frames.
      if (outlineCount >= outlineCapacity) {
        let needed = 0;
        for (const entityId of selectedEntityIds) {
          const entity = entityMap.get(entityId);
          if (entity && contributes(entity)) needed++;
        }
        if (hoveredEntityId && !selectedEntityIds.has(hoveredEntityId)) {
          const hovered = entityMap.get(hoveredEntityId);
          if (hovered && contributes(hovered)) needed++;
        }
        if (needed > outlineCapacity) {
          setOutlineCapacity(Math.ceil(needed * BUFFER_GROWTH_FACTOR));
        }
      }

      /**
       * Upload the instances that were written, not the whole buffer.
       *
       * `needsUpdate` on its own re-sends the entire typed array, and the array is sized from the
       * selection, not from what survived the cull — so a pan, which marks this layer dirty on
       * every pointermove, re-sent every byte of it sixty times a second to draw the handful of
       * outlines still on screen. The capacity never shrinks either, so the bill stayed at the
       * high-water mark long after the selection came back down. Only the first `count` instances
       * are ever drawn (see the `outlineMesh.count` line below), so the bytes past the range are
       * unread; three still does a full `bufferData` the first time a freshly remounted mesh is
       * uploaded, which is what keeps the untouched tail from being garbage.
       */
      outlineMesh.instanceMatrix.addUpdateRange(0, outlineCount * 16);
      outlineMesh.instanceMatrix.needsUpdate = true;
      if (outlineBuffers.sizeAttr && outlineBuffers.typeAttr && outlineBuffers.outlineWidthAttr && outlineBuffers.paddingAttr) {
        outlineBuffers.sizeAttr.addUpdateRange(0, outlineCount * 2);
        outlineBuffers.sizeAttr.needsUpdate = true;
        outlineBuffers.typeAttr.addUpdateRange(0, outlineCount);
        outlineBuffers.typeAttr.needsUpdate = true;
        outlineBuffers.outlineWidthAttr.addUpdateRange(0, outlineCount);
        outlineBuffers.outlineWidthAttr.needsUpdate = true;
        outlineBuffers.paddingAttr.addUpdateRange(0, outlineCount);
        outlineBuffers.paddingAttr.needsUpdate = true;
      }

      // Update zoom uniforms; the halo is a screen-px reach, so it scales with the inverse.
      outlineMaterial.uniforms.uZoom.value = viewport.zoom;
      outlineMaterial.uniforms.uGlow.value = SELECTION_GLOW_PX / viewport.zoom;

      outlineMesh.count = Math.min(outlineCount, outlineCapacity);
      outlineDirtyRef.current = false;
    }

    // --- Handle mesh ---
    if (handleMesh && handleInitializedRef.current && handleDirtyRef.current) {
      const {
        viewport,
        selectedEntityIds,
        hoveredEntityId,
        hiddenEntityIds,
        connectionDraft,
        selectionBox,
        entityMap,
      } = store.getState();

      // Hide handles during drag/connect/box-select, and unless the pointer is on a selected
      // entity: the corners are drawn for the one card being looked at, not the whole selection.
      const mode = getInteractionMode();
      const showHandles = mode === 'idle' && !connectionDraft && !selectionBox &&
        hoveredEntityId !== null && selectedEntityIds.has(hoveredEntityId);

      if (!showHandles) {
        handleMesh.count = 0;
        handleDirtyRef.current = false;
        return;
      }

      const invZoom = 1 / viewport.zoom;
      const viewLeft = -viewport.x * invZoom;
      const viewRight = (size.width - viewport.x) * invZoom;
      const viewTop = -viewport.y * invZoom;
      const viewBottom = (size.height - viewport.y) * invZoom;
      const cullPadding = 300;

      const halfHandle = RESIZE_HANDLE_SIZE / (2 * viewport.zoom);
      let handleCount = 0;

      // Four corners of one entity: the buffer never needs more than HANDLE_MIN_CAPACITY, and the
      // grow path is kept only so a changed constant cannot silently truncate.
      const neededCapacity = 4;
      if (neededCapacity > handleCapacity) {
        setHandleCapacity(Math.ceil(neededCapacity * BUFFER_GROWTH_FACTOR));
        // Continue rendering what fits this frame; next frame will have full capacity
      }
      const maxHandles = handleCapacity;

      // One entity — the hovered one, already proven selected — looked up directly. Walking the
      // selection set to find it was O(|selection|) on every pan frame with a select-all.
      const entity = entityMap.get(hoveredEntityId);
      if (entity && !hiddenEntityIds.has(entity.id) && entity.resizable !== false && handleCount + 4 <= maxHandles) {

        const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const entityLayout = getEntitySocketLayout(entity, socketLayout);
        const height = entity.height ?? entityLayout.computedHeight;

        const x = entity.position.x;
        const y = entity.position.y;

        // Frustum culling
        const offscreen =
          x + width < viewLeft - cullPadding ||
          x > viewRight + cullPadding ||
          y + height < viewTop - cullPadding ||
          y > viewBottom + cullPadding;

        // Check per-axis resizability
        const resizable = entity.resizable;
        const canResizeW = resizable === undefined || resizable === true ||
          (typeof resizable === 'object' && resizable.width !== false);
        const canResizeH = resizable === undefined || resizable === true ||
          (typeof resizable === 'object' && resizable.height !== false);

        // Write handle instances inline — no intermediate array allocation.
        // Corners only: NW, NE, SE, SW, centred on the selection outline stroke. The mid-edge
        // handles keep their hit test in kookie-flow.tsx; the resize cursor is their affordance.
        const pad = (SELECTION_OUTLINE_PADDING - SELECTION_OUTLINE_WIDTH / 2) * invZoom;
        tempScale.set(halfHandle * 2, halfHandle * 2, 1);

        const writeHandle = (hx: number, hy: number) => {
          if (handleCount >= maxHandles) return;
          tempMatrix.identity();
          tempMatrix.setPosition(hx, -hy, 0.6);
          tempMatrix.scale(tempScale);
          handleMesh.setMatrixAt(handleCount, tempMatrix);
          handleCount++;
        };

        // The corners draw for a single-axis entity too: the corner hit already resolves to
        // whichever axis is allowed, and an entity with no dots at all reads as unresizable.
        if (!offscreen && (canResizeW || canResizeH)) {
          writeHandle(x - pad, y - pad);                    // NW
          writeHandle(x + width + pad, y - pad);            // NE
          writeHandle(x + width + pad, y + height + pad);   // SE
          writeHandle(x - pad, y + height + pad);           // SW
        }
      }

      // `handleMesh.count` clamps the draw to what was written; the range keeps the upload to it.
      handleMesh.instanceMatrix.addUpdateRange(0, handleCount * 16);
      handleMesh.instanceMatrix.needsUpdate = true;

      // Update zoom uniform
      handleMaterial.uniforms.uZoom.value = viewport.zoom;

      handleMesh.count = Math.min(handleCount, handleCapacity);
      handleDirtyRef.current = false;
    }
  });

  return (
    <>
      <instancedMesh
        key={`outline-${outlineCapacity}`}
        ref={attachOutline}
        args={[outlineGeometry, outlineMaterial, outlineCapacity]}
        frustumCulled={false}
        renderOrder={7}
      />
      <instancedMesh
        key={`handle-${handleCapacity}`}
        ref={attachHandle}
        args={[handleGeometry, handleMaterial, handleCapacity]}
        frustumCulled={false}
        renderOrder={8}
      />
    </>
  );
}
