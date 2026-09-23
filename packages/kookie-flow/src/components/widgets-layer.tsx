import { entitySocketKey } from '../utils/socket-key';
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
 * - Selective store subscription (viewport + entityMap only for positions)
 * - Pre-parsed entityId in data attributes (no string splitting in hot loop)
 * - Batched style writes via cssText
 * - Cached entity heights
 */

import {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  memo,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import { useSocketLayout } from '../contexts/StyleContext';
import { resolveWidgetConfig } from '../utils/widgets';
import { ownSocketValue, sameWidgetValue, type WidgetOverride } from '../utils/widget-values';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { getWidgetBox } from '../utils/widget-geometry';
import type {
  Entity,
  Socket,
  SocketType,
  WidgetProps,
  ResolvedWidgetConfig,
  AccentColor,
  KookieFlowProps,
} from '../types';
import { shallow } from 'zustand/shallow';

/**
 * The wrapper a consumer supplies for widget theming.
 *
 * Declared ONCE, in `types/index.ts`, and imported here. There used to be two declarations and
 * they disagreed: this one required `asChild` and the public one omitted it, so the type a
 * consumer checks against admitted a component that could not accept the prop this file passed.
 */
type ThemeComponentType = NonNullable<KookieFlowProps['ThemeComponent']>;

const EMPTY_WIDGET_TYPES: Record<string, React.ComponentType<WidgetProps>> = {};

export interface WidgetsLayerProps {
  /** Socket type definitions for widget resolution */
  socketTypes: Record<string, SocketType>;
  /** Custom widget components (override built-ins or add new types) */
  widgetTypes?: Record<string, React.ComponentType<WidgetProps>>;
  /** Callback when a widget value changes */
  onWidgetChange?: (entityId: string, socketId: string, value: unknown) => void;
  /** Minimum zoom level to show widgets. Default: 0.4 */
  minWidgetZoom?: number;
  /**
   * An opaque wrapper mounted around consumer-supplied widgets.
   *
   * It used to be documented as per-entity accent colour support — pass a `Theme` and a widget on
   * an entity with a `color` would take that accent. That is NO LONGER EXPRESSIBLE, and the
   * public type says so at its declaration: KookieUI v2 refuses `accentColor`, `hasBackground`
   * and `asChild` as compile errors, so there is nothing for an entity's colour to be handed to.
   * See the `ThemeComponentType` declaration in ../types for the whole story.
   */
  ThemeComponent?: ThemeComponentType;
  /** Default entity width when entity.width is not specified. Default: 240 */
  defaultEntityWidth?: number;
  /** Width reserved for socket labels before widget starts. Default: 96 */
  socketLabelWidth?: number;
}

// LOD threshold for widgets - match entity/label visibility (0.1 = minZoom default)
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
 * Wraps in Theme component when entity has custom color (for Kookie UI integration).
 */
interface SocketWidgetProps {
  entityId: string;
  socketId: string;
  /** The socket's name, forwarded to the widget as its accessible name. */
  socketName: string;
  config: ResolvedWidgetConfig;
  /** Pre-resolved widget component (avoid passing widgetTypes object) */
  WidgetComponent: React.ComponentType<WidgetProps>;
  onWidgetChange?: (entityId: string, socketId: string, value: unknown) => void;
  initialValue: unknown;
  /** Per-entity accent color (changes widget theme) */
  entityColor?: AccentColor;
  /** Theme component for accent color support */
  ThemeComponent?: ThemeComponentType;
}

const SocketWidget = memo(
  function SocketWidget({
    entityId,
    socketId,
    socketName,
    config,
    WidgetComponent,
    onWidgetChange,
    initialValue,
    entityColor,
    ThemeComponent,
  }: SocketWidgetProps) {
    // Keep a local edit until the consumer changes the baseline. A clamped or
    // normalized response is still a response; requiring an exact echo traps the
    // widget on its rejected value forever. This matches the GL widget contract.
    const incoming = initialValue ?? config.defaultValue;
    const [pending, setPending] = useState<WidgetOverride | null>(null);
    const awaitingResponse = pending !== null && sameWidgetValue(pending.baseline, incoming);
    const value = awaitingResponse ? pending.value : incoming;
    useEffect(() => {
      if (pending && !sameWidgetValue(pending.baseline, incoming)) setPending(null);
    }, [incoming, pending]);

    const handleChange = useCallback(
      (newValue: unknown) => {
        setPending({ value: newValue, baseline: incoming });
        onWidgetChange?.(entityId, socketId, newValue);
      },
      [entityId, socketId, onWidgetChange, incoming]
    );

    const widget = (
      <WidgetComponent
        label={socketName}
        value={value}
        onChange={handleChange}
        min={config.min}
        max={config.max}
        step={config.step}
        options={config.options}
        optionLabels={config.optionLabels}
        placeholder={config.placeholder}
        rows={config.rows}
      />
    );

    // Wrap in Theme if entity has custom color and ThemeComponent is provided
    if (entityColor && ThemeComponent) {
      return (
        <ThemeComponent>
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'stretch' }}>
            {widget}
          </div>
        </ThemeComponent>
      );
    }

    return widget;
  },
  // Custom comparison: only re-render if value-affecting props change
  (prev, next) =>
    prev.entityId === next.entityId &&
    prev.socketId === next.socketId &&
    prev.socketName === next.socketName &&
    prev.WidgetComponent === next.WidgetComponent &&
    prev.onWidgetChange === next.onWidgetChange &&
    prev.initialValue === next.initialValue &&
    prev.entityColor === next.entityColor &&
    prev.ThemeComponent === next.ThemeComponent &&
    prev.config.type === next.config.type &&
    prev.config.min === next.config.min &&
    prev.config.max === next.config.max &&
    prev.config.step === next.config.step &&
    prev.config.rows === next.config.rows &&
    prev.config.defaultValue === next.config.defaultValue &&
    prev.config.placeholder === next.config.placeholder &&
    prev.config.options === next.config.options &&
    prev.config.optionLabels === next.config.optionLabels
);

