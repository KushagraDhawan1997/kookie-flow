import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useFlowStoreApi } from './context';
import { useEntityStyle, useSocketLayout } from '../contexts/StyleContext';
import type { EntityTypeDefinition, Entity, Edge, EdgeType, EdgeLabelConfig, CommentEntityData, EntityChange } from '../types';
import { TextEditOverlay } from './text-edit-overlay';
import { DEFAULT_ENTITY_WIDTH, SOCKET_OFFSET } from '../core/constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { getEdgePointAtT, type SocketIndexMap } from '../utils/geometry';

export interface DOMLayerProps {
  entityTypes?: Record<string, EntityTypeDefinition>;
  /** Scale text with zoom (true = CSS scale, false = crisp text). Default: false */
  scaleTextWithZoom?: boolean;
  /** Default edge type for label positioning. Default: 'bezier' */
  defaultEdgeType?: EdgeType;
  /** Show entity header labels. Default: true */
  showEntityLabels?: boolean;
  /** Show socket labels. Default: true */
  showSocketLabels?: boolean;
  /** Show edge labels. Default: true */
  showEdgeLabels?: boolean;
  /** Show comment entities. Default: true */
  showComments?: boolean;
  /** Callback when entities change (for text editing) */
  onEntitiesChange?: (changes: EntityChange[]) => void;
  children?: ReactNode;
}

// LOD thresholds - match entity visibility behavior
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
 * - Microtask batching for same-frame updates (no 1-frame lag during drag)
 * - Ref-based updates that bypass React rendering
 */
