import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
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
const HANDLE_MIN_CAPACITY = 64; // 8 handles * 8 entities
const BUFFER_GROWTH_FACTOR = 1.5;

/**
 * Universal selection outline + resize handle renderer.
 *
 * Renders:
 * 1. Selection outlines: accent-colored outlines on selected entities,
 *    gray outlines on hovered entities. Constant screen-space thickness.
 * 2. Resize handles: small squares at corners/edges of selected entities.
 *    Hidden during drag/connect/box-select operations.
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

  // Resolve theme colors
  const selectedColor = tokens[THEME_COLORS.entitySelection.selected];
  const hoverColor = tokens[THEME_COLORS.entitySelection.hover];

  const outlineMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uSelectedColor: { value: new THREE.Color(selectedColor[0], selectedColor[1], selectedColor[2]) },
        uHoverColor: { value: new THREE.Color(hoverColor[0], hoverColor[1], hoverColor[2]) },
        uCornerRadius: { value: resolvedStyle.borderRadius },
        uZoom: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSize;
        attribute float aType; // 0 = hover, 1 = selected
        attribute float aOutlineWidth; // screen-space width (pre-divided by zoom)
        attribute float aPadding; // screen-space padding (pre-divided by zoom)

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

          // Expand geometry to include outline + padding
          float expand = aPadding + aOutlineWidth;
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

        varying vec2 vUv;
        varying vec2 vSize;
        varying float vType;
        varying float vOutlineWidth;
        varying float vPadding;
        varying vec2 vExpandedSize;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

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

          if (outlineMask < 0.01) discard;

          vec3 color = mix(uHoverColor, uSelectedColor, vType);
          gl_FragColor = vec4(color, outlineMask);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [selectedColor, hoverColor, resolvedStyle.borderRadius]);

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

  // Reset initialized flag on buffer change
  useEffect(() => { outlineInitializedRef.current = false; }, [outlineBuffers]);

  // Initialize outline attributes
  useEffect(() => {
    if (!outlineMeshRef.current) return;
    const mesh = outlineMeshRef.current;

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

  const handleFillColor = tokens[THEME_COLORS.entitySelection.handleFill];
  const handleBorderColor = tokens[THEME_COLORS.entitySelection.handleBorder];

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

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
        }

        void main() {
          float halfSize = uHandleSize * 0.5 / uZoom;
          vec2 p = (vUv - 0.5) * vec2(halfSize * 2.0);
          float radius = 1.5 / uZoom;
          float borderWidth = 1.0 / uZoom;

          float d = roundedBoxSDF(p, vec2(halfSize), radius);

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

  // Handle buffer — no per-instance attributes, just instance matrices
  // (all handles same size/color, determined by uniform)

  // Reset initialized flag on capacity change
  useEffect(() => { handleInitializedRef.current = false; }, [handleCapacity]);

  // Initialize handle mesh
  useEffect(() => {
    if (!handleMeshRef.current) return;
    const mesh = handleMeshRef.current;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    handleInitializedRef.current = true;
    handleDirtyRef.current = true;
  }, [handleCapacity]);

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
    const unsubConnection = store.subscribe((state) => state.connectionDraft, markHandleDirty);
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

      // Helper to write one outline instance — shared by selected + hovered paths
      const writeOutline = (entity: import('../types').Entity, isSelected: boolean) => {
        if (outlineCount >= maxOutline) return;
        if (hiddenEntityIds.has(entity.id)) return;

        const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const entityLayout = getEntitySocketLayout(entity, socketLayout);
        const height = entity.height ?? entityLayout.computedHeight;

        // Frustum culling
        const entityRight = entity.position.x + width;
        const entityBottom = entity.position.y + height;
        if (
          entityRight < viewLeft - cullPadding ||
          entity.position.x > viewRight + cullPadding ||
          entityBottom < viewTop - cullPadding ||
          entity.position.y > viewBottom + cullPadding
        ) return;

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

      // Grow capacity if needed
      if (outlineCount >= outlineCapacity) {
        setOutlineCapacity(Math.ceil(outlineCount * BUFFER_GROWTH_FACTOR));
      }

      outlineMesh.instanceMatrix.needsUpdate = true;
      if (outlineBuffers.sizeAttr && outlineBuffers.typeAttr && outlineBuffers.outlineWidthAttr && outlineBuffers.paddingAttr) {
        outlineBuffers.sizeAttr.needsUpdate = true;
        outlineBuffers.typeAttr.needsUpdate = true;
        outlineBuffers.outlineWidthAttr.needsUpdate = true;
        outlineBuffers.paddingAttr.needsUpdate = true;
      }

      // Update zoom uniform
      outlineMaterial.uniforms.uZoom.value = viewport.zoom;

      outlineMesh.count = Math.min(outlineCount, outlineCapacity);
      outlineDirtyRef.current = false;
    }

    // --- Handle mesh ---
    if (handleMesh && handleInitializedRef.current && handleDirtyRef.current) {
      const {
        entities,
        viewport,
        selectedEntityIds,
        hiddenEntityIds,
        connectionDraft,
        selectionBox,
        entityMap,
      } = store.getState();

      // Hide handles during drag/connect/box-select
      const mode = getInteractionMode();
      const showHandles = mode === 'idle' && !connectionDraft && !selectionBox && selectedEntityIds.size > 0;

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
      const maxHandles = handleCapacity;

      for (const entityId of selectedEntityIds) {
        if (handleCount + 8 > maxHandles) break;

        const entity = entityMap.get(entityId);
        if (!entity || hiddenEntityIds.has(entity.id)) continue;

        // Check if entity is resizable
        if (entity.resizable === false) continue;

        const width = entity.width ?? DEFAULT_ENTITY_WIDTH;
        const entityLayout = getEntitySocketLayout(entity, socketLayout);
        const height = entity.height ?? entityLayout.computedHeight;

        const x = entity.position.x;
        const y = entity.position.y;

        // Frustum culling
        if (
          x + width < viewLeft - cullPadding ||
          x > viewRight + cullPadding ||
          y + height < viewTop - cullPadding ||
          y > viewBottom + cullPadding
        ) continue;

        // Check per-axis resizability
        const resizable = entity.resizable;
        const canResizeW = resizable === undefined || resizable === true ||
          (typeof resizable === 'object' && resizable.width !== false);
        const canResizeH = resizable === undefined || resizable === true ||
          (typeof resizable === 'object' && resizable.height !== false);

        // Write handle instances inline — no intermediate array allocation.
        // 8 handle positions: NW, N, NE, E, SE, S, SW, W
        const halfW = width / 2;
        const halfH = height / 2;
        tempScale.set(halfHandle * 2, halfHandle * 2, 1);

        const writeHandle = (hx: number, hy: number) => {
          if (handleCount >= maxHandles) return;
          tempMatrix.identity();
          tempMatrix.setPosition(hx, -hy, 0.6);
          tempMatrix.scale(tempScale);
          handleMesh.setMatrixAt(handleCount, tempMatrix);
          handleCount++;
        };

        if (canResizeW && canResizeH) {
          writeHandle(x, y);                    // NW
          writeHandle(x + width, y);            // NE
          writeHandle(x + width, y + height);   // SE
          writeHandle(x, y + height);           // SW
        }
        if (canResizeH) {
          writeHandle(x + halfW, y);            // N
          writeHandle(x + halfW, y + height);   // S
        }
        if (canResizeW) {
          writeHandle(x + width, y + halfH);    // E
          writeHandle(x, y + halfH);            // W
        }
      }

      // Grow capacity if needed
      if (handleCount >= handleCapacity) {
        setHandleCapacity(Math.ceil(handleCount * BUFFER_GROWTH_FACTOR));
      }

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
        ref={outlineMeshRef}
        args={[outlineGeometry, outlineMaterial, outlineCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`handle-${handleCapacity}`}
        ref={handleMeshRef}
        args={[handleGeometry, handleMaterial, handleCapacity]}
        frustumCulled={false}
      />
    </>
  );
}
