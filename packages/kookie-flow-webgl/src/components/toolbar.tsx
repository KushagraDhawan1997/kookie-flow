/**
 * Toolbar - Floating toolbar that appears when entities are selected.
 *
 * Positioned relative to the selection's screen-space bounding box.
 * Content is resolved from entityTypes[type].toolbar config.
 *
 * Performance:
 * - Ref-based translate3d positioning (no React re-renders during pan/zoom)
 * - Microtask batching for same-frame updates
 * - Hidden during drag, resize, connect, box select
 * - Viewport collision detection for auto-flip
 */

import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  useEffect,
  useMemo,
  useInsertionEffect,
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  TextField,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SegmentedControl,
  SegmentedItem,
  Toolbar as KuiToolbar,
  ToolbarGroup,
  ToolbarButton,
  iconStroke,
} from '@kushagradhawan/kookie-ui-react';
import type { ToolbarProps as KuiToolbarProps } from '@kushagradhawan/kookie-ui-react';
import { NOTE_HUES, noteHue, noteInk } from '../utils/note-ink';
import { useFlowStoreApi } from './context';
import { getInteractionMode, observeInteractionMode } from './interaction-state';
import { getEntitySocketLayout } from '@kushagradhawan/kookie-flow-core/internal/utils/socket-layout-cache';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_ENTITY_WIDTH } from '@kushagradhawan/kookie-flow-core/internal/core/constants';
import type {
  Entity,
  EntityData,
  EntityTypeDefinition,
  EntityChange,
  TextEntityData,
  TextSizingMode,
  ToolbarConfig,
  ToolbarRenderFn,
  ToolbarRenderProps,
  AlignEdge,
  DistributeAxis,
  DrawEntityData,
  ToolbarWidget,
} from '../types/index';
import { useFont, resolveFontForWeight } from '../contexts/FontContext';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { restroke } from '../utils/stroke-geometry';
import { DEFAULT_STROKE_WIDTH } from './draw-entities';
import {
  resolveTextStyle,
  calculateTextAutoHeightMSDF,
  calculateTextAutoSizeMSDF,
} from '@kushagradhawan/kookie-flow-core/internal/utils/text-texture';
import {
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
} from '@kushagradhawan/kookie-flow-core/internal/core/constants';

// ============================================================================
// Context — provides entityTypes + onEntitiesChange to Toolbar children
// ============================================================================

interface ToolbarContextValue {
  entityTypes: Record<string, EntityTypeDefinition>;
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null);

/** Provider placed in DOMLayer to feed Toolbar the props it needs */
export function ToolbarProvider({
  entityTypes,
  onEntitiesChange,
  children,
}: ToolbarContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ entityTypes, onEntitiesChange }), [entityTypes, onEntitiesChange]);
  return <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>;
}

function useToolbarContext() {
  const ctx = useContext(ToolbarContext);
  if (!ctx) throw new Error('Toolbar must be used inside <KookieFlow>');
  return ctx;
}

// ============================================================================
// Built-in toolbar widget registry
// ============================================================================

/** Built-in defaults per built-in entity type */
const BUILTIN_DEFAULTS: Record<string, ToolbarWidget[]> = {
  draw: ['strokeColor', 'strokeWidth'],
  text: [
    'sizingMode',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'textColor',
    'textAlign',
    'lineHeight',
    'letterSpacing',
  ],
  image: ['objectFit', 'aspectLock'],
  // A hue, not two colour wells: one choice that tints fill, edge and text together and follows the theme.
  comment: ['noteColor', 'fontSize'],
};

// ============================================================================
// Toolbar component
// ============================================================================

/** Gap between toolbar and entity edge (in screen pixels) */
const TOOLBAR_GAP = 8;

const toolbarContainerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  pointerEvents: 'auto',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  transform: 'translate3d(0, 0, 0)',
  zIndex: 50,
};

export interface ToolbarProps {
  /**
   * The size every control in the toolbar takes, unless a control states its own. Default: '3' —
   * v2's own band step, one above an app's rest, because a floating row holds mostly icon-only
   * controls that a pointer has to find over the canvas.
   */
  size?: KuiToolbarProps['size'];
  /** Override toolbar content entirely (ignores entityTypes toolbar config) */
  children?: ToolbarRenderFn;
}

