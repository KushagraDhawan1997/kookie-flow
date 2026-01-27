/**
 * WidgetsLayer - Interactive widgets for socket inputs (Phase 7D)
 *
 * Renders socket widgets in the DOM layer with:
 * - Ref-based positioning (no React re-renders on pan/zoom)
 * - Viewport culling (only renders visible widgets)
 * - LOD (hides widgets when zoomed out below threshold)
 * - Auto-hide when socket is connected
 *
 * Performance optimizations:
 * - Selective store subscription (viewport + nodeMap only for positions)
 * - Pre-parsed nodeId in data attributes (no string splitting in hot loop)
 * - Batched style writes via cssText
 * - Cached node heights
 */

import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  useMemo,
  memo,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import { useSocketLayout } from '../contexts/StyleContext';
import { BUILT_IN_WIDGETS } from './widgets';
import { resolveWidgetConfig } from '../utils/widgets';
import { DEFAULT_NODE_WIDTH } from '../core/constants';
import { calculateMinNodeHeight } from '../utils/style-resolver';
import type {
  Node,
  Socket,
  SocketType,
  WidgetProps,
  ResolvedWidgetConfig,
  AccentColor,
} from '../types';
import { shallow } from 'zustand/shallow';

/** Theme component type for per-node accent color support */
type ThemeComponentType = React.ComponentType<{
  accentColor?: AccentColor;
  hasBackground?: boolean;
  asChild?: boolean;
  children: React.ReactNode;
}>;

export interface WidgetsLayerProps {
  /** Socket type definitions for widget resolution */
  socketTypes: Record<string, SocketType>;
  /** Custom widget components (override built-ins or add new types) */
  widgetTypes?: Record<string, React.ComponentType<WidgetProps>>;
  /** Callback when a widget value changes */
  onWidgetChange?: (nodeId: string, socketId: string, value: unknown) => void;
  /** Minimum zoom level to show widgets. Default: 0.4 */
  minWidgetZoom?: number;
  /**
   * Kookie UI Theme component for per-node accent color support.
   * Pass `Theme` from @kushagradhawan/kookie-ui to enable widget theming.
   * When provided, widgets on nodes with `color` prop will use that accent color.
   */
  ThemeComponent?: ThemeComponentType;
}

// LOD threshold for widgets - match node/label visibility (0.1 = minZoom default)
const DEFAULT_MIN_WIDGET_ZOOM = 0.1;

// Container styles
const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none', // Container is non-interactive
  overflow: 'hidden',
  zIndex: 5, // Above DOMLayer but below overlays
};

/**
 * Individual socket widget wrapper.
 * Handles value state and change callbacks.
 * Wraps in Theme component when node has custom color (for Kookie UI integration).
 */
interface SocketWidgetProps {
  nodeId: string;
  socketId: string;
  config: ResolvedWidgetConfig;
  /** Pre-resolved widget component (avoid passing widgetTypes object) */
  WidgetComponent: React.ComponentType<WidgetProps>;
  onWidgetChange?: (nodeId: string, socketId: string, value: unknown) => void;
  initialValue: unknown;
  /** Per-node accent color (changes widget theme) */
  nodeColor?: AccentColor;
  /** Theme component for accent color support */
  ThemeComponent?: ThemeComponentType;
}

const SocketWidget = memo(
  function SocketWidget({
    nodeId,
    socketId,
    config,
    WidgetComponent,
    onWidgetChange,
    initialValue,
    nodeColor,
    ThemeComponent,
  }: SocketWidgetProps) {
    // Local value state (widget controls its own value, notifies parent on change)
    const [value, setValue] = useState(initialValue ?? config.defaultValue);

    const handleChange = useCallback(
      (newValue: unknown) => {
        setValue(newValue);
        onWidgetChange?.(nodeId, socketId, newValue);
      },
      [nodeId, socketId, onWidgetChange]
    );

    const widget = (
      <WidgetComponent
        value={value}
        onChange={handleChange}
        min={config.min}
        max={config.max}
        step={config.step}
        options={config.options}
        placeholder={config.placeholder}
      />
    );

    // Wrap in Theme if node has custom color and ThemeComponent is provided
    if (nodeColor && ThemeComponent) {
      return (
        <ThemeComponent accentColor={nodeColor} hasBackground={false} asChild>
          <div style={{ width: '100%', height: '100%' }}>{widget}</div>
        </ThemeComponent>
      );
    }

    return widget;
  },
  // Custom comparison: only re-render if value-affecting props change
  (prev, next) =>
    prev.nodeId === next.nodeId &&
    prev.socketId === next.socketId &&
    prev.WidgetComponent === next.WidgetComponent &&
    prev.onWidgetChange === next.onWidgetChange &&
    prev.initialValue === next.initialValue &&
    prev.nodeColor === next.nodeColor &&
    prev.ThemeComponent === next.ThemeComponent &&
    prev.config.type === next.config.type &&
    prev.config.min === next.config.min &&
    prev.config.max === next.config.max &&
    prev.config.step === next.config.step
);

