import { memo, useRef, useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
const MIN_ZOOM_FOR_LABELS = 0.1;  // Match minZoom default
const MIN_LABEL_SCREEN_SIZE = 8;  // Much smaller threshold so labels stay visible

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

  // Track last viewport to skip unnecessary updates
  const lastViewportRef = useRef({ x: 0, y: 0, zoom: 0 });

  // Update function - runs in RAF
  const updateLabels = useCallback(() => {
    rafIdRef.current = 0;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, nodes: currentNodes } = store.getState();
    const labels = labelsRef.current;

    // Skip if viewport hasn't changed (major perf win)
    const vp = lastViewportRef.current;
    if (vp.x === viewport.x && vp.y === viewport.y && vp.zoom === viewport.zoom && vp.zoom !== 0) {
      return;
    }
    lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };

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
      rafIdRef.current = requestAnimationFrame(updateLabels);
    }
  }, [updateLabels]);

  // Subscribe to store changes
  useEffect(() => {
    // Subscribe to nodes changes - triggers React re-render to add/remove label elements
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (newNodes) => {
        // Only re-render if node count changed (add/remove)
        if (newNodes.length !== nodes.length) {
          setNodes(newNodes);
        }
        scheduleUpdate();
      }
    );

    // Subscribe to viewport changes
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      scheduleUpdate
    );

    return () => {
      unsubNodes();
      unsubViewport();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [store, scheduleUpdate, nodes.length]);

  // Initial update - use useLayoutEffect + double RAF to ensure refs are mounted
  useLayoutEffect(() => {
    // First RAF: React has committed, refs are being set
    // Second RAF: refs are definitely set
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateLabels);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateLabels, nodes]); // Re-run when nodes change

  // Ref callback for label elements - triggers update when ref is set
  const setLabelRef = useCallback((nodeId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      labelsRef.current.set(nodeId, el);
      // Trigger update when a new ref is added (fixes initial sync)
      scheduleUpdate();
    } else {
      labelsRef.current.delete(nodeId);
    }
  }, [scheduleUpdate]);

  return (
    <div ref={containerRef}>
      {nodes.map((node) => {
        const nodeType = nodeTypes[node.type];
        const label = nodeType?.label ?? node.data.label ?? node.type;

        return (
          <div
            key={node.id}
            ref={setLabelRef(node.id)}
            style={crispLabelStyle}
          >
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
 * Uses translate3d matrix for GPU acceleration.
 */
function ScaledContainer({ nodeTypes }: { nodeTypes: Record<string, NodeTypeDefinition> }) {
  const store = useFlowStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number>(0);

  // Track nodes for re-rendering
  const [nodes, setNodes] = useState(() => store.getState().nodes);

  const updateTransform = useCallback(() => {
    rafIdRef.current = 0;
    const el = containerRef.current;
    if (!el) return;

    const { viewport } = store.getState();

    // LOD: Hide if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      el.style.visibility = 'hidden';
      return;
    }

    el.style.visibility = 'visible';
    // Use matrix3d for GPU acceleration on Safari
    el.style.transform = `matrix3d(${viewport.zoom},0,0,0,0,${viewport.zoom},0,0,0,0,1,0,${viewport.x},${viewport.y},0,1)`;
  }, [store]);

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(updateTransform);
    }
  }, [updateTransform]);

  useEffect(() => {
    const unsubNodes = store.subscribe(
      (state) => state.nodes,
      (newNodes) => {
        if (newNodes.length !== nodes.length) {
          setNodes(newNodes);
        }
      }
    );
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      scheduleUpdate
    );

    return () => {
      unsubNodes();
      unsubViewport();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [store, scheduleUpdate, nodes.length]);

  // Initial update with double RAF
  useLayoutEffect(() => {
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateTransform);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateTransform]);

  return (
    <div ref={containerRef} style={scaledContainerStyle}>
      {nodes.map((node) => {
        const nodeType = nodeTypes[node.type];
        const label = nodeType?.label ?? node.data.label ?? node.type;

        return (
          <NodeLabelScaled
            key={node.id}
            x={node.position.x}
            y={node.position.y}
            label={label}
          />
        );
      })}
    </div>
  );
}

const scaledContainerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  transformOrigin: '0 0',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

interface NodeLabelScaledProps {
  x: number;
  y: number;
  label: string;
}

/**
 * Individual label for scaled mode.
 * Uses translate3d for position.
 */
const NodeLabelScaled = memo(function NodeLabelScaled({ x, y, label }: NodeLabelScaledProps) {
  const style: CSSProperties = {
    position: 'absolute',
    // Use translate3d instead of left/top for GPU acceleration
    transform: `translate3d(${x + 12}px, ${y + 8}px, 0)`,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
    userSelect: 'none',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };

  return <div style={style}>{label}</div>;
});