export function Toolbar({ size = '3', children: renderOverride }: ToolbarProps) {
  const store = useFlowStoreApi();
  const { entityTypes, onEntitiesChange } = useToolbarContext();
  const socketLayout = useSocketLayout();

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  // Cached container parent size for collision detection
  const cachedParentSize = useRef({ width: 0, height: 0 });

  // Track selected entities for React rendering (toolbar content changes)
  const [selectedEntities, setSelectedEntities] = useState<Entity[]>([]);
  // Track whether toolbar should be visible (interaction mode)
  const [visible, setVisible] = useState(false);

  // Stable update helper for toolbar render props (single entity)
  const update = useCallback(
    (entityId: string, data: Partial<EntityData>) => {
      onEntitiesChange?.([{ type: 'data', id: entityId, data: data as EntityData }]);
    },
    [onEntitiesChange]
  );

  // Batch update helper — updates ALL selected entities in one onEntitiesChange call
  const batchUpdate = useCallback(
    (data: Partial<EntityData>) => {
      const { selectedEntityIds } = store.getState();
      if (selectedEntityIds.size === 0) return;
      onEntitiesChange?.(
        Array.from(selectedEntityIds, (id) => ({
          type: 'data' as const,
          id,
          data: data as EntityData,
        }))
      );
    },
    [store, onEntitiesChange]
  );

  // Align and distribute move the selection in the store and report the moves the way a drag does.
  const reportPositions = useCallback(
    (updates: Array<{ id: string; position: { x: number; y: number } }>) => {
      if (updates.length === 0) return;
      onEntitiesChange?.(
        updates.map((u) => ({ type: 'position' as const, id: u.id, position: u.position }))
      );
    },
    [onEntitiesChange]
  );
  const align = useCallback(
    (edge: AlignEdge) => reportPositions(store.getState().alignSelection(edge)),
    [store, reportPositions]
  );
  const distribute = useCallback(
    (axis: DistributeAxis) => reportPositions(store.getState().distributeSelection(axis)),
    [store, reportPositions]
  );

  // Compute selection bounding box in world space
  const getSelectionBounds = useCallback(() => {
    const { selectedEntityIds, entityMap } = store.getState();
    if (selectedEntityIds.size === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const id of selectedEntityIds) {
      const entity = entityMap.get(id);
      if (!entity) continue;
      const w = entity.width ?? DEFAULT_ENTITY_WIDTH;
      const layout = getEntitySocketLayout(entity, socketLayout);
      const h = entity.height ?? layout.computedHeight;
      minX = Math.min(minX, entity.position.x);
      minY = Math.min(minY, entity.position.y);
      maxX = Math.max(maxX, entity.position.x + w);
      maxY = Math.max(maxY, entity.position.y + h);
    }

    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [store, socketLayout]);

  // Position the toolbar element
  const updatePosition = useCallback(() => {
    pendingRef.current = false;
    const el = containerRef.current;
    if (!el) return;

    // Hide during interactions
    const mode = getInteractionMode();
    if (mode !== 'idle') {
      el.style.visibility = 'hidden';
      return;
    }

    const { selectedEntityIds, entityMap, viewport } = store.getState();
    if (selectedEntityIds.size === 0) {
      el.style.visibility = 'hidden';
      return;
    }

    // Whether ANY selected entity carries a toolbar config is the whole question here, and that is
    // what it asks now. It used to build the full array of those entities and read `.length` off
    // it. Every pan frame and every wheel tick writes the viewport, and the viewport subscription
    // lands in this function, so a selection of a thousand entities allocated a thousand-element
    // array and did a thousand map lookups per input event to answer a yes/no. A short-circuiting
    // predicate normally stops at the first entity and allocates nothing; a `children` override
    // skips the scan entirely, because it shows the toolbar whatever the answer would have been.
    if (
      !renderOverride &&
      !hasSelectedEntityWithToolbar(selectedEntityIds, entityMap, entityTypes)
    ) {
      el.style.visibility = 'hidden';
      return;
    }

    const bounds = getSelectionBounds();
    if (!bounds) {
      el.style.visibility = 'hidden';
      return;
    }

    // Convert world bounds to screen space
    const screenX = (bounds.x + bounds.width / 2) * viewport.zoom + viewport.x;
    const screenTopY = bounds.y * viewport.zoom + viewport.y;
    const screenBottomY = (bounds.y + bounds.height) * viewport.zoom + viewport.y;

    // Toolbar dimensions (measure from DOM)
    const toolbarWidth = el.offsetWidth;
    const toolbarHeight = el.offsetHeight;

    // Collision detection: prefer above, flip below if clipped
    const parentWidth = cachedParentSize.current.width;
    let posY = screenTopY - toolbarHeight - TOOLBAR_GAP;
    if (posY < 0) {
      // Flip below
      posY = screenBottomY + TOOLBAR_GAP;
    }

    // Horizontal: center on selection, clamp to viewport
    let posX = screenX - toolbarWidth / 2;
    if (posX < 4) posX = 4;
    if (posX + toolbarWidth > parentWidth - 4) posX = parentWidth - toolbarWidth - 4;

    el.style.visibility = 'visible';
    el.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;
  }, [store, entityTypes, getSelectionBounds, renderOverride]);

  // Schedule update via microtask
  const scheduleUpdate = useCallback(() => {
    if (!pendingRef.current) {
      pendingRef.current = true;
      queueMicrotask(updatePosition);
    }
  }, [updatePosition]);

  // Subscriptions
  useLayoutEffect(() => {
    updatePosition();

    // Selection changes → update React content + reposition
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      (selectedIds) => {
        const entities = getSelectedEntitiesFromIds(selectedIds, store.getState().entityMap);
        setSelectedEntities(entities);
        setVisible(entities.length > 0);
        scheduleUpdate();
      }
    );

    // Viewport changes → reposition
    const unsubViewport = store.subscribe(
      (state) => state.viewport,
      () => scheduleUpdate()
    );

    // Position changes → reposition
    const unsubPositions = store.subscribe(
      (state) => state.positionVersion,
      () => scheduleUpdate()
    );

    // Entity data changes → refresh toolbar widget values
    // Guarded by interaction mode: during drag/resize, entities array changes
    // on every position update but toolbar is hidden — skip to avoid wasteful re-renders
    const unsubEntities = store.subscribe(
      (state) => state.entities,
      () => {
        if (getInteractionMode() !== 'idle') return;
        const { selectedEntityIds, entityMap } = store.getState();
        if (selectedEntityIds.size > 0) {
          const entities = getSelectedEntitiesFromIds(selectedEntityIds, entityMap);
          setSelectedEntities(entities);
        }
        scheduleUpdate();
      }
    );

    // ResizeObserver for parent size
    const parent = containerRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;
    if (parent) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          cachedParentSize.current.width = entry.contentRect.width;
          cachedParentSize.current.height = entry.contentRect.height;
        }
        updatePosition();
      });
      resizeObserver.observe(parent);
    }

    // Interaction mode is a side-channel rather than store state, deliberately: it changes on
    // every pointermove of a drag, and a Zustand write would allocate a state object per frame.
    // This used to be polled with an unconditional rAF loop running forever; it notifies now.
    const unsubMode = observeInteractionMode(scheduleUpdate);

    return () => {
      unsubSelection();
      unsubViewport();
      unsubPositions();
      unsubEntities();
      unsubMode();
      resizeObserver?.disconnect();
    };
  }, [store, updatePosition, scheduleUpdate]);

  // Resolve toolbar content
  const toolbarContent = resolveToolbarContent(
    selectedEntities,
    entityTypes,
    renderOverride,
    update,
    batchUpdate,
    getSelectionBounds,
    onEntitiesChange,
    align,
    distribute
  );

  if (!visible || !toolbarContent) {
    return <div ref={containerRef} style={toolbarContainerStyle} data-kookie-flow-toolbar="" />;
  }

  return (
    <div
      ref={containerRef}
      style={toolbarContainerStyle}
      // Marks the toolbar so the harness can tell library CHROME from library LABELS. The law
      // "no label is a DOM element" sweeps for text-bearing leaf divs inside the flow container,
      // and the toolbar is full of them by design — it is real DOM chrome, which is the one thing
      // the GL-only rule explicitly keeps in the DOM.
      data-kookie-flow-toolbar=""
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/*
        NO CARD. Every control here is glass, and glass holds on any ground — so the canvas is the
        toolbar's background, and each control or group draws its own capsule, as a v2 toolbar
        does. A card around them was a second surface under the first, and the dividers it needed
        were the cost of that. `backdrop` tells every glass-capable control in the row that the
        canvas passes behind it, once, instead of on each one.
      */}
      <KuiToolbar size={size} backdrop aria-label="Selection">
        {toolbarContent}
      </KuiToolbar>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getSelectedEntitiesFromIds(ids: Set<string>, entityMap: Map<string, Entity>): Entity[] {
  const result: Entity[] = [];
  for (const id of ids) {
    const entity = entityMap.get(id);
    if (entity) result.push(entity);
  }
  return result;
}