// Helper to get entity height from cache (supports variable socket heights)
function getCachedEntityHeight(entity: Entity, socketLayout: ReturnType<typeof useSocketLayout>): number {
  if (entity.height !== undefined) return entity.height;
  return getEntitySocketLayout(entity, socketLayout).computedHeight;
}

// Static styles for widget wrappers - set once at mount, never in hot loop
// PERF: Using direct property updates in updatePositions() instead of cssText
// avoids 28ms+ style recalculation when dragging entities (cssText replaces ALL styles)
const widgetWrapperStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'stretch', // Allow widgets to fill height (for textarea rows)
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
  widgetTypes = EMPTY_WIDGET_TYPES,
  onWidgetChange,
  minWidgetZoom = DEFAULT_MIN_WIDGET_ZOOM,
  ThemeComponent,
  defaultEntityWidth: defaultEntityWidthProp,
  socketLabelWidth: socketLabelWidthProp,
}: WidgetsLayerProps) {
  // Use prop values with fallback to constants
  const entityWidthDefault = defaultEntityWidthProp ?? DEFAULT_ENTITY_WIDTH;
  const labelWidth = socketLabelWidthProp ?? SOCKET_LABEL_WIDTH;
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

  // Track entities and connected sockets for widget creation
  const [entities, setEntities] = useState(() => store.getState().entities);
  const [connectedSockets, setConnectedSockets] = useState(() => store.getState().connectedSockets);

  // Widget configs per entity socket (memoized to avoid recalculation)
  // Pre-resolves widget components to avoid passing unstable widgetTypes object to children
  const widgetConfigs = useMemo(() => {
    const configs = new Map<
      string,
      {
        entity: Entity;
        socket: Socket;
        config: ResolvedWidgetConfig;
        inputIndex: number;
        WidgetComponent: React.ComponentType<WidgetProps>;
      }
    >();

    const currentWidgetTypes = widgetTypes;

    for (const entity of entities) {
      if (!entity.inputs) continue;

      for (let inputIndex = 0; inputIndex < entity.inputs.length; inputIndex++) {
        const socket = entity.inputs[inputIndex];
        const key = entitySocketKey(entity.id, socket.id);

        // Skip if socket is connected. The connected set is keyed per direction; these are
        // inputs.
        if (connectedSockets.has(`${key}:input`)) continue;

        // Resolve widget config
        const config = resolveWidgetConfig(socket, socketTypes);
        if (!config) continue;

        /**
         * Only CONSUMER-SUPPLIED widgets render in the DOM now.
         *
         * The seven built-ins draw in WebGL (`widgets-gl.tsx`) and take their interaction there,
         * because a real design-system control per socket per visible node is thousands of
         * composited layers — the same measured reason the DOM label path was deleted before them.
         *
         * A component the consumer passed is a different thing: `plans/technical-decisions.md`
         * names custom node content as the escape hatch that stays in the DOM, and a library
         * cannot draw a component it has never seen. So a `widgetTypes` entry or an inline
         * `socket.widget` component still mounts here, and a built-in does not.
         */
        const WidgetComponent = config.customComponent ?? currentWidgetTypes[config.type];
        if (!WidgetComponent) continue;

        configs.set(key, { entity, socket, config, inputIndex, WidgetComponent });
      }
    }

    return configs;
    // `widgetTypes` is named rather than read through a ref. The ref kept it out of this list, so
    // a consumer swapping their widget map got the old components until something else happened to
    // invalidate the memo. It costs nothing today — `socketTypes` beside it already churns per
    // render — and stops costing nothing the day that is fixed.
  }, [entities, connectedSockets, socketTypes, widgetTypes]);

  // Position update function (microtask-batched for same-frame updates)
  const updatePositions = useCallback(() => {
    pendingRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { viewport, entityMap } = store.getState();
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
      // Get entityId from data attribute (no string splitting)
      const entityId = el.dataset.entityId;
      if (!entityId) {
        el.style.visibility = 'hidden';
        return;
      }

      const entity = entityMap.get(entityId);
      if (!entity) {
        el.style.visibility = 'hidden';
        return;
      }

      const width = entity.width ?? entityWidthDefault;
      const height = getCachedEntityHeight(entity, socketLayout);

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

      // Get socket index from data attribute (pre-parsed as number)
      const socketIndex = Number(el.dataset.socketIndex) || 0;

      // Get cached socket position (supports variable heights and stacked layouts)
      const entityLayout = getEntitySocketLayout(entity, socketLayout);
      const cachedPos = entityLayout.inputs[socketIndex];
      if (!cachedPos) {
        el.style.visibility = 'hidden';
        return;
      }

      // The world box, from the ONE home. The GL widget layer and the hit test read the same
      // function, so a widget cannot be drawn in one place and pressed in another — the defect
      // the socket geometry already produced once.
      const box = getWidgetBox(entity, socketIndex, socketLayout, entityWidthDefault, labelWidth);
      if (!box) {
        el.style.visibility = 'hidden';
        return;
      }
      const { x: widgetX, y: widgetY, width: widgetWidth } = box;

      // Convert to screen coordinates for transform (scale doesn't affect translate)
      const screenX = widgetX * zoom + vpX;
      const screenY = widgetY * zoom + vpY;

      // PERF: Direct property updates (not cssText) to avoid style recalculation
      // Only update transform (composite) and visibility - no layout properties in hot loop
      el.style.transform = `translate3d(${screenX}px,${screenY}px,0) scale(${zoom})`;
      el.style.visibility = 'visible';

      // Width/height: only update if changed (rare - only on entity resize, not drag)
      // Using dataset to cache previous values avoids layout thrashing
      const cachedWidth = el.dataset.w;
      const cachedHeight = el.dataset.h;
      const newWidth = `${widgetWidth}px`;
      const newHeight = `${cachedPos.widgetHeight}px`; // Use cached height (supports rows prop)
      if (cachedWidth !== newWidth) {
        el.style.width = newWidth;
        el.dataset.w = newWidth;
      }
      if (cachedHeight !== newHeight) {
        el.style.height = newHeight;
        el.dataset.h = newHeight;
      }
    });
  }, [store, socketLayout, minWidgetZoom, entityWidthDefault, labelWidth]);

  // Selective subscription for position updates
  // Uses positionVersion (increments on entity drag) + viewport changes
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
    // Note: entityMap is mutated in place, so we use positionVersion as change signal
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

    // The entity array is the document signal, including data-only changes made
    // through the public store API. Topology alone misses those writes.
    const unsubscribeState = store.subscribe(
      (state) => ({ entities: state.entities, connected: state.connectedSockets }),
      () => {
        const state = store.getState();
        setEntities(state.entities);
        setConnectedSockets(state.connectedSockets);
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
      {widgetEntries.map(([key, { entity, socket, config, inputIndex, WidgetComponent }]) => {
        const entityData = entity.data as Record<string, unknown> | undefined;
        const values = entityData?.values as Record<string, unknown> | undefined;
        const initialValue = ownSocketValue(values, socket.id);

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
            data-entity-id={entity.id}
            data-socket-index={inputIndex}
            role="group"
            // Redundant with the widget's own aria-label for six of the seven built-ins — a user
            // hears "Prompt, group / Prompt, edit text". Kept because it is the ONLY name a SLIDER
            // socket can have: kookie-ui hardcodes the thumb's label (`Slider value: 0.5`) on the
            // element that carries role="slider", so a consumer aria-label lands on the Root span
            // and names nothing. Fixing that properly is upstream work in kookie-ui.
            aria-label={socket.name}
            style={widgetWrapperStyle}
            // Stop propagation to prevent InputHandler from capturing widget interactions
            onPointerDown={stopPropagation}
            onPointerMove={stopPropagation}
            onPointerUp={stopPropagation}
            onClick={stopPropagation}
            onKeyDown={stopPropagation}
          >
            <SocketWidget
              entityId={entity.id}
              socketId={socket.id}
              socketName={socket.name}
              config={config}
              WidgetComponent={WidgetComponent}
              onWidgetChange={onWidgetChange}
              initialValue={initialValue}
              entityColor={entity.color}
              ThemeComponent={ThemeComponent}
            />
          </div>
        );
      })}
    </div>
  );
}
