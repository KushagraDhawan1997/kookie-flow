import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useFlowStoreApi } from './context';
import { useNodeStyle } from '../contexts/StyleContext';
import type { NodeTypeDefinition, Edge, EdgeType, EdgeLabelConfig } from '../types';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_MARGIN_TOP,
  SOCKET_SPACING,
} from '../core/constants';
import { getEdgePointAtT, type SocketIndexMap } from '../utils/geometry';

export interface DOMLayerProps {
  nodeTypes?: Record<string, NodeTypeDefinition>;
  /** Scale text with zoom (true = CSS scale, false = crisp text). Default: false */
  scaleTextWithZoom?: boolean;
  /** Default edge type for label positioning. Default: 'bezier' */
  defaultEdgeType?: EdgeType;
  /** Show node header labels. Default: true */
  showNodeLabels?: boolean;
  /** Show socket labels. Default: true */
  showSocketLabels?: boolean;
  /** Show edge labels. Default: true */
  showEdgeLabels?: boolean;
  children?: ReactNode;
}

// LOD thresholds - match node visibility behavior
const MIN_ZOOM_FOR_LABELS = 0.1; // Match minZoom default
const MIN_LABEL_SCREEN_SIZE = 8; // Much smaller threshold so labels stay visible

// Static styles - defined outside component
const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  overflow: 'hidden',
};

/**
 * High-performance DOM overlay layer for text labels.
 * Key optimizations:
 * - translate3d for GPU-accelerated transforms (critical for Safari)
 * - LOD: hides labels when zoomed out
 * - Viewport culling: only updates visible labels
 * - Single RAF-throttled subscription for all labels
 * - Ref-based updates that bypass React rendering
 */
