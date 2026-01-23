/**
 * TextRenderer - High-performance WebGL text rendering using instanced MSDF
 *
 * Renders all text labels (node headers, socket labels, edge labels) using
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

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useNodeStyle, useSocketLayout } from '../contexts/StyleContext';
import { msdfVertexShader, msdfFragmentShader, MSDF_SHADER_DEFAULTS } from '../utils/msdf-shader';
import { rgbToHex } from '../utils/color';
import { THEME_COLORS } from '../core/theme-colors';
import {
  type FontMetrics,
  type TextEntry,
  type TextFontWeight,
  type GlyphMap,
  type KerningMap,
  buildGlyphMap,
  buildKerningMap,
  populateGlyphBuffers,
  countGlyphs,
} from '../utils/text-layout';
import { DEFAULT_NODE_WIDTH } from '../core/constants';
import { calculateMinNodeHeight } from '../utils/style-resolver';
import type { EdgeType, EdgeLabelConfig } from '../types';
import { getEdgePointAtT, type SocketIndexMap } from '../utils/geometry';

// Buffer capacity management
const BUFFER_GROWTH_FACTOR = 1.5;
const MIN_CAPACITY = 512;
const MAX_CAPACITY = 250000; // 250k glyphs max per weight

// LOD thresholds
const MIN_TEXT_ZOOM = 0.15; // Below this, hide ALL text
const MIN_SOCKET_ZOOM = 0.35; // Below this, hide socket labels
const MIN_EDGE_ZOOM = 0.25; // Below this, hide edge labels

/**
 * Font data for a single weight.
 */
export interface FontWeightData {
  metrics: FontMetrics;
  texture: THREE.Texture;
}

/**
 * Props for the single-weight text renderer.
 */
interface TextWeightRendererProps {
  fontMetrics: FontMetrics;
  atlasTexture: THREE.Texture;
  /** Ref to entries array - read directly in useFrame for same-frame updates */
  entriesRef: React.MutableRefObject<TextEntry[]>;
}

/**
 * Renders text for a single font weight using instanced MSDF.
 */
function TextWeightRenderer({
  fontMetrics,
  atlasTexture,
  entriesRef,
}: TextWeightRendererProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [capacity, setCapacity] = useState(MIN_CAPACITY);
  const initializedRef = useRef(false);

  // Pre-built lookup maps
  const glyphMap = useMemo<GlyphMap>(() => buildGlyphMap(fontMetrics), [fontMetrics]);
  const kerningMap = useMemo<KerningMap>(() => buildKerningMap(fontMetrics), [fontMetrics]);

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

  // Initialize attributes when mesh is ready
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
  }, [buffers]);

  // Update on frame - read from ref for same-frame updates (no React batching delay)
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !initializedRef.current) return;

    const entries = entriesRef.current;
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
      buffers.matrices,
      buffers.uvOffsets,
      buffers.colors,
      buffers.opacities,
      capacity
    );

    // Update instance matrices
    mesh.instanceMatrix.array.set(buffers.matrices.subarray(0, glyphCount * 16));
    mesh.instanceMatrix.needsUpdate = true;

    // Update attributes
    if (buffers.uvOffsetAttr && buffers.colorAttr && buffers.opacityAttr) {
      buffers.uvOffsetAttr.needsUpdate = true;
      buffers.colorAttr.needsUpdate = true;
      buffers.opacityAttr.needsUpdate = true;
    }

    mesh.count = glyphCount;
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
 * Props for the multi-weight text renderer.
 */
export interface MultiWeightTextRendererProps {
  /** Font data for regular weight */
  regularFont: FontWeightData;
  /** Font data for semibold weight (optional) */
  semiboldFont?: FontWeightData;
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
 * Multi-weight TextRenderer - renders text with multiple font weights.
 * Each weight gets its own InstancedMesh for optimal performance.
 */
export function MultiWeightTextRenderer({
  regularFont,
  semiboldFont,
  showSocketLabels = true,
  showEdgeLabels = true,
  defaultEdgeType = 'bezier',
}: MultiWeightTextRendererProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const { resolved: style, config } = useNodeStyle();
  const socketLayout = useSocketLayout();

  // Derive text colors from theme tokens
  const primaryTextColor = rgbToHex(tokens[THEME_COLORS.text.primary]);
  const secondaryTextColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);

  // Socket index map for edge label positioning
  const socketIndexMapRef = useRef<SocketIndexMap>(new Map());

  // Entries by weight - use refs for same-frame updates (avoid React batching delay)
  const regularEntriesRef = useRef<TextEntry[]>([]);
  const semiboldEntriesRef = useRef<TextEntry[]>([]);

  // Track whether we have semibold entries (for conditional rendering)
  const [hasSemiboldEntries, setHasSemiboldEntries] = useState(false);

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