export function DOMLayer({
  entityTypes = {},
  scaleTextWithZoom = false,
  defaultEdgeType = 'bezier',
  showEntityLabels = true,
  showSocketLabels = true,
  showEdgeLabels = true,
  showComments = true,
  onEntitiesChange,
  children,
}: DOMLayerProps) {
  if (scaleTextWithZoom) {
    return (
      <div style={containerStyle}>
        {showEntityLabels && <ScaledContainer entityTypes={entityTypes} />}
        {showSocketLabels && <SocketLabelsContainer />}
        {showEdgeLabels && <EdgeLabelsContainer defaultEdgeType={defaultEdgeType} />}
        {showComments && <CommentsContainer />}
        <TextEditOverlay onEntitiesChange={onEntitiesChange} />
        {children}
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {showEntityLabels && <CrispLabelsContainer entityTypes={entityTypes} />}
      {showSocketLabels && <SocketLabelsContainer />}
      {showEdgeLabels && <EdgeLabelsContainer defaultEdgeType={defaultEdgeType} />}
      {showComments && <CommentsContainer />}
      <TextEditOverlay onEntitiesChange={onEntitiesChange} />
      {children}
    </div>
  );
}

/**
 * Container for crisp (non-scaled) labels.
 * Uses microtask batching for same-frame updates (no 1-frame lag during drag).
 */
function CrispLabelsContainer({ entityTypes }: { entityTypes: Record<string, EntityTypeDefinition> }) {
  const store = useFlowStoreApi();
  const { resolved: style, config } = useEntityStyle();
  const socketLayout = useSocketLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Track entities for re-rendering when they change
  const [entities, setEntities] = useState(() => store.getState().entities);

  // Cached container size - updated via ResizeObserver (avoids layout thrashing)
  // Initialize to 0 (SSR-safe) - ResizeObserver sets correct values on mount
  const cachedSizeRef = useRef({ width: 0, height: 0 });

  // Update function - positions all labels
  const updateLabels = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, entityMap } = store.getState();
    const labels = labelsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Use cached size (updated via ResizeObserver) - avoids layout thrashing
    const viewWidth = cachedSizeRef.current.width;
    const viewHeight = cachedSizeRef.current.height;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (clamped for readability)
    const fontSize = Math.max(10, Math.min(16, 12 * viewport.zoom));

    labels.forEach((el, entityId) => {
      const entity = entityMap.get(entityId);
      if (!entity) {
        el.style.visibility = 'hidden';
        return;
      }

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
      ) {
        el.style.visibility = 'hidden';
        return;
      }

      // LOD: Hide if entity is too small on screen
      const screenHeight = height * viewport.zoom;
      if (screenHeight < MIN_LABEL_SCREEN_SIZE) {
        el.style.visibility = 'hidden';
        return;
      }

      // Calculate screen position
      // Vertically center text within header (fontSize=12, approximate line-height ~14)
      const verticalOffset = (style.headerHeight - 14) / 2;
      // For 'outside' header, position label above the entity
      const labelY = config.header === 'outside'
        ? entity.position.y - style.headerHeight + verticalOffset
        : entity.position.y + verticalOffset;
      const screenX = (entity.position.x + 12) * viewport.zoom + viewport.x;
      const screenY = labelY * viewport.zoom + viewport.y;

      // Update with translate3d for GPU acceleration (critical for Safari)
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      el.style.fontSize = `${fontSize}px`;
    });
  }, [store, config, style, socketLayout]);

  // Schedule update using microtask for same-frame batching (no 1-frame lag)
  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updateLabels);
    }
  }, [updateLabels]);

  // Setup subscriptions, resize observer, and initial update
  useLayoutEffect(() => {
    // Run initial update synchronously (refs are set after commit)
    updateLabels();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Re-render if entity count changed (add/remove elements)
      if (state.entities.length !== entities.length) {
        setEntities(state.entities);
      }
      scheduleUpdate();
    });

    // Resize observer for container size changes - also caches size to avoid getBoundingClientRect
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          // Cache size from ResizeObserver (avoids layout thrashing)
          cachedSizeRef.current.width = entry.contentRect.width;
          cachedSizeRef.current.height = entry.contentRect.height;
        }
        // Run synchronously on resize for immediate feedback
        updateLabels();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsub();
      resizeObserver?.disconnect();
    };
  }, [store, updateLabels, scheduleUpdate, entities.length, entities]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (entityId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(entityId, el);
      } else {
        labelsRef.current.delete(entityId);
      }
    },
    []
  );

  return (
    <div ref={containerRef}>
      {entities.map((entity) => {
        // Skip entity types that render their own content (no header label)
        if (entity.type === 'comment' || entity.type === 'reroute' || entity.type === 'text' || entity.type === 'image') return null;

        const entityType = entityTypes[entity.type];
        const label = entityType?.label ?? entity.data.label ?? entity.type;

        return (
          <div key={entity.id} ref={setLabelRef(entity.id)} style={crispLabelStyle}>
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
  fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
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
function ScaledContainer({ entityTypes }: { entityTypes: Record<string, EntityTypeDefinition> }) {
  const store = useFlowStoreApi();
  const { resolved: style, config } = useEntityStyle();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Track entities for element creation/removal only
  const [entities, setEntities] = useState(() => store.getState().entities);

  // Update container transform and label positions via refs
  const updateTransform = useCallback(() => {
    pendingRef.current = false;
    const el = containerRef.current;
    if (!el) return;

    const { viewport, entityMap } = store.getState();

    // LOD: Hide if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      el.style.opacity = '0';
      return;
    }

    el.style.opacity = '1';
    // Use matrix3d for GPU acceleration on Safari
    el.style.transform = `matrix3d(${viewport.zoom},0,0,0,0,${viewport.zoom},0,0,0,0,1,0,${viewport.x},${viewport.y},0,1)`;

    // Update label positions via refs (no React re-render)
    // Uses store's entityMap for O(1) lookup per label
    labelsRef.current.forEach((labelEl, entityId) => {
      const entity = entityMap.get(entityId);
      if (entity) {
        // Vertically center text within header (fontSize=12, approximate line-height ~14)
        const verticalOffset = (style.headerHeight - 14) / 2;
        // For 'outside' header, position label above the entity
        const labelY = config.header === 'outside'
          ? entity.position.y - style.headerHeight + verticalOffset
          : entity.position.y + verticalOffset;
        labelEl.style.transform = `translate3d(${entity.position.x + 12}px, ${labelY}px, 0)`;
      }
    });
  }, [store, config, style]);

  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updateTransform);
    }
  }, [updateTransform]);

  // Setup subscriptions and resize observer
  useLayoutEffect(() => {
    // Run initial update synchronously
    updateTransform();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Only re-render React when entity count changes (add/remove elements)
      if (state.entities.length !== entities.length) {
        setEntities(state.entities);
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
    };
  }, [store, updateTransform, scheduleUpdate, entities.length]);

  // Ref callback for label elements
  const setLabelRef = useCallback(
    (entityId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        labelsRef.current.set(entityId, el);
      } else {
        labelsRef.current.delete(entityId);
      }
    },
    []
  );

  return (
    <div ref={containerRef} style={scaledContainerStyle}>
      {entities.map((entity) => {
        const entityType = entityTypes[entity.type];
        const label = entityType?.label ?? entity.data.label ?? entity.type;

        return (
          <div key={entity.id} ref={setLabelRef(entity.id)} style={scaledLabelStyle}>
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
  fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
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
  const pendingRef = useRef(false);

  // Track edges with labels for React element creation
  const [edgesWithLabels, setEdgesWithLabels] = useState<Edge[]>(() => {
    return store.getState().edges.filter(e => e.label !== undefined);
  });

  // Edge map for O(1) lookups (rebuilt when edges change)
  const edgeMapRef = useRef<Map<string, Edge>>(new Map());

  // Build socket index map for O(1) lookups (rebuilt when entities change)
  const socketIndexMapRef = useRef<SocketIndexMap>(new Map());

  // Cached container size - updated via ResizeObserver (avoids layout thrashing)
  // Initialize to 0 (SSR-safe) - ResizeObserver sets correct values on mount
  const cachedSizeRef = useRef({ width: 0, height: 0 });

  // Update function - positions all edge labels
  const updateLabels = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, entityMap } = store.getState();
    const labels = labelsRef.current;
    const socketIndexMap = socketIndexMapRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Use cached size (updated via ResizeObserver) - avoids layout thrashing
    const viewWidth = cachedSizeRef.current.width;
    const viewHeight = cachedSizeRef.current.height;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (clamped for readability)
    const baseFontSize = Math.max(10, Math.min(14, 12 * viewport.zoom));

    labels.forEach((el, edgeId) => {
      const edge = edgeMapRef.current.get(edgeId);
      if (!edge || !edge.label) {
        el.style.visibility = 'hidden';
        return;
      }

      const labelConfig = normalizeEdgeLabel(edge.label);
      const t = labelConfig.position ?? 0.5;

      // Get point along edge
      const pointResult = getEdgePointAtT(edge, entityMap, t, defaultEdgeType, socketIndexMap);
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

  // Schedule update using microtask for same-frame batching
  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updateLabels);
    }
  }, [updateLabels]);

  // Helper to rebuild socket index map
  const rebuildSocketIndexMap = (entities: Entity[]) => {
    socketIndexMapRef.current.clear();
    for (const n of entities) {
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
  };

  // Helper to rebuild edge map
  const rebuildEdgeMap = (edges: Edge[]) => {
    edgeMapRef.current.clear();
    for (const e of edges) {
      edgeMapRef.current.set(e.id, e);
    }
  };

  // Setup subscriptions and initial update
  useLayoutEffect(() => {
    // Build initial maps
    const { entities, edges } = store.getState();
    rebuildSocketIndexMap(entities);
    rebuildEdgeMap(edges);

    // Run initial update synchronously
    updateLabels();

    // Subscribe to entity structure changes only (not position changes)
    // Rebuild socket index map only when entities are added/removed
    const unsubEntities = store.subscribe(
      (state) => state.entities.length,
      () => {
        rebuildSocketIndexMap(store.getState().entities);
      }
    );

    // Subscribe to edge changes - rebuild edge map and check for label changes
    const unsubEdges = store.subscribe(
      (state) => state.edges,
      (edges) => {
        rebuildEdgeMap(edges);
        // Re-render if edges with labels changed
        const newEdgesWithLabels = edges.filter(e => e.label !== undefined);
        if (newEdgesWithLabels.length !== edgesWithLabels.length ||
            newEdgesWithLabels.some((e, i) => e.id !== edgesWithLabels[i]?.id)) {
          setEdgesWithLabels(newEdgesWithLabels);
        }
        scheduleUpdate();
      }
    );

    // Subscribe to viewport and position changes for label positioning
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => scheduleUpdate()
    );

    const unsubPositions = store.subscribe(
      (state) => state.positionVersion,
      () => scheduleUpdate()
    );

    // Resize observer for container size changes - caches size to avoid getBoundingClientRect
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          cachedSizeRef.current.width = entry.contentRect.width;
          cachedSizeRef.current.height = entry.contentRect.height;
        }
        updateLabels();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsubEntities();
      unsubEdges();
      unsubViewport();
      unsubPositions();
      resizeObserver?.disconnect();
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
  fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
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
  const socketLayout = useSocketLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Track entities for React element creation
  const [entities, setEntities] = useState(() => store.getState().entities);

  // Cached container size - updated via ResizeObserver (avoids layout thrashing)
  // Initialize to 0 (SSR-safe) - ResizeObserver sets correct values on mount
  const cachedSizeRef = useRef({ width: 0, height: 0 });

  // Update function - positions all socket labels
  const updateLabels = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, entityMap } = store.getState();
    const labels = labelsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Use cached size (updated via ResizeObserver) - avoids layout thrashing
    const viewWidth = cachedSizeRef.current.width;
    const viewHeight = cachedSizeRef.current.height;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    // Font size based on zoom (smaller for socket labels)
    const fontSize = Math.max(8, Math.min(11, 10 * viewport.zoom));

    labels.forEach((el, key) => {
      // Key format: entityId:socketId:side
      const [entityId, , side] = key.split(':');
      const entity = entityMap.get(entityId);
      if (!entity) {
        el.style.visibility = 'hidden';
        return;
      }

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
      ) {
        el.style.visibility = 'hidden';
        return;
      }

      // LOD: Hide if entity is too small on screen
      const screenHeight = height * viewport.zoom;
      if (screenHeight < MIN_LABEL_SCREEN_SIZE * 2) {
        el.style.visibility = 'hidden';
        return;
      }

      // Get socket index from data attribute
      const socketIndex = parseInt(el.dataset.socketIndex ?? '0', 10);

      // Get cached socket position (supports variable heights and stacked layouts)
      const cachedPos = side === 'input'
        ? entityLayout.inputs[socketIndex]
        : entityLayout.outputs[socketIndex];
      // Center sockets vertically within entity height (bidirectional)
      const domCenterOffset = (height - entityLayout.computedHeight) / 2;
      const socketY = entity.position.y + (cachedPos?.labelY ?? socketLayout.marginTop + socketLayout.rowHeight / 2) + domCenterOffset;
      const socketX = side === 'input' ? entity.position.x - SOCKET_OFFSET : entity.position.x + width + SOCKET_OFFSET;

      // Label offset from socket (in world space)
      const labelOffset = side === 'input' ? 12 : -12;

      // Position in screen space for crisp text
      const screenX = (socketX + labelOffset) * viewport.zoom + viewport.x;
      const screenY = socketY * viewport.zoom + viewport.y;

      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      el.style.fontSize = `${fontSize}px`;
    });
  }, [store, socketLayout]);

  // Schedule update using microtask for same-frame batching
  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updateLabels);
    }
  }, [updateLabels]);

  // Setup subscriptions and initial update
  useLayoutEffect(() => {
    // Run initial update synchronously
    updateLabels();

    // Subscribe to store changes
    const unsub = store.subscribe((state) => {
      // Re-render if entity count changed
      if (state.entities.length !== entities.length) {
        setEntities(state.entities);
      }
      scheduleUpdate();
    });

    // Resize observer for container size changes - caches size to avoid getBoundingClientRect
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          cachedSizeRef.current.width = entry.contentRect.width;
          cachedSizeRef.current.height = entry.contentRect.height;
        }
        updateLabels();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsub();
      resizeObserver?.disconnect();
    };
  }, [store, updateLabels, scheduleUpdate, entities.length]);

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

  // Collect all sockets from all entities
  const socketLabels: Array<{
    key: string;
    name: string;
    side: 'input' | 'output';
    index: number;
    outputCount: number;
  }> = [];

  for (const entity of entities) {
    const outputCount = entity.outputs?.length ?? 0;
    if (entity.inputs) {
      for (let i = 0; i < entity.inputs.length; i++) {
        const socket = entity.inputs[i];
        socketLabels.push({
          key: `${entity.id}:${socket.id}:input`,
          name: socket.name,
          side: 'input',
          index: i,
          outputCount,
        });
      }
    }
    if (entity.outputs) {
      for (let i = 0; i < entity.outputs.length; i++) {
        const socket = entity.outputs[i];
        socketLabels.push({
          key: `${entity.id}:${socket.id}:output`,
          name: socket.name,
          side: 'output',
          index: i,
          outputCount,
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
          data-output-count={item.outputCount}
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
  fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
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

// ============================================================================
// Comments Container (Phase 7C)
// ============================================================================

/** Default comment entity dimensions */
const DEFAULT_COMMENT_WIDTH = 200;
const DEFAULT_COMMENT_HEIGHT = 100;

/** Default comment styling */
const DEFAULT_COMMENT_BG = '#FFF9C4'; // Light yellow sticky note
const DEFAULT_COMMENT_TEXT_COLOR = '#424242';
const DEFAULT_COMMENT_FONT_SIZE = 14;

/**
 * Container for comment/sticky note entities.
 * Comments are fully DOM-rendered (text content, no sockets).
 * Uses ref-based updates for same-frame positioning without React re-renders.
 *
 * Note: Comment text always scales with zoom since comments are visual canvas
 * elements (like sticky notes), not labels/annotations.
 */
function CommentsContainer() {
  const store = useFlowStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Track comment entities for React element creation
  const [commentEntities, setCommentEntities] = useState<Entity<CommentEntityData>[]>(() =>
    store.getState().entities.filter((n): n is Entity<CommentEntityData> => n.type === 'comment')
  );

  // Cached container size
  const cachedSizeRef = useRef({ width: 0, height: 0 });

  // Update function - positions all comments
  const updateComments = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, entityMap, hiddenEntityIds, selectedEntityIds } = store.getState();
    const comments = commentsRef.current;

    // LOD: Hide entire container if zoomed out too far
    if (viewport.zoom < MIN_ZOOM_FOR_LABELS) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Viewport bounds for culling
    const viewWidth = cachedSizeRef.current.width;
    const viewHeight = cachedSizeRef.current.height;
    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (viewWidth - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (viewHeight - viewport.y) * invZoom;
    const cullPadding = 100;

    comments.forEach((el, entityId) => {
      const entity = entityMap.get(entityId);
      if (!entity || entity.type !== 'comment') {
        el.style.visibility = 'hidden';
        return;
      }

      // Skip if inside collapsed frame - O(1) lookup
      if (hiddenEntityIds.has(entity.id)) {
        el.style.visibility = 'hidden';
        return;
      }

      const width = entity.width ?? DEFAULT_COMMENT_WIDTH;
      const height = entity.height ?? DEFAULT_COMMENT_HEIGHT;

      // Frustum culling
      const entityRight = entity.position.x + width;
      const entityBottom = entity.position.y + height;

      if (
        entityRight < viewLeft - cullPadding ||
        entity.position.x > viewRight + cullPadding ||
        entityBottom < viewTop - cullPadding ||
        entity.position.y > viewBottom + cullPadding
      ) {
        el.style.visibility = 'hidden';
        return;
      }

      // Position in screen space
      const screenX = entity.position.x * viewport.zoom + viewport.x;
      const screenY = entity.position.y * viewport.zoom + viewport.y;
      const screenWidth = width * viewport.zoom;
      const screenHeight = height * viewport.zoom;

      // Apply selection border
      const isSelected = selectedEntityIds.has(entityId);

      // Get base font size from data attribute
      // Comments always scale text with zoom since they're visual canvas elements (not labels)
      const baseFontSize = parseFloat(el.dataset.baseFontSize ?? String(DEFAULT_COMMENT_FONT_SIZE));
      const scaledFontSize = baseFontSize * viewport.zoom;

      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      el.style.width = `${screenWidth}px`;
      el.style.height = `${screenHeight}px`;
      el.style.fontSize = `${scaledFontSize}px`;
      el.style.boxShadow = isSelected
        ? '0 0 0 2px var(--indigo-9, #5c5ce0), 0 2px 8px rgba(0,0,0,0.15)'
        : '0 2px 8px rgba(0,0,0,0.15)';
    });
  }, [store]);

  // Schedule update using microtask
  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updateComments);
    }
  }, [updateComments]);

  // Setup subscriptions
  useLayoutEffect(() => {
    updateComments();

    const unsub = store.subscribe((state) => {
      // Re-render if comment entities changed
      const currentComments = state.entities.filter(
        (n): n is Entity<CommentEntityData> => n.type === 'comment'
      );
      if (currentComments.length !== commentEntities.length) {
        setCommentEntities(currentComments);
      }
      scheduleUpdate();
    });

    // Resize observer
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          cachedSizeRef.current.width = entry.contentRect.width;
          cachedSizeRef.current.height = entry.contentRect.height;
        }
        updateComments();
      });
      resizeObserver.observe(parent);
    }

    return () => {
      unsub();
      resizeObserver?.disconnect();
    };
  }, [store, updateComments, scheduleUpdate, commentEntities.length]);

  // Ref callback for comment elements
  const setCommentRef = useCallback(
    (entityId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        commentsRef.current.set(entityId, el);
      } else {
        commentsRef.current.delete(entityId);
      }
    },
    []
  );

  if (commentEntities.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef}>
      {commentEntities.map((entity) => {
        const data = entity.data as CommentEntityData;
        const bgColor = data.backgroundColor ?? DEFAULT_COMMENT_BG;
        const textColor = data.textColor ?? DEFAULT_COMMENT_TEXT_COLOR;
        const fontSize = data.fontSize ?? DEFAULT_COMMENT_FONT_SIZE;

        return (
          <div
            key={entity.id}
            ref={setCommentRef(entity.id)}
            data-base-font-size={fontSize}
            style={{
              ...commentStyle,
              backgroundColor: bgColor,
              color: textColor,
            }}
          >
            {data.content}
          </div>
        );
      })}
    </div>
  );
}

const commentStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  padding: '12px',
  borderRadius: '4px',
  boxSizing: 'border-box',
  overflow: 'hidden',
  fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
  lineHeight: '1.4',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
  // Allow interaction with comments (for editing in the future)
  pointerEvents: 'auto',
  cursor: 'default',
  userSelect: 'text',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};
