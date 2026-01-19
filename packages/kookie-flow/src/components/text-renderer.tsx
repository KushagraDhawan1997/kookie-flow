/**
 * TextRenderer - High-performance WebGL text rendering using instanced MSDF
 *
 * Renders all text labels (node headers, socket labels, edge labels) in a single
 * draw call using Multi-channel Signed Distance Field (MSDF) technique.
 *
 * Key optimizations:
 * - Single InstancedMesh for all glyphs = 1 draw call
 * - Pre-allocated buffers with dirty flags = zero GC pressure
 * - RAF-synchronized updates via useFrame
 * - LOD: hide text below zoom thresholds
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { msdfVertexShader, msdfFragmentShader, MSDF_SHADER_DEFAULTS } from '../utils/msdf-shader';
import {
  type FontMetrics,
  type TextEntry,
  type GlyphMap,
  type KerningMap,
  buildGlyphMap,
  buildKerningMap,
  populateGlyphBuffers,
  countGlyphs,
} from '../utils/text-layout';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_MARGIN_TOP,
  SOCKET_SPACING,
} from '../core/constants';
import type { EdgeType, EdgeLabelConfig } from '../types';
import { getEdgePointAtT, type SocketIndexMap } from '../utils/geometry';

// Buffer capacity management
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 1024;
const MAX_CAPACITY = 500000; // 500k glyphs max

// LOD thresholds
const MIN_TEXT_ZOOM = 0.15; // Below this, hide ALL text
const MIN_SOCKET_ZOOM = 0.35; // Below this, hide socket labels
const MIN_EDGE_ZOOM = 0.25; // Below this, hide edge labels

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
 * Helper to normalize edge label to full config.
 */
function normalizeEdgeLabel(label: string | EdgeLabelConfig): EdgeLabelConfig {
  if (typeof label === 'string') {
    return { text: label };
  }
  return label;
}

/**
 * TextRenderer component - renders all text as instanced MSDF glyphs.
 */
