import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useFlowStoreApi } from './context';
import type { Node, NodeTypeDefinition } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';

export interface DOMLayerProps {
  nodeTypes?: Record<string, NodeTypeDefinition>;
  /** Scale text with zoom (true = CSS scale, false = crisp text). Default: false */
  scaleTextWithZoom?: boolean;
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
export function DOMLayer({ nodeTypes = {}, scaleTextWithZoom = false, children }: DOMLayerProps) {
  if (scaleTextWithZoom) {
    return (
      <div style={containerStyle}>
        <ScaledContainer nodeTypes={nodeTypes} />
        {children}
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <CrispLabelsContainer nodeTypes={nodeTypes} />
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

    const { viewport, nodes: currentNodes } = store.getState();
    const labels = labelsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Build node map for O(1) lookup
    const nodeMap = new Map<string, Node>();
    currentNodes.forEach((n) => nodeMap.set(n.id, n));

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
      const screenX = (node.position.x + 12) * viewport.zoom + viewport.x;
      const screenY = (node.position.y + 8) * viewport.zoom + viewport.y;

      // Update with translate3d for GPU acceleration (critical for Safari)
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
  color: '#ffffff',
  fontWeight: 500,
  fontFamily: 'system-ui, -apple-system, sans-serif',
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

    const { viewport, nodes: currentNodes } = store.getState();

    // LOD: Hide if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      el.style.opacity = '0';
      return;
    }

    el.style.opacity = '1';
    // Use matrix3d for GPU acceleration on Safari
    el.style.transform = `matrix3d(${viewport.zoom},0,0,0,0,${viewport.zoom},0,0,0,0,1,0,${viewport.x},${viewport.y},0,1)`;

    // Update label positions via refs (no React re-render)
    const nodeMap = new Map<string, Node>();
    currentNodes.forEach((n) => nodeMap.set(n.id, n));

    labelsRef.current.forEach((labelEl, nodeId) => {
      const node = nodeMap.get(nodeId);
      if (node) {
        labelEl.style.transform = `translate3d(${node.position.x + 12}px, ${node.position.y + 8}px, 0)`;
      }
    });
  }, [store]);

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
  color: '#ffffff',
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};