/**
 * Does the selection contain at least one entity whose type declares a toolbar?
 *
 * Runs on every viewport write, so it returns on the first match and never builds a list. Its
 * callers only ever asked the yes/no.
 */
export function hasSelectedEntityWithToolbar(
  selectedEntityIds: Set<string>,
  entityMap: Map<string, Entity>,
  entityTypes: Record<string, EntityTypeDefinition>
): boolean {
  for (const id of selectedEntityIds) {
    const entity = entityMap.get(id);
    if (!entity) continue;
    const typeDef = entityTypes[entity.type];
    if (typeDef?.toolbar != null && typeDef.toolbar !== false) return true;
  }
  return false;
}

function resolveToolbarContent(
  entities: Entity[],
  entityTypes: Record<string, EntityTypeDefinition>,
  renderOverride: ToolbarRenderFn | undefined,
  update: (entityId: string, data: Partial<EntityData>) => void,
  batchUpdate: (data: Partial<EntityData>) => void,
  getSelectionBounds: () => { x: number; y: number; width: number; height: number } | null,
  onEntitiesChange: ((changes: EntityChange[]) => void) | undefined,
  align: (edge: AlignEdge) => void,
  distribute: (axis: DistributeAxis) => void
): ReactNode {
  if (entities.length === 0) return null;

  const bounds = getSelectionBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  const renderProps: ToolbarRenderProps = { entities, update, bounds, align, distribute };

  // Full override from children prop
  if (renderOverride) {
    return renderOverride(renderProps);
  }

  // Resolve from entity type config
  const types = new Set(entities.map((e) => e.type));
  if (types.size !== 1) return null;

  const entityType = entities[0].type;
  const typeDef = entityTypes[entityType];
  if (typeDef?.toolbar == null || typeDef.toolbar === false) return null;

  const config: ToolbarConfig = typeDef.toolbar;

  // Full render function override
  if (typeof config === 'function') {
    return config(renderProps);
  }

  // Resolve defaults + extra
  let defaultWidgets: ToolbarWidget[] = [];
  let extraFn: ToolbarRenderFn | undefined;

  if (config === true) {
    defaultWidgets = BUILTIN_DEFAULTS[entityType] ?? [];
  } else if (Array.isArray(config)) {
    defaultWidgets = config;
  } else if (typeof config === 'object') {
    if (config.defaults === true) {
      defaultWidgets = BUILTIN_DEFAULTS[entityType] ?? [];
    } else if (Array.isArray(config.defaults)) {
      defaultWidgets = config.defaults;
    }
    extraFn = config.extra;
  }

  if (defaultWidgets.length === 0 && !extraFn) return null;

  // Straight into the row: the row spaces its children, and each child is its own capsule.
  return (
    <>
      {defaultWidgets.map((widget) => (
        <BuiltInWidget
          key={widget}
          widget={widget}
          entities={entities}
          batchUpdate={batchUpdate}
          onEntitiesChange={onEntitiesChange}
          align={align}
          distribute={distribute}
        />
      ))}
      {extraFn?.(renderProps)}
    </>
  );
}