export function TextRenderer({
  fontMetrics,
  atlasTexture,
  showSocketLabels = true,
  showEdgeLabels = true,
  defaultEdgeType = 'bezier',
}: TextRendererProps) {
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Capacity state - triggers buffer recreation
  const [capacity, setCapacity] = useState(MIN_CAPACITY);

  // Dirty flag for updates
  const dirtyRef = useRef(true);
  const initializedRef = useRef(false);

  // Pre-built lookup maps (rebuilt when metrics change)
  const glyphMap = useMemo<GlyphMap>(() => buildGlyphMap(fontMetrics), [fontMetrics]);
  const kerningMap = useMemo<KerningMap>(() => buildKerningMap(fontMetrics), [fontMetrics]);

  // Socket index map for edge label positioning (rebuilt when nodes change)
  const socketIndexMapRef = useRef<SocketIndexMap>(new Map());

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
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }, [atlasTexture]);

  // Pre-allocated buffers (recreated when capacity changes)
  const buffers = useMemo(
    () => ({
      matrices: new Float32Array(capacity * 16),
      uvOffsets: new Float32Array(capacity * 4),
      colors: new Float32Array(capacity * 3),
      opacities: new Float32Array(capacity),
      // Attribute references
      uvOffsetAttr: null as THREE.InstancedBufferAttribute | null,
      colorAttr: null as THREE.InstancedBufferAttribute | null,
      opacityAttr: null as THREE.InstancedBufferAttribute | null,
    }),
    [capacity]
  );

  // Initialize attributes when mesh is ready or capacity changes
  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    // Create attributes with DynamicDrawUsage
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
  }, [buffers]);

  // Build socket index map
  const rebuildSocketIndexMap = useCallback(() => {
    const { nodes } = store.getState();
    socketIndexMapRef.current.clear();
    for (const n of nodes) {
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

  // Subscribe to store changes - SELECTIVE to avoid rebuilds on hover/selection
  useEffect(() => {
    // Build initial socket index map
    rebuildSocketIndexMap();

    // Only subscribe to state that affects text content/positions
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      () => {
        dirtyRef.current = true;
        rebuildSocketIndexMap();
      }
    );
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      () => { dirtyRef.current = true; }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );

    return () => {
      unsubNodes();
      unsubEdges();
      unsubViewport();
    };
  }, [store, rebuildSocketIndexMap]);

  // Collect text entries from store state
  const collectTextEntries = useCallback(
    (
      zoom: number,
      viewLeft: number,
      viewRight: number,
      viewTop: number,
      viewBottom: number
    ): TextEntry[] => {
      const entries: TextEntry[] = [];
      const { nodes, edges, nodeMap } = store.getState();

      // LOD: Skip all text if zoomed out too far
      if (zoom < MIN_TEXT_ZOOM) return entries;

      const cullPadding = 100;

      // Node headers
      for (const node of nodes) {
        const width = node.width ?? DEFAULT_NODE_WIDTH;
        const height = node.height ?? DEFAULT_NODE_HEIGHT;

        // Frustum culling
        const nodeRight = node.position.x + width;
        const nodeBottom = node.position.y + height;
        if (
          nodeRight < viewLeft - cullPadding ||
          node.position.x > viewRight + cullPadding ||
          nodeBottom < viewTop - cullPadding ||
          node.position.y > viewBottom + cullPadding
        ) {
          continue;
        }

        const label = node.data.label ?? node.type;
        entries.push({
          id: `node-${node.id}`,
          text: label,
          position: [node.position.x + 12, node.position.y + 8, 0.1],
          fontSize: 12,
          color: '#ffffff',
          anchor: 'left',
        });
      }

      // Socket labels (with LOD)
      if (showSocketLabels && zoom >= MIN_SOCKET_ZOOM) {
        for (const node of nodes) {
          const width = node.width ?? DEFAULT_NODE_WIDTH;
          const height = node.height ?? DEFAULT_NODE_HEIGHT;

          // Frustum culling
          const nodeRight = node.position.x + width;
          const nodeBottom = node.position.y + height;
          if (
            nodeRight < viewLeft - cullPadding ||
            node.position.x > viewRight + cullPadding ||
            nodeBottom < viewTop - cullPadding ||
            node.position.y > viewBottom + cullPadding
          ) {
            continue;
          }

          // Input sockets
          if (node.inputs) {
            for (let i = 0; i < node.inputs.length; i++) {
              const socket = node.inputs[i];
              const socketY = node.position.y + SOCKET_MARGIN_TOP + i * SOCKET_SPACING;
              // Offset text Y to center vertically with socket circle
              // Text baseline + glyph metrics push text lower, so we compensate upward
              const textY = socketY - 5;
              entries.push({
                id: `socket-${node.id}-${socket.id}`,
                text: socket.name,
                position: [node.position.x + 12, textY, 0.1],
                fontSize: 10,
                color: '#999999',
                anchor: 'left',
              });
            }
          }

          // Output sockets
          if (node.outputs) {
            for (let i = 0; i < node.outputs.length; i++) {
              const socket = node.outputs[i];
              const socketY = node.position.y + SOCKET_MARGIN_TOP + i * SOCKET_SPACING;
              // Offset text Y to center vertically with socket circle
              const textY = socketY - 5;
              entries.push({
                id: `socket-${node.id}-${socket.id}`,
                text: socket.name,
                position: [node.position.x + width - 12, textY, 0.1],
                fontSize: 10,
                color: '#999999',
                anchor: 'right',
              });
            }
          }
        }
      }

      // Edge labels (with LOD)
      if (showEdgeLabels && zoom >= MIN_EDGE_ZOOM) {
        for (const edge of edges) {
          if (!edge.label) continue;

          const labelConfig = normalizeEdgeLabel(edge.label);
          const t = labelConfig.position ?? 0.5;

          // Get point along edge
          const pointResult = getEdgePointAtT(
            edge,
            nodeMap,
            t,
            defaultEdgeType,
            socketIndexMapRef.current
          );
          if (!pointResult) continue;

          const { position } = pointResult;

          // Frustum culling
          if (
            position.x < viewLeft - cullPadding ||
            position.x > viewRight + cullPadding ||
            position.y < viewTop - cullPadding ||
            position.y > viewBottom + cullPadding
          ) {
            continue;
          }

          entries.push({
            id: `edge-${edge.id}`,
            text: labelConfig.text,
            position: [position.x, position.y, 0.15],
            fontSize: labelConfig.fontSize ?? 11,
            color: labelConfig.textColor ?? '#ffffff',
            anchor: 'center',
          });
        }
      }

      return entries;
    },
    [store, showSocketLabels, showEdgeLabels, defaultEdgeType]
  );

  // RAF-synchronized update loop
  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current || !dirtyRef.current) return;

    const { viewport, nodes } = store.getState();

    // LOD: Hide all text if zoomed out too far
    if (viewport.zoom < MIN_TEXT_ZOOM) {
      mesh.count = 0;
      dirtyRef.current = false;
      return;
    }

    // Viewport bounds in world space for culling
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;

    // Rebuild socket index map if nodes changed
    // (simple check - could be more sophisticated)
    if (nodes.length > 0 && socketIndexMapRef.current.size === 0) {
      rebuildSocketIndexMap();
    }

    // Collect text entries
    const entries = collectTextEntries(
      viewport.zoom,
      viewLeft,
      viewRight,
      viewTop,
      viewBottom
    );

    if (entries.length === 0) {
      mesh.count = 0;
      dirtyRef.current = false;
      return;
    }

    // Estimate glyph count and check capacity
    const estimatedGlyphs = countGlyphs(entries, glyphMap);
    if (estimatedGlyphs > capacity && capacity < MAX_CAPACITY) {
      setCapacity(Math.min(MAX_CAPACITY, Math.ceil(estimatedGlyphs * BUFFER_GROWTH_FACTOR)));
      return; // Will re-render with new capacity
    }

    // Populate buffers
    const glyphCount = populateGlyphBuffers(
      entries,
      fontMetrics,
      glyphMap,
      kerningMap,
      buffers.matrices,
      buffers.uvOffsets,
      buffers.colors,
      buffers.opacities,
      capacity
    );

    // Update instance matrices directly
    mesh.instanceMatrix.array.set(buffers.matrices.subarray(0, glyphCount * 16));
    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
      buffers.uvOffsetAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.opacityAttr.needsUpdate = true;
    }

    mesh.count = glyphCount;
    dirtyRef.current = false;
  });

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}

/**
 * Wrapper component that loads font atlas and metrics.
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
  const [fontMetrics, setFontMetrics] = useState<FontMetrics | null>(null);
  const atlasTexture = useLoader(THREE.TextureLoader, atlasUrl);

  // Load font metrics
  useEffect(() => {
    fetch(fontMetricsUrl)
      .then((res) => res.json())
      .then((data) => setFontMetrics(data))
      .catch((err) => console.error('Failed to load font metrics:', err));
  }, [fontMetricsUrl]);

  // Configure atlas texture
  useEffect(() => {
    if (atlasTexture) {
      // CRITICAL: Disable flipY - BMFont atlas coordinates assume no Y-flip
      atlasTexture.flipY = false;
      atlasTexture.minFilter = THREE.LinearFilter;
      atlasTexture.magFilter = THREE.LinearFilter;
      atlasTexture.generateMipmaps = false;
    }
  }, [atlasTexture]);

  if (!fontMetrics) return null;

  return <TextRenderer fontMetrics={fontMetrics} atlasTexture={atlasTexture} {...props} />;
}