export function DOMLayer({
  nodeTypes = {},
  scaleTextWithZoom = false,
  defaultEdgeType = 'bezier',
  showNodeLabels = true,
  showSocketLabels = true,
  showEdgeLabels = true,
  children,
}: DOMLayerProps) {
  if (scaleTextWithZoom) {
    return (
      <div style={containerStyle}>
        {showNodeLabels && <ScaledContainer nodeTypes={nodeTypes} />}
        {showSocketLabels && <SocketLabelsContainer />}
        {showEdgeLabels && <EdgeLabelsContainer defaultEdgeType={defaultEdgeType} />}
        {children}
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {showNodeLabels && <CrispLabelsContainer nodeTypes={nodeTypes} />}
      {showSocketLabels && <SocketLabelsContainer />}
      {showEdgeLabels && <EdgeLabelsContainer defaultEdgeType={defaultEdgeType} />}
      {children}
    </div>
  );
}

/**
 * Container for crisp (non-scaled) labels.
 * Uses a single store subscription + RAF for all label updates.
 */
function CrispLabelsContainer({ nodeTypes }: { nodeTypes: Record<string, NodeTypeDefinition> }) {
  const store = useFlowStoreApi();
  const { resolved: style, config } = useNodeStyle();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafIdRef = useRef<number>(0);

  // Track nodes for re-rendering when they change
  const [nodes, setNodes] = useState(() => store.getState().nodes);

  // Track container size for resize detection
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // Update function - positions all labels
  const updateLabels = useCallback(() => {
    rafIdRef.current = 0;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, nodeMap } = store.getState();
    const labels = labelsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Calculate viewport bounds for culling
    const containerRect = container.parentElement?.getBoundingClientRect();
    const viewWidth = containerRect?.width ?? window.innerWidth;
    const viewHeight = containerRect?.height ?? window.innerHeight;

    // Track size for resize detection
    lastSizeRef.current = { width: viewWidth, height: viewHeight };

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (clamped for readability)
    const fontSize = Math.max(10, Math.min(16, 12 * viewport.zoom));

    labels.forEach((el, nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) {
        el.style.visibility = 'hidden';
        return;
      }

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
        el.style.visibility = 'hidden';
        return;
      }

      // LOD: Hide if node is too small on screen
      const screenHeight = height * viewport.zoom;
      if (screenHeight < MIN_LABEL_SCREEN_SIZE) {
        el.style.visibility = 'hidden';
        return;
      }

      // Calculate screen position
      // For 'outside' header, position label above the node
      const labelY = config.header === 'outside'
        ? node.position.y - style.headerHeight + 8
        : node.position.y + 8;
      const screenX = (node.position.x + 12) * viewport.zoom + viewport.x;
      const screenY = labelY * viewport.zoom + viewport.y;

      // Update with translate3d for GPU acceleration (critical for Safari)
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      el.style.fontSize = `${fontSize}px`;
    });
  }, [store, config, style]);

  // Schedule update with RAF throttling
  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(() => updateLabels());
    }
  }, [updateLabels]);

  // Setup subscriptions, resize observer, and initial update
  useLayoutEffect(() => {
    // Run initial update synchronously (refs are set after commit)
    updateLabels();

    // Subscribe to store changes - RAF throttling handles frequency
    const unsub = store.subscribe((state) => {
      // Re-render if node count changed (add/remove elements)
      if (state.nodes.length !== nodes.length) {
        setNodes(state.nodes);
      }
      scheduleUpdate();
    });

    // Resize observer for container size changes
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver(() => {
        // Run synchronously on resize for immediate feedback
        updateLabels();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsub();
      resizeObserver?.disconnect();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [store, updateLabels, scheduleUpdate, nodes.length, nodes]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (nodeId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(nodeId, el);
      } else {
        labelsRef.current.delete(nodeId);
      }
    },
    []
  );

  return (
    <div ref={containerRef}>
      {nodes.map((node) => {
        const nodeType = nodeTypes[node.type];
        const label = nodeType?.label ?? node.data.label ?? node.type;

        return (
          <div key={node.id} ref={setLabelRef(node.id)} style={crispLabelStyle}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

const crispLabelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  // Start hidden - updateLabels will show after positioning
  visibility: 'hidden',
  color: 'var(--gray-12, #ffffff)',
  fontWeight: 600,
  fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
  willChange: 'transform',
  // GPU layer hint for Safari
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/**
 * Container that scales with viewport using CSS transform.
 * Uses ref-based updates for positions (no React re-renders during drag).
 */
function ScaledContainer({ nodeTypes }: { nodeTypes: Record<string, NodeTypeDefinition> }) {
  const store = useFlowStoreApi();
  const { resolved: style, config } = useNodeStyle();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafIdRef = useRef<number>(0);

  // Track nodes for element creation/removal only
  const [nodes, setNodes] = useState(() => store.getState().nodes);

  // Update container transform and label positions via refs
  const updateTransform = useCallback(() => {
    rafIdRef.current = 0;
    const el = containerRef.current;
    if (!el) return;

    const { viewport, nodeMap } = store.getState();

    // LOD: Hide if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      el.style.opacity = '0';
      return;
    }

    el.style.opacity = '1';
    // Use matrix3d for GPU acceleration on Safari
    el.style.transform = `matrix3d(${viewport.zoom},0,0,0,0,${viewport.zoom},0,0,0,0,1,0,${viewport.x},${viewport.y},0,1)`;

    // Update label positions via refs (no React re-render)
    // Uses store's nodeMap for O(1) lookup per label
    labelsRef.current.forEach((labelEl, nodeId) => {
      const node = nodeMap.get(nodeId);
      if (node) {
        // For 'outside' header, position label above the node
        const labelY = config.header === 'outside'
          ? node.position.y - style.headerHeight + 8
          : node.position.y + 8;
        labelEl.style.transform = `translate3d(${node.position.x + 12}px, ${labelY}px, 0)`;
      }
    });
  }, [store, config, style]);

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(updateTransform);
    }
  }, [updateTransform]);

  // Setup subscriptions and resize observer
  useLayoutEffect(() => {
    // Run initial update synchronously
    updateTransform();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Only re-render React when node count changes (add/remove elements)
      if (state.nodes.length !== nodes.length) {
        setNodes(state.nodes);
      }
      scheduleUpdate();
    });

    // Resize observer on parent container
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver(() => {
        // Run synchronously on resize for immediate feedback
        updateTransform();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsub();
      resizeObserver?.disconnect();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [store, updateTransform, scheduleUpdate, nodes.length]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (nodeId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(nodeId, el);
      } else {
        labelsRef.current.delete(nodeId);
      }
    },
    []
  );

  return (
    <div ref={containerRef} style={scaledContainerStyle}>
      {nodes.map((node) => {
        const nodeType = nodeTypes[node.type];
        const label = nodeType?.label ?? node.data.label ?? node.type;

        return (
          <div key={node.id} ref={setLabelRef(node.id)} style={scaledLabelStyle}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

const scaledContainerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  // Start with opacity 0 - updateTransform will show after positioning
  opacity: 0,
  transformOrigin: '0 0',
  willChange: 'transform, opacity',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

const scaledLabelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  color: 'var(--gray-12, #ffffff)',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

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
 * Container for edge labels.
 * Uses ref-based updates for performance (no React re-renders during pan/zoom).
 */
function EdgeLabelsContainer({ defaultEdgeType }: { defaultEdgeType: EdgeType }) {
  const store = useFlowStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafIdRef = useRef<number>(0);

  // Track edges with labels for React element creation
  const [edgesWithLabels, setEdgesWithLabels] = useState<Edge[]>(() => {
    return store.getState().edges.filter(e => e.label !== undefined);
  });

  // Build socket index map for O(1) lookups (rebuilt when nodes change)
  const socketIndexMapRef = useRef<SocketIndexMap>(new Map());

  // Update function - positions all edge labels
  const updateLabels = useCallback(() => {
    rafIdRef.current = 0;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, edges, nodeMap } = store.getState();
    const labels = labelsRef.current;
    const socketIndexMap = socketIndexMapRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Calculate viewport bounds for culling
    const containerRect = container.parentElement?.getBoundingClientRect();
    const viewWidth = containerRect?.width ?? window.innerWidth;
    const viewHeight = containerRect?.height ?? window.innerHeight;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (clamped for readability)
    const baseFontSize = Math.max(10, Math.min(14, 12 * viewport.zoom));

    labels.forEach((el, edgeId) => {
      const edge = edges.find(e => e.id === edgeId);
      if (!edge || !edge.label) {
        el.style.visibility = 'hidden';
        return;
      }

      const labelConfig = normalizeEdgeLabel(edge.label);
      const t = labelConfig.position ?? 0.5;

      // Get point along edge
      const pointResult = getEdgePointAtT(edge, nodeMap, t, defaultEdgeType, socketIndexMap);
      if (!pointResult) {
        el.style.visibility = 'hidden';
        return;
      }

      const { position } = pointResult;

      // Frustum culling
      if (
        position.x < viewLeft - cullPadding ||
        position.x > viewRight + cullPadding ||
        position.y < viewTop - cullPadding ||
        position.y > viewBottom + cullPadding
      ) {
        el.style.visibility = 'hidden';
        return;
      }

      // Calculate screen position (centered on the edge point)
      const screenX = position.x * viewport.zoom + viewport.x;
      const screenY = position.y * viewport.zoom + viewport.y;

      // Apply styles
      const fontSize = labelConfig.fontSize ?? baseFontSize;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%)`;
      el.style.fontSize = `${fontSize}px`;

      if (labelConfig.bgColor) {
        el.style.backgroundColor = labelConfig.bgColor;
        el.style.padding = '2px 6px';
        el.style.borderRadius = '4px';
      }

      if (labelConfig.textColor) {
        el.style.color = labelConfig.textColor;
      }
    });
  }, [store, defaultEdgeType]);

  // Schedule update with RAF throttling
  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(() => updateLabels());
    }
  }, [updateLabels]);

  // Setup subscriptions and initial update
  useLayoutEffect(() => {
    // Build initial socket index map
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

    // Run initial update synchronously
    updateLabels();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Update socket index map when nodes change
      const currentNodes = state.nodes;
      socketIndexMapRef.current.clear();
      for (const n of currentNodes) {
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

      // Re-render if edges with labels changed
      const newEdgesWithLabels = state.edges.filter(e => e.label !== undefined);
      if (newEdgesWithLabels.length !== edgesWithLabels.length ||
          newEdgesWithLabels.some((e, i) => e.id !== edgesWithLabels[i]?.id)) {
        setEdgesWithLabels(newEdgesWithLabels);
      }

      scheduleUpdate();
    });

    return () => {
      unsub();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [store, updateLabels, scheduleUpdate, edgesWithLabels]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (edgeId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(edgeId, el);
      } else {
        labelsRef.current.delete(edgeId);
      }
    },
    []
  );

  // Don't render if no edges have labels
  if (edgesWithLabels.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef}>
      {edgesWithLabels.map((edge) => {
        const labelConfig = normalizeEdgeLabel(edge.label!);
        return (
          <div key={edge.id} ref={setLabelRef(edge.id)} style={edgeLabelStyle}>
            {labelConfig.text}
          </div>
        );
      })}
    </div>
  );
}

const edgeLabelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  // Start hidden - updateLabels will show after positioning
  visibility: 'hidden',
  color: 'var(--gray-12, #ffffff)',
  fontWeight: 400,
  fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
  willChange: 'transform',
  // GPU layer hint for Safari
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  // Center the label on the point
  textAlign: 'center',
};

/**
 * Container for socket labels.
 * Uses ref-based updates for performance (no React re-renders during pan/zoom).
 * Always uses screen-space positioning (crisp mode) for readability.
 */
function SocketLabelsContainer() {
  const store = useFlowStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafIdRef = useRef<number>(0);

  // Track nodes for React element creation
  const [nodes, setNodes] = useState(() => store.getState().nodes);

  // Update function - positions all socket labels
  const updateLabels = useCallback(() => {
    rafIdRef.current = 0;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, nodeMap } = store.getState();
    const labels = labelsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Calculate viewport bounds for culling
    const containerRect = container.parentElement?.getBoundingClientRect();
    const viewWidth = containerRect?.width ?? window.innerWidth;
    const viewHeight = containerRect?.height ?? window.innerHeight;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (smaller for socket labels)
    const fontSize = Math.max(8, Math.min(11, 10 * viewport.zoom));

    labels.forEach((el, key) => {
      // Key format: nodeId:socketId:side
      const [nodeId, , side] = key.split(':');
      const node = nodeMap.get(nodeId);
      if (!node) {
        el.style.visibility = 'hidden';
        return;
      }

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
        el.style.visibility = 'hidden';
        return;
      }

      // LOD: Hide if node is too small on screen
      const screenHeight = height * viewport.zoom;
      if (screenHeight < MIN_LABEL_SCREEN_SIZE * 2) {
        el.style.visibility = 'hidden';
        return;
      }

      // Get socket index from data attribute
      const socketIndex = parseInt(el.dataset.socketIndex ?? '0', 10);

      // Calculate socket position in world space
      const socketY = node.position.y + SOCKET_MARGIN_TOP + socketIndex * SOCKET_SPACING;
      const socketX = side === 'input' ? node.position.x : node.position.x + width;

      // Label offset from socket (in world space)
      const labelOffset = side === 'input' ? 12 : -12;

      // Position in screen space for crisp text
      const screenX = (socketX + labelOffset) * viewport.zoom + viewport.x;
      const screenY = socketY * viewport.zoom + viewport.y;

      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      el.style.fontSize = `${fontSize}px`;
    });
  }, [store]);

  // Schedule update with RAF throttling
  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(() => updateLabels());
    }
  }, [updateLabels]);

  // Setup subscriptions and initial update
  useLayoutEffect(() => {
    // Run initial update synchronously
    updateLabels();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Re-render if node count changed
      if (state.nodes.length !== nodes.length) {
        setNodes(state.nodes);
      }
      scheduleUpdate();
    });

    return () => {
      unsub();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [store, updateLabels, scheduleUpdate, nodes.length]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(key, el);
      } else {
        labelsRef.current.delete(key);
      }
    },
    []
  );

  // Collect all sockets from all nodes
  const socketLabels: Array<{
    key: string;
    name: string;
    side: 'input' | 'output';
    index: number;
  }> = [];

  for (const node of nodes) {
    if (node.inputs) {
      for (let i = 0; i < node.inputs.length; i++) {
        const socket = node.inputs[i];
        socketLabels.push({
          key: `${node.id}:${socket.id}:input`,
          name: socket.name,
          side: 'input',
          index: i,
        });
      }
    }
    if (node.outputs) {
      for (let i = 0; i < node.outputs.length; i++) {
        const socket = node.outputs[i];
        socketLabels.push({
          key: `${node.id}:${socket.id}:output`,
          name: socket.name,
          side: 'output',
          index: i,
        });
      }
    }
  }

  if (socketLabels.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef}>
      {socketLabels.map((item) => (
        <div
          key={item.key}
          ref={setLabelRef(item.key)}
          data-socket-index={item.index}
          style={{
            ...socketLabelStyle,
            textAlign: item.side === 'input' ? 'left' : 'right',
            transform: item.side === 'output' ? 'translateX(-100%)' : undefined,
          }}
        >
          {item.name}
        </div>
      ))}
    </div>
  );
}

const socketLabelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  // Start hidden - updateLabels will show after positioning
  visibility: 'hidden',
  color: 'var(--gray-11, #999999)',
  fontSize: 10,
  fontWeight: 400,
  fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  userSelect: 'none',
  willChange: 'transform',
  // GPU layer hint for Safari
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  // Vertically center on socket
  lineHeight: '1',
  marginTop: '-5px',
};