// ============================================================================
// Inline SVG icons (HugeIcons text-align, stroke-rounded)
// ============================================================================

const iconProps = {
  // Decorative: every consumer of these sits inside a control that now carries its own aria-label,
  // and an unnamed <svg> in the accessibility tree is noise at best. This one line retires all six.
  'aria-hidden': true,
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  /**
   * The design system's own stroke, not a number of ours.
   *
   * A stroke is stated in VIEWBOX units, so the painted weight is `stroke x box / viewBox` — and
   * these glyphs are drawn on the same 24 grid `iconGrid` names. At the hardcoded 1.5 they painted
   * lighter than every glyph beside them in a v2 app, which is exactly the mismatch v2 exports
   * `iconStroke` to prevent: it ships no icon set, so a consumer's glyphs and the library's have
   * to be reconciled from the consumer's side or not at all.
   *
   * `width`/`height` stay for the same reason they always applied: inside a `.kui-control` the
   * shared icon-box rule sizes the glyph from the size index, and outside one these are the box.
   */
  strokeWidth: iconStroke,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function AlignEdgeLeftIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3V21" />
      <rect x="7" y="6" width="12" height="4" rx="1" />
      <rect x="7" y="14" width="8" height="4" rx="1" />
    </svg>
  );
}

function AlignEdgeCenterIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3V21" />
      <rect x="5" y="6" width="14" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="4" rx="1" />
    </svg>
  );
}

function AlignEdgeRightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 3V21" />
      <rect x="5" y="6" width="12" height="4" rx="1" />
      <rect x="9" y="14" width="8" height="4" rx="1" />
    </svg>
  );
}

function AlignEdgeTopIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3H21" />
      <rect x="6" y="7" width="4" height="12" rx="1" />
      <rect x="14" y="7" width="4" height="8" rx="1" />
    </svg>
  );
}

function AlignEdgeMiddleIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 12H21" />
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="8" width="4" height="8" rx="1" />
    </svg>
  );
}

function AlignEdgeBottomIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 21H21" />
      <rect x="6" y="5" width="4" height="12" rx="1" />
      <rect x="14" y="9" width="4" height="8" rx="1" />
    </svg>
  );
}

function DistributeHorizontalIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3V21" />
      <path d="M21 3V21" />
      <rect x="9" y="7" width="6" height="10" rx="1" />
    </svg>
  );
}

function DistributeVerticalIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3H21" />
      <path d="M3 21H21" />
      <rect x="7" y="9" width="10" height="6" rx="1" />
    </svg>
  );
}

function AlignLeftIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3H21" />
      <path d="M3 9H11" />
      <path d="M3 15H21" />
      <path d="M3 21H11" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3H21" />
      <path d="M8 9H16" />
      <path d="M3 15H21" />
      <path d="M8 21H16" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 3H21" />
      <path d="M13 9H21" />
      <path d="M3 15H21" />
      <path d="M13 21H21" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.4-2" />
    </svg>
  );
}

function AutoWidthIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7H21" />
      <path d="M3 12H15" />
      <path d="M1 4V20" strokeDasharray="2 2" />
    </svg>
  );
}

function AutoHeightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7H21" />
      <path d="M3 12H21" />
      <path d="M3 17H11" />
      <path d="M21 4V20" />
    </svg>
  );
}

function FixedSizeIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" strokeDasharray="3 2" />
      <path d="M7 9H17" />
      <path d="M7 13H13" />
    </svg>
  );
}

// ============================================================================
// Built-in toolbar widgets (Kookie UI components)
// ============================================================================

/** Number input with local state buffer — commits on blur or Enter */
function ToolbarNumberInput({
  label,
  value,
  onChange,
  // 64, not 52: at the toolbar's size 3 the field's own padding left 52 too narrow for "1.4".
  width = 64,
}: {
  /** Accessible name — these inputs carry no visible <label>. */
  label: string;
  value: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  const [local, setLocal] = useState(() => String(value));

  // Sync from prop when value changes externally
  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const v = parseFloat(local);
    if (!isNaN(v) && v !== value) {
      onChange(v);
    } else {
      // Reset to prop value if invalid
      setLocal(String(value));
    }
  }, [local, value, onChange]);

  return (
    <TextField
      aria-label={label}
      backdrop
      inputMode="decimal"
      value={local}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commit();
        }
      }}
      style={{ width }}
    />
  );
}

/**
 * The native colour well draws its own square swatch inside its own padding and border, and both
 * are pseudo-elements an inline style cannot reach — so the one rule that makes the swatch a round
 * mark filling the input is injected once, keyed on an attribute, the way the widget edit overlay
 * hides a number input's spinner. Without it the well was a hard 24px square sitting on top of the
 * capsule it is meant to stand in.
 */
const SWATCH_ATTR = 'data-kookie-flow-swatch';
const SWATCH_STYLE_ID = 'kookie-flow-swatch-style';
const SWATCH_CSS = `
[${SWATCH_ATTR}]::-webkit-color-swatch-wrapper { padding: 0; }
[${SWATCH_ATTR}]::-webkit-color-swatch { border: none; border-radius: 999px; }
[${SWATCH_ATTR}]::-moz-color-swatch { border: none; border-radius: 999px; }
`;