  // Collect and split text entries
  const collectTextEntries = useCallback(
    (
      zoom: number,
      viewLeft: number,
      viewRight: number,
      viewTop: number,
      viewBottom: number
    ): { regular: TextEntry[]; semibold: TextEntry[] } => {
      const regular: TextEntry[] = [];
      const semibold: TextEntry[] = [];
      const { nodes, edges, nodeMap } = store.getState();

      if (zoom < MIN_TEXT_ZOOM) return { regular, semibold };

      const cullPadding = 100;

      // Node headers (semibold)
      for (const node of nodes) {
        const width = node.width ?? DEFAULT_NODE_WIDTH;
        const outputCount = node.outputs?.length ?? 0;
        const inputCount = node.inputs?.length ?? 0;
        const height = node.height ?? calculateMinNodeHeight(outputCount, inputCount, socketLayout);

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
        // Position label based on header mode:
        // - 'none' or 'inside': inside node at top
        // - 'outside': floating above node
        const labelY =
          config.header === 'outside'
            ? node.position.y - style.headerHeight + 8
            : node.position.y + 8;
        const entry: TextEntry = {
          id: `node-${node.id}`,
          text: label,
          position: [node.position.x + 12, labelY, 0.1],
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
        for (const node of nodes) {
          const width = node.width ?? DEFAULT_NODE_WIDTH;
          const outputCount = node.outputs?.length ?? 0;
          const inputCount = node.inputs?.length ?? 0;
          const height =
            node.height ?? calculateMinNodeHeight(outputCount, inputCount, socketLayout);

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

          // Output sockets (first in layout order)
          if (node.outputs) {
            for (let i = 0; i < node.outputs.length; i++) {
              const socket = node.outputs[i];
              // Output rowIndex = i
              const socketY =
                node.position.y +
                socketLayout.marginTop +
                i * socketLayout.rowHeight +
                socketLayout.rowHeight / 2;
              const textY = socketY - 5;
              regular.push({
                id: `socket-${node.id}-${socket.id}`,
                text: socket.name,
                position: [node.position.x + width - 12, textY, 0.1],
                fontSize: 10,
                color: secondaryTextColor,
                anchor: 'right',
                fontWeight: 'regular',
              });
            }
          }

          // Input sockets (after outputs in layout order)
          if (node.inputs) {
            for (let i = 0; i < node.inputs.length; i++) {
              const socket = node.inputs[i];
              // Input rowIndex = outputCount + i
              const rowIndex = outputCount + i;
              const socketY =
                node.position.y +
                socketLayout.marginTop +
                rowIndex * socketLayout.rowHeight +
                socketLayout.rowHeight / 2;
              const textY = socketY - 5;
              regular.push({
                id: `socket-${node.id}-${socket.id}`,
                text: socket.name,
                position: [node.position.x + 12, textY, 0.1],
                fontSize: 10,
                color: secondaryTextColor,
                anchor: 'left',
                fontWeight: 'regular',
              });
            }
          }
        }
      }

      // Edge labels (regular)
      if (showEdgeLabels && zoom >= MIN_EDGE_ZOOM) {
        for (const edge of edges) {
          if (!edge.label) continue;

          const labelConfig = normalizeEdgeLabel(edge.label);
          const t = labelConfig.position ?? 0.5;

          const pointResult = getEdgePointAtT(
            edge,
            nodeMap,
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

          regular.push({
            id: `edge-${edge.id}`,
            text: labelConfig.text,
            position: [position.x, position.y, 0.15],
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
      config,
      style,
      socketLayout,
    ]
  );

  // Subscribe to store changes - rebuild socket index map when nodes are added/removed
  // IMPORTANT: Subscribe to nodes.length, NOT nodes array - position changes create new
  // array references which would cause this to fire every frame during drag
  useEffect(() => {
    rebuildSocketIndexMap();

    const unsubNodes = store.subscribe(
      (state) => state.nodes.length,
      () => {
        rebuildSocketIndexMap();
      }
    );

    return () => {
      unsubNodes();
    };
  }, [store, rebuildSocketIndexMap]);

  // Collect entries on frame - update refs directly for same-frame rendering
  // Always collect every frame to ensure positions are fresh during drag
  useFrame(({ size }) => {
    const { viewport, nodes } = store.getState();

    if (viewport.zoom < MIN_TEXT_ZOOM) {
      regularEntriesRef.current = [];
      semiboldEntriesRef.current = [];
      if (hasSemiboldEntries) setHasSemiboldEntries(false);
      return;
    }

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;

    if (nodes.length > 0 && socketIndexMapRef.current.size === 0) {
      rebuildSocketIndexMap();
    }

    const { regular, semibold } = collectTextEntries(
      viewport.zoom,
      viewLeft,
      viewRight,
      viewTop,
      viewBottom
    );

    // Update refs directly - available immediately to child useFrame calls
    regularEntriesRef.current = regular;
    semiboldEntriesRef.current = semibold;

    // Only trigger React re-render if semibold presence changes (for conditional mount)
    const hasSemibold = semibold.length > 0;
    if (hasSemibold !== hasSemiboldEntries) {
      setHasSemiboldEntries(hasSemibold);
    }
  });

  return (
    <>
      <TextWeightRenderer
        fontMetrics={regularFont.metrics}
        atlasTexture={regularFont.texture}
        entriesRef={regularEntriesRef}
      />
      {semiboldFont && hasSemiboldEntries && (
        <TextWeightRenderer
          fontMetrics={semiboldFont.metrics}
          atlasTexture={semiboldFont.texture}
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
  return (
    <MultiWeightTextRenderer
      regularFont={{ metrics: fontMetrics, texture: atlasTexture }}
      {...props}
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
  const [atlasTexture, setAtlasTexture] = useState<THREE.Texture | null>(null);

  // Load font metrics
  useEffect(() => {
    fetch(fontMetricsUrl)
      .then((res) => res.json())
      .then((data) => setFontMetrics(data))
      .catch((err) => console.error('Failed to load font metrics:', err));
  }, [fontMetricsUrl]);

  // Load atlas texture
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      atlasUrl,
      (texture) => {
        texture.flipY = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        setAtlasTexture(texture);
      },
      undefined,
      (err) => console.error('Failed to load font atlas:', err)
    );
  }, [atlasUrl]);

  if (!fontMetrics || !atlasTexture) return null;

  return <TextRenderer fontMetrics={fontMetrics} atlasTexture={atlasTexture} {...props} />;
}
