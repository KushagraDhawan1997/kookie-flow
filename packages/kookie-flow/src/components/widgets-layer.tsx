/**
 * WidgetsLayer - Interactive widgets for socket inputs (Phase 7D)
 *
 * Renders socket widgets in the DOM layer with:
 * - Ref-based positioning (no React re-renders on pan/zoom)
 * - Viewport culling (only renders visible widgets)
 * - LOD (hides widgets when zoomed out below threshold)
 * - Auto-hide when socket is connected
 */

import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  useMemo,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import { useSocketLayout } from '../contexts/StyleContext';
import { BUILT_IN_WIDGETS } from './widgets';
import {
  resolveWidgetConfig,
  buildConnectedSocketsSet,
} from '../utils/widgets';
import { DEFAULT_NODE_WIDTH } from '../core/constants';
import { calculateMinNodeHeight } from '../utils/style-resolver';
import type {
  Node,
  Socket,
  SocketType,
  WidgetProps,
  ResolvedWidgetConfig,
} from '../types';

export interface WidgetsLayerProps {
  /** Socket type definitions for widget resolution */
  socketTypes: Record<string, SocketType>;
  /** Custom widget components (override built-ins or add new types) */
  widgetTypes?: Record<string, React.ComponentType<WidgetProps>>;
  /** Callback when a widget value changes */
  onWidgetChange?: (nodeId: string, socketId: string, value: unknown) => void;
  /** Minimum zoom level to show widgets. Default: 0.4 */
  minWidgetZoom?: number;
}

// LOD threshold for widgets
const DEFAULT_MIN_WIDGET_ZOOM = 0.4;

// Container styles
const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none', // Container is non-interactive
  overflow: 'hidden',
};

/**
 * Individual socket widget wrapper.
 * Handles value state and change callbacks.
 */
interface SocketWidgetProps {
  nodeId: string;
  socket: Socket;
  config: ResolvedWidgetConfig;
  widgetTypes: Record<string, React.ComponentType<WidgetProps>>;
  onWidgetChange?: (nodeId: string, socketId: string, value: unknown) => void;
  initialValue: unknown;
}

function SocketWidget({
  nodeId,
  socket,
  config,
  widgetTypes,
  onWidgetChange,
  initialValue,
}: SocketWidgetProps) {
  // Local value state (widget controls its own value, notifies parent on change)
  const [value, setValue] = useState(initialValue ?? config.defaultValue);

  const handleChange = useCallback(
    (newValue: unknown) => {
      setValue(newValue);
      onWidgetChange?.(nodeId, socket.id, newValue);
    },
    [nodeId, socket.id, onWidgetChange]
  );

  // Get widget component: custom component from config, or registered type, or built-in
  const WidgetComponent = useMemo(() => {
    if (config.customComponent) {
      return config.customComponent;
    }
    return widgetTypes[config.type] ?? BUILT_IN_WIDGETS[config.type];
  }, [config.customComponent, config.type, widgetTypes]);

  if (!WidgetComponent) {
    return null;
  }

  return (
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
}

/**
 * Widgets layer component.
 * Renders widgets adjacent to input sockets, with performance optimizations.
 */
export function WidgetsLayer({
  socketTypes,
  widgetTypes = {},
  onWidgetChange,
  minWidgetZoom = DEFAULT_MIN_WIDGET_ZOOM,
}: WidgetsLayerProps) {
  const store = useFlowStoreApi();
  const socketLayout = useSocketLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRef = useRef(false);

  // Track nodes and edges for widget creation
  const [nodes, setNodes] = useState(() => store.getState().nodes);
  const [edges, setEdges] = useState(() => store.getState().edges);

  // Compute connected sockets set
  const connectedSockets = useMemo(
    () => buildConnectedSocketsSet(edges),
    [edges]
  );

  // Widget configs per node socket (memoized to avoid recalculation)
  const widgetConfigs = useMemo(() => {
    const configs = new Map<string, { node: Node; socket: Socket; config: ResolvedWidgetConfig }>();

    for (const node of nodes) {
      if (!node.inputs) continue;

      for (const socket of node.inputs) {
        const key = `${node.id}:${socket.id}`;

        // Skip if socket is connected
        if (connectedSockets.has(key)) continue;

        // Resolve widget config
        const config = resolveWidgetConfig(socket, socketTypes);
        if (!config) continue;

        configs.set(key, { node, socket, config });
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

    // LOD: Hide all widgets if zoomed out too far
    if (viewport.zoom < minWidgetZoom) {
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
    const cullPadding = 150; // Larger padding for widgets

    widgets.forEach((el, key) => {
      const [nodeId] = key.split(':');
      const node = nodeMap.get(nodeId);

      if (!node) {
        el.style.visibility = 'hidden';
        return;
      }

      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const outputCount = node.outputs?.length ?? 0;
      const inputCount = node.inputs?.length ?? 0;
      const height = node.height ?? calculateMinNodeHeight(outputCount, inputCount, socketLayout);

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

      el.style.visibility = 'visible';

      // Get socket index from data attribute
      const socketIndex = parseInt(el.dataset.socketIndex ?? '0', 10);

      // Calculate socket row Y position
      // Layout order: outputs first, then inputs
      const rowIndex = outputCount + socketIndex;
      const socketY =
        node.position.y +
        socketLayout.marginTop +
        rowIndex * socketLayout.rowHeight +
        socketLayout.rowHeight / 2;

      // Widget starts after socket label area (roughly 60px from left edge)
      const widgetX = node.position.x + socketLayout.padding + 60;

      // Transform to screen coordinates
      const screenX = widgetX * viewport.zoom + viewport.x;
      const screenY = socketY * viewport.zoom + viewport.y;

      // Position widget (centered vertically in row)
      el.style.transform = `translate3d(${screenX}px, ${screenY - (socketLayout.widgetHeight / 2) * viewport.zoom}px, 0)`;
      el.style.width = `${(width - socketLayout.padding * 2 - 80) * viewport.zoom}px`;
      el.style.height = `${socketLayout.widgetHeight * viewport.zoom}px`;
    });
  }, [store, socketLayout, minWidgetZoom]);

  // Subscribe to store changes
  useLayoutEffect(() => {
    const unsubscribe = store.subscribe(() => {
      // Check for node/edge changes (triggers React render for widget creation)
      const state = store.getState();
      setNodes((prev) => (prev.length !== state.nodes.length ? state.nodes : prev));
      setEdges((prev) => (prev.length !== state.edges.length ? state.edges : prev));

      // Schedule position update using microtask (same-frame, no 1-frame lag)
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(updatePositions);
      }
    });

    // Initial position update
    updatePositions();

    return () => {
      unsubscribe();
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

  // Collect widgets to render
  const widgetEntries = Array.from(widgetConfigs.entries());

  return (
    <div ref={containerRef} style={containerStyle}>
      {widgetEntries.map(([key, { node, socket, config }]) => {
        const inputIndex = node.inputs?.findIndex((s) => s.id === socket.id) ?? 0;
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
            data-socket-index={inputIndex}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'auto', // Widgets are interactive
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <SocketWidget
              nodeId={node.id}
              socket={socket}
              config={config}
              widgetTypes={widgetTypes}
              onWidgetChange={onWidgetChange}
              initialValue={initialValue}
            />
          </div>
        );
      })}
    </div>
  );
}
