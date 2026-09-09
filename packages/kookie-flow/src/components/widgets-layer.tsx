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
    /**
     * The widget's value: local, but it follows an external write unless you are mid-edit.
     *
     * `useState(initialValue)` seeds ONCE, so a value changed anywhere but in this widget — a
     * consumer setting it, an undo, a preset being applied — never reached the control. It showed
     * whatever it was given at mount.
     *
     * BOTH OBVIOUS REPAIRS ARE BROKEN, which is why this is worth a paragraph rather than a line:
     *
     *  - fully controlled (read `initialValue` every render) freezes the widget while you type, in
     *    every consumer that does not immediately echo the change back — including the demo shipped
     *    with this package.
     *  - unconditionally syncing on `initialValue` resets the field on every keystroke for every
     *    consumer that DOES echo it back, because the echo arrives one render later.
     *
     * So the value follows an external write only while this widget is not being edited. The
     * assumption that carries — stated because it is a behaviour choice, not a derivation — is that
     * a write arriving mid-edit loses to what the person is typing, and is picked up once the value
     * they typed has round-tripped. That is what every text input on the platform does, and it is
     * the only one of the three that is not broken for somebody.
     */
    const [value, setValue] = useState(initialValue ?? config.defaultValue);
    /** Set while this widget's own change is still in flight to the consumer and back. */
    const editingRef = useRef(false);

    useEffect(() => {
      const incoming = initialValue ?? config.defaultValue;
      if (editingRef.current) {
        // Our own value came back: the round trip is complete and external writes win again.
        if (Object.is(incoming, value)) editingRef.current = false;
        return;
      }
      setValue(incoming);
      // `value` is deliberately absent: this effect reacts to what arrives from outside, and
      // listing our own state here would make it fight the line above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialValue, config.defaultValue]);

    const handleChange = useCallback(
      (newValue: unknown) => {
        editingRef.current = true;
        setValue(newValue);
        onWidgetChange?.(entityId, socketId, newValue);
      },
      [entityId, socketId, onWidgetChange]
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
    prev.config.rows === next.config.rows
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
        const key = `${entity.id}:${socket.id}`;

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

    /**
     * Re-snapshot on the store's own structure signals rather than on lengths.
     *
     * Both gates compared a COUNT, so anything that changed a graph without changing how many
     * things were in it was invisible: giving an entity a `color` left its widgets on the default
     * theme forever, adding a socket to an entity that already had one added no widget, and
     * connecting a socket did not disable the widget sitting on it — the connected-set is rebuilt
     * as a fresh Set on every edge change, and its SIZE stays put when one connection replaces
     * another.
     *
     * `topologyVersion` is bumped unconditionally by `setEntities` and is the established
     * "structure changed, re-snapshot" signal here — `image-entities` and `reroute-nodes` both
     * already subscribe to exactly it, so this is a promotion rather than an invention.
     *
     * KNOWN GAP, stated rather than smuggled: `applyEntityChanges` bumps `topologyVersion` only
     * when the topology actually changed, so a `data`-only change made by calling that store action
     * DIRECTLY is still invisible here. Inside KookieFlow every such change round-trips through the
     * consumer's `entities` prop and `FlowSync`'s `setEntities`, which does bump — so the gap needs
     * someone driving the store through the exported `useFlowStoreApi`. Closing it means bumping on
     * `data` in the store, which also re-renders two other components; it is a separate change.
     */
    const unsubscribeState = store.subscribe(
      (state) => ({ topology: state.topologyVersion, connected: state.connectedSockets }),
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