function useSwatchStylesheet(): void {
  useInsertionEffect(() => {
    if (document.getElementById(SWATCH_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SWATCH_STYLE_ID;
    style.textContent = SWATCH_CSS;
    document.head.appendChild(style);
  }, []);
}

/** Color input that throttles updates to avoid rapid-fire entity changes */
function ToolbarColorInput({
  label,
  value,
  onChange,
}: {
  /** Accessible name — this input carries no visible <label>. */
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const pendingRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  useSwatchStylesheet();

  const flush = useCallback(() => {
    rafRef.current = 0;
    if (pendingRef.current !== null) {
      onChange(pendingRef.current);
      pendingRef.current = null;
    }
  }, [onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      pendingRef.current = e.target.value;
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush]
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // In a group of its own: a bare swatch has no capsule, and on glass every control stands on one.
  return (
    <ToolbarGroup backdrop>
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={handleChange}
        {...{ [SWATCH_ATTR]: '' }}
        style={{
          // A round mark inside its capsule, as an icon sits inside an icon button's. Round
          // whatever the radius level, because the capsule around it is: a square swatch in a
          // pill reads as a second shape stacked on the first.
          // Centred on its own: a group stretches its children to its hosted height, and a 20px
          // swatch under `stretch` pins to the top. The side margins are read off that same hosted
          // height, so the capsule is a square as tall as the row at every size — the shape an
          // icon button's capsule has.
          display: 'block',
          alignSelf: 'center',
          width: 20,
          height: 20,
          margin: '0 calc((var(--kui-ct-hosted-height, 28px) - 20px) / 2)',
          border: 'none',
          borderRadius: 999,
          padding: 0,
          cursor: 'pointer',
          background: 'none',
        }}
      />
    </ToolbarGroup>
  );
}

/**
 * A Select resolves the text on its CLOSED trigger from this map and from nothing else — never
 * from the row that was picked — so a select whose labels differ from its values needs one, or
 * the trigger paints the raw value ("400", "system-ui") for as long as it is closed.
 */
const FONT_WEIGHT_LABELS: Record<string, ReactNode> = {
  '400': 'Regular',
  '600': 'Semibold',
  '700': 'Bold',
};

const FONT_FAMILY_LABELS: Record<string, ReactNode> = {
  'system-ui': 'System',
  serif: 'Serif',
  monospace: 'Mono',
};

/** A dot in a note hue, drawn from the same ink the note is — so the choice looks like the result. */
function NoteSwatch({ hue }: { hue: string }) {
  const ink = noteInk(hue);
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 999,
        background: ink.fill,
        boxShadow: `inset 0 0 0 1px ${ink.edge}`,
        marginInlineEnd: 6,
        verticalAlign: '-1px',
      }}
    />
  );
}

/** Built once: each hue's label, swatch first, for both the trigger and the list. */
const NOTE_HUE_LABELS: Record<string, ReactNode> = Object.fromEntries(
  NOTE_HUES.map(({ hue, label }) => [
    hue,
    <>
      <NoteSwatch hue={hue} />
      {label}
    </>,
  ])
);

/**
 * The colour a note is actually painted in, as #rrggbb for a colour well.
 *
 * A note's own colours are color-mix() strings the browser resolves against the theme, and a native
 * colour input takes nothing but #rrggbb — so the well asks the painted element. Read on render,
 * which is a selection change, never a frame.
 */
function renderedNoteColour(
  entityId: string,
  property: 'backgroundColor' | 'color'
): string | null {
  if (typeof document === 'undefined') return null;
  let painted: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(
    `[data-entity-id="${CSS.escape(entityId)}"]`
  )) {
    // The note's own div is the one its paint path stamps; other layers carry the id too.
    if (el.dataset.bg !== undefined) {
      painted = el;
      break;
    }
  }
  if (!painted) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = getComputedStyle(painted)[property];
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function BuiltInWidget({
  widget,
  entities,
  batchUpdate,
  onEntitiesChange,
  align,
  distribute,
}: {
  widget: ToolbarWidget;
  entities: Entity[];
  batchUpdate: (data: Partial<EntityData>) => void;
  onEntitiesChange?: (changes: EntityChange[]) => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
}) {
  // Display values from first entity; updates apply to all selected
  const data = entities[0].data as Record<string, unknown>;

  // Font context for sizing mode transitions (dimension recalculation)
  const fontContext = useFont();
  // Ink with no colour of its own is drawn in the theme's text colour, so that is what its swatch shows.
  const tokens = useTheme();
  const inkDefault = rgbToHex(tokens[THEME_COLORS.text.primary]);

  let content: ReactNode;

  switch (widget) {
    case 'sizingMode': {
      const currentMode = (data.sizingMode as string) ?? 'auto-height';
      content = (
        <SegmentedControl
          backdrop
          aria-label="Sizing mode"
          value={currentMode}
          onValueChange={(newMode: unknown) => {
            if (!onEntitiesChange) return;
            const mode = String(newMode) as TextSizingMode;
            const changes: EntityChange[] = [];

            for (const entity of entities) {
              if (entity.type !== 'text') continue;
              const entData = entity.data as TextEntityData;
              if ((entData.sizingMode ?? 'auto-height') === mode) continue;

              const w = entity.width ?? DEFAULT_TEXT_WIDTH;
              const h = entity.height ?? DEFAULT_TEXT_HEIGHT;
              const style = resolveTextStyle(entData);
              const font = resolveFontForWeight(fontContext, entData.fontWeight ?? 400);

              let newW = w;
              let newH = h;

              if (mode === 'auto-width' && font && font.glyphMap.size > 0) {
                const size = calculateTextAutoSizeMSDF(
                  entData.content,
                  style,
                  font.metrics.info.size,
                  font.glyphMap,
                  font.kerningMap
                );
                newW = size.width;
                newH = size.height;
              } else if (mode === 'auto-height' && font && font.glyphMap.size > 0) {
                newH = calculateTextAutoHeightMSDF(
                  entData.content,
                  style,
                  w,
                  font.metrics.info.size,
                  font.glyphMap,
                  font.kerningMap
                );
              }
              // fixed: freeze current dimensions

              changes.push({
                type: 'data',
                id: entity.id,
                data: { ...entData, sizingMode: mode } as EntityData,
              });
              changes.push({
                type: 'dimensions',
                id: entity.id,
                dimensions: { width: newW, height: newH },
              });
            }

            if (changes.length > 0) onEntitiesChange(changes);
          }}
        >
          <SegmentedItem value="auto-width" aria-label="Auto width">
            <AutoWidthIcon />
          </SegmentedItem>
          <SegmentedItem value="auto-height" aria-label="Auto height">
            <AutoHeightIcon />
          </SegmentedItem>
          <SegmentedItem value="fixed" aria-label="Fixed size">
            <FixedSizeIcon />
          </SegmentedItem>
        </SegmentedControl>
      );
      break;
    }

    case 'fontSize':
      content = (
        <ToolbarNumberInput
          label="Font size"
          value={(data.fontSize as number) ?? 16}
          onChange={(v) => batchUpdate({ fontSize: v })}
        />
      );
      break;

    case 'lineHeight':
      content = (
        <ToolbarNumberInput
          label="Line height"
          value={(data.lineHeight as number) ?? 1.5}
          onChange={(v) => batchUpdate({ lineHeight: v })}
        />
      );
      break;

    case 'letterSpacing':
      content = (
        <ToolbarNumberInput
          label="Letter spacing"
          value={(data.letterSpacing as number) ?? 0}
          onChange={(v) => batchUpdate({ letterSpacing: v })}
        />
      );
      break;

    case 'fontWeight':
      content = (
        <Select
          items={FONT_WEIGHT_LABELS}
          value={String((data.fontWeight as number) ?? 400)}
          onValueChange={(v) => {
            // null is a real argument: Base UI clears the value when the mounted option set
            // changes, and Number(null) is 0 — a font weight of zero, written silently.
            if (v === null) return;
            batchUpdate({ fontWeight: Number(v) });
          }}
        >
          <SelectTrigger backdrop aria-label="Font weight" />
          <SelectContent>
            <SelectItem value="400">Regular</SelectItem>
            <SelectItem value="600">Semibold</SelectItem>
            <SelectItem value="700">Bold</SelectItem>
          </SelectContent>
        </Select>
      );
      break;

    case 'textAlign':
      content = (
        <SegmentedControl
          backdrop
          aria-label="Text alignment"
          value={(data.textAlign as string) ?? 'left'}
          onValueChange={(v: unknown) => batchUpdate({ textAlign: String(v) })}
        >
          <SegmentedItem value="left" aria-label="Align left">
            <AlignLeftIcon />
          </SegmentedItem>
          <SegmentedItem value="center" aria-label="Align centre">
            <AlignCenterIcon />
          </SegmentedItem>
          <SegmentedItem value="right" aria-label="Align right">
            <AlignRightIcon />
          </SegmentedItem>
        </SegmentedControl>
      );
      break;

    case 'fontFamily':
      content = (
        <Select
          items={FONT_FAMILY_LABELS}
          value={(data.fontFamily as string) ?? 'system-ui'}
          onValueChange={(v) => {
            if (v === null) return;
            batchUpdate({ fontFamily: v });
          }}
        >
          <SelectTrigger backdrop aria-label="Font family" />
          <SelectContent>
            <SelectItem value="system-ui">System</SelectItem>
            <SelectItem value="serif">Serif</SelectItem>
            <SelectItem value="monospace">Mono</SelectItem>
          </SelectContent>
        </Select>
      );
      break;

    case 'textColor':
      content = (
        <ToolbarColorInput
          label="Text colour"
          value={
            (data.textColor as string) ||
            // A note's text is tinted from its hue, so its well starts from what is on screen.
            (entities[0].type === 'comment' ? renderedNoteColour(entities[0].id, 'color') : null) ||
            '#ffffff'
          }
          onChange={(v) => batchUpdate({ textColor: v })}
        />
      );
      break;

    case 'noteColor': {
      const hue = noteHue(data.color as string | undefined, entities[0].color);
      content = (
        <Select
          items={NOTE_HUE_LABELS}
          value={hue}
          onValueChange={(v) => {
            if (v === null) return;
            // A hue clears one-off colours: otherwise a note given a fill of its own would take the
            // pick and show no change at all.
            batchUpdate({ color: v, backgroundColor: undefined, textColor: undefined });
          }}
        >
          <SelectTrigger backdrop aria-label="Note colour" />
          <SelectContent>
            {NOTE_HUES.map(({ hue: option }) => (
              <SelectItem key={option} value={option}>
                {NOTE_HUE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }

    /**
     * A fill of the note's own. It was in the comment defaults and drew nothing — the switch had no
     * case for it — so a consumer who listed it got a toolbar missing the control they asked for.
     */
    case 'backgroundColor':
      content = (
        <ToolbarColorInput
          label="Fill colour"
          value={
            (data.backgroundColor as string) ||
            (entities[0].type === 'comment'
              ? renderedNoteColour(entities[0].id, 'backgroundColor')
              : null) ||
            '#ffffff'
          }
          onChange={(v) => batchUpdate({ backgroundColor: v })}
        />
      );
      break;

    case 'objectFit':
      content = (
        <SegmentedControl
          backdrop
          aria-label="Object fit"
          value={(data.objectFit as string) ?? 'fill'}
          onValueChange={(v: unknown) => batchUpdate({ objectFit: String(v) })}
        >
          <SegmentedItem value="fill">Fill</SegmentedItem>
          <SegmentedItem value="cover">Cover</SegmentedItem>
          <SegmentedItem value="contain">Contain</SegmentedItem>
        </SegmentedControl>
      );
      break;

    case 'aspectLock': {
      const locked = (data.aspectLocked as boolean) ?? true;
      content = (
        // A ToolbarButton carrying its own pressed state, not a Toggle: a Toggle does not enrol in
        // the toolbar's keyboard, so it was a second tab stop the arrow keys never reached.
        <ToolbarGroup backdrop>
          <ToolbarButton
            iconOnly
            aria-pressed={locked}
            onClick={() => batchUpdate({ aspectLocked: !locked })}
            aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            {locked ? <LockIcon /> : <UnlockIcon />}
          </ToolbarButton>
        </ToolbarGroup>
      );
      break;
    }

    case 'strokeColor':
      content = (
        <ToolbarColorInput
          label="Stroke colour"
          value={(data.strokeColor as string) || inkDefault}
          onChange={(v) => batchUpdate({ strokeColor: v })}
        />
      );
      break;

    case 'strokeWidth':
      content = (
        <ToolbarNumberInput
          label="Stroke width"
          value={(data.strokeWidth as number) ?? DEFAULT_STROKE_WIDTH}
          onChange={(v) => {
            if (!onEntitiesChange || !(v > 0)) return;
            const changes: EntityChange[] = [];
            for (const entity of entities) {
              if (entity.type !== 'draw') continue;
              const ink = entity.data as DrawEntityData;
              const was = ink.strokeWidth ?? DEFAULT_STROKE_WIDTH;
              if (was === v) continue;
              // A width is a box and a shift as well: see `restroke`.
              const next = restroke(entity.position, ink.points ?? [], was, v);
              changes.push(
                { type: 'position', id: entity.id, position: next.position },
                {
                  type: 'dimensions',
                  id: entity.id,
                  dimensions: { width: next.width, height: next.height },
                },
                { type: 'data', id: entity.id, data: { strokeWidth: v, points: next.points } }
              );
            }
            if (changes.length > 0) onEntitiesChange(changes);
          }}
        />
      );
      break;

    case 'arrange': {
      // One entity has nothing to line up with, and two have one gap, already even.
      if (entities.length < 2) return null;
      const edges: Array<[AlignEdge, string, ReactNode]> = [
        ['left', 'Align left edges', <AlignEdgeLeftIcon key="l" />],
        ['center', 'Align horizontal centres', <AlignEdgeCenterIcon key="c" />],
        ['right', 'Align right edges', <AlignEdgeRightIcon key="r" />],
        ['top', 'Align top edges', <AlignEdgeTopIcon key="t" />],
        ['middle', 'Align vertical centres', <AlignEdgeMiddleIcon key="m" />],
        ['bottom', 'Align bottom edges', <AlignEdgeBottomIcon key="b" />],
      ];
      // Two groups, because they are two meanings: lining edges up, and spacing things out.
      content = (
        <>
          <ToolbarGroup backdrop>
            {edges.map(([edge, label, icon]) => (
              <ToolbarButton key={edge} iconOnly aria-label={label} onClick={() => align(edge)}>
                {icon}
              </ToolbarButton>
            ))}
          </ToolbarGroup>
          {entities.length >= 3 && (
            <ToolbarGroup backdrop>
              <ToolbarButton
                iconOnly
                aria-label="Distribute horizontally"
                onClick={() => distribute('horizontal')}
              >
                <DistributeHorizontalIcon />
              </ToolbarButton>
              <ToolbarButton
                iconOnly
                aria-label="Distribute vertically"
                onClick={() => distribute('vertical')}
              >
                <DistributeVerticalIcon />
              </ToolbarButton>
            </ToolbarGroup>
          )}
        </>
      );
      break;
    }

    default:
      return null;
  }

  return <>{content}</>;
}