// Cached node height computation to avoid recalculating in hot loop
const nodeHeightCache = new Map<string, number>();

function getCachedNodeHeight(node: Node, socketLayout: ReturnType<typeof useSocketLayout>): number {
  if (node.height !== undefined) return node.height;

  const cacheKey = `${node.outputs?.length ?? 0}:${node.inputs?.length ?? 0}`;
  let height = nodeHeightCache.get(cacheKey);
  if (height === undefined) {
    height = calculateMinNodeHeight(
      node.outputs?.length ?? 0,
      node.inputs?.length ?? 0,
      socketLayout
    );
    nodeHeightCache.set(cacheKey, height);
  }
  return height;
}

// Static styles for widget wrappers - set once at mount, never in hot loop
// PERF: Using direct property updates in updatePositions() instead of cssText
// avoids 28ms+ style recalculation when dragging nodes (cssText replaces ALL styles)
const widgetWrapperStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  transformOrigin: '0 0',
  contain: 'layout style', // Isolate layout without clipping overflow (no paint/size)
  willChange: 'transform',
  // Start hidden - updatePositions shows after positioning
  visibility: 'hidden',
};

/**
 * Widgets layer component.
 * Renders widgets adjacent to input sockets, with performance optimizations.
 */
export function WidgetsLayer({
  socketTypes,
  widgetTypes = {},
  onWidgetChange,
  minWidgetZoom = DEFAULT_MIN_WIDGET_ZOOM,
  ThemeComponent,
}: WidgetsLayerProps) {
  const store = useFlowStoreApi();
  const socketLayout = useSocketLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Cached container size - updated via ResizeObserver (avoids layout thrashing)
  // Initialize to 0 (SSR-safe) - ResizeObserver sets correct values on mount
  const cachedSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Track nodes and connected sockets for widget creation
  const [nodes, setNodes] = useState(() => store.getState().nodes);
  const [connectedSockets, setConnectedSockets] = useState(() => store.getState().connectedSockets);

  // Stable reference to widgetTypes to avoid re-resolving components unnecessarily
  const widgetTypesRef = useRef(widgetTypes);
  widgetTypesRef.current = widgetTypes;

  // Widget configs per node socket (memoized to avoid recalculation)
  // Pre-resolves widget components to avoid passing unstable widgetTypes object to children
  const widgetConfigs = useMemo(() => {
    const configs = new Map<
      string,
      {
        node: Node;
        socket: Socket;
        config: ResolvedWidgetConfig;
        inputIndex: number;
        WidgetComponent: React.ComponentType<WidgetProps>;
      }
    >();

    const currentWidgetTypes = widgetTypesRef.current;

    for (const node of nodes) {
      if (!node.inputs) continue;

      for (let inputIndex = 0; inputIndex < node.inputs.length; inputIndex++) {
        const socket = node.inputs[inputIndex];
        const key = `${node.id}:${socket.id}`;

        // Skip if socket is connected
        if (connectedSockets.has(key)) continue;

        // Resolve widget config
        const config = resolveWidgetConfig(socket, socketTypes);
        if (!config) continue;

        // Pre-resolve widget component (avoids passing widgetTypes to child)
        const WidgetComponent =
          config.customComponent ??
          currentWidgetTypes[config.type] ??
          BUILT_IN_WIDGETS[config.type];

        if (!WidgetComponent) continue;

        configs.set(key, { node, socket, config, inputIndex, WidgetComponent });
      }
    }

    return configs;
  }, [nodes, connectedSockets, socketTypes]);

  // Position update function (microtask-batched for same-frame updates)
  const updatePositions = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, nodeMap } = store.getState();
    const widgets = widgetRefsMap.current;
    const { zoom, x: vpX, y: vpY } = viewport;

    // LOD: Hide all widgets if zoomed out too far
    if (zoom < minWidgetZoom) {
      container.style.visibility = 'hidden';
      return;
    }
    container.style.visibility = 'visible';

    // Use cached size (updated via ResizeObserver) - avoids layout thrashing
    const viewWidth = cachedSizeRef.current.width;
    const viewHeight = cachedSizeRef.current.height;

    const invZoom = 1 / zoom;
    const viewLeft = -vpX * invZoom;
    const viewRight = (viewWidth - vpX) * invZoom;
    const viewTop = -vpY * invZoom;
    const viewBottom = (viewHeight - vpY) * invZoom;
    const cullPadding = 150;

    widgets.forEach((el, key) => {
      // Get nodeId from data attribute (no string splitting)
      const nodeId = el.dataset.nodeId;
      if (!nodeId) {
        el.style.visibility = 'hidden';
        return;
      }

      const node = nodeMap.get(nodeId);
      if (!node) {
        el.style.visibility = 'hidden';
        return;
      }

      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = getCachedNodeHeight(node, socketLayout);

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

      // Get socket index from data attribute (pre-parsed as number)
      const socketIndex = Number(el.dataset.socketIndex) || 0;
      const outputCount = node.outputs?.length ?? 0;

      // Calculate socket row Y position (world coords)
      const rowIndex = outputCount + socketIndex;
      const socketY =
        node.position.y +
        socketLayout.marginTop +
        rowIndex * socketLayout.rowHeight +
        socketLayout.rowHeight / 2;

      // Widget world position
      const widgetX = node.position.x + socketLayout.padding + 60;
      const widgetY = socketY - socketLayout.widgetHeight / 2;
      const widgetWidth = width - socketLayout.padding * 2 - 60;

      // Convert to screen coordinates for transform (scale doesn't affect translate)
      const screenX = widgetX * zoom + vpX;
      const screenY = widgetY * zoom + vpY;

      // PERF: Direct property updates (not cssText) to avoid style recalculation
      // Only update transform (composite) and visibility - no layout properties in hot loop
      el.style.transform = `translate3d(${screenX}px,${screenY}px,0) scale(${zoom})`;
      el.style.visibility = 'visible';

      // Width/height: only update if changed (rare - only on node resize, not drag)
      // Using dataset to cache previous values avoids layout thrashing
      const cachedWidth = el.dataset.w;
      const cachedHeight = el.dataset.h;
      const newWidth = `${widgetWidth}px`;
      const newHeight = `${socketLayout.widgetHeight}px`;
      if (cachedWidth !== newWidth) {
        el.style.width = newWidth;
        el.dataset.w = newWidth;
      }
      if (cachedHeight !== newHeight) {
        el.style.height = newHeight;
        el.dataset.h = newHeight;
      }
    });
  }, [store, socketLayout, minWidgetZoom]);

  // Selective subscription for position updates
  // Uses positionVersion (increments on node drag) + viewport changes
  useLayoutEffect(() => {
    const container = containerRef.current;
    const parent = container?.parentElement;

    // Set up ResizeObserver to cache container size (avoids getBoundingClientRect in hot path)
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          cachedSizeRef.current.width = entry.contentRect.width;
          cachedSizeRef.current.height = entry.contentRect.height;
          // Trigger position update on resize
          updatePositions();
        }
      });
      resizeObserver.observe(parent);
    }

    // Position updates: subscribe to viewport and positionVersion
    // Note: nodeMap is mutated in place, so we use positionVersion as change signal
    const unsubscribePositions = store.subscribe(
      (state) => ({ viewport: state.viewport, positionVersion: state.positionVersion }),
      () => {
        if (!pendingRef.current) {
          pendingRef.current = true;
          queueMicrotask(updatePositions);
        }
      },
      { equalityFn: shallow }
    );

    // React state updates: subscribe to nodes and connectedSockets for widget creation/removal
    const unsubscribeState = store.subscribe(
      (state) => ({ nodesLen: state.nodes.length, socketsSize: state.connectedSockets.size }),
      ({ nodesLen, socketsSize }) => {
        const state = store.getState();
        setNodes((prev) => (prev.length !== nodesLen ? state.nodes : prev));
        setConnectedSockets((prev) => (prev.size !== socketsSize ? state.connectedSockets : prev));
      },
      { equalityFn: shallow }
    );

    // Initial position update
    updatePositions();

    return () => {
      resizeObserver?.disconnect();
      unsubscribePositions();
      unsubscribeState();
    };
  }, [store, updatePositions]);

  // Update refs when widgets change
  useLayoutEffect(() => {
    // Clean up refs for removed widgets
    const currentKeys = new Set(widgetConfigs.keys());
    widgetRefsMap.current.forEach((_, key) => {
      if (!currentKeys.has(key)) {
        widgetRefsMap.current.delete(key);
      }
    });

    // Trigger position update
    updatePositions();
  }, [widgetConfigs, updatePositions]);

  // Collect widgets to render (avoid Array.from in render by using useMemo)
  const widgetEntries = useMemo(() => Array.from(widgetConfigs.entries()), [widgetConfigs]);

  // Stable event handlers (avoid creating new functions in render loop)
  const stopPropagation = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  return (
    <div ref={containerRef} style={containerStyle}>
      {widgetEntries.map(([key, { node, socket, config, inputIndex, WidgetComponent }]) => {
        const nodeData = node.data as Record<string, unknown> | undefined;
        const values = nodeData?.values as Record<string, unknown> | undefined;
        const initialValue = values?.[socket.id];

        return (
          <div
            key={key}
            ref={(el) => {
              if (el) {
                widgetRefsMap.current.set(key, el);
              } else {
                widgetRefsMap.current.delete(key);
              }
            }}
            data-node-id={node.id}
            data-socket-index={inputIndex}
            style={widgetWrapperStyle}
            // Stop propagation to prevent InputHandler from capturing widget interactions
            onPointerDown={stopPropagation}
            onPointerMove={stopPropagation}
            onPointerUp={stopPropagation}
            onClick={stopPropagation}
          >
            <SocketWidget
              nodeId={node.id}
              socketId={socket.id}
              config={config}
              WidgetComponent={WidgetComponent}
              onWidgetChange={onWidgetChange}
              initialValue={initialValue}
              nodeColor={node.color}
              ThemeComponent={ThemeComponent}
            />
          </div>
        );
      })}
    </div>
  );
}
