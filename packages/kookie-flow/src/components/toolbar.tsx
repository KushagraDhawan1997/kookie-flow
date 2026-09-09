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
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Card,
  Flex,
  TextField,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SegmentedControl,
  SegmentedItem,
  Separator,
  Toggle,
  iconStroke,
} from '@kookie-ui/react';
import type { CardProps } from '@kookie-ui/react';
import { useFlowStoreApi } from './context';
import { getInteractionMode, observeInteractionMode } from './interaction-state';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_ENTITY_WIDTH } from '../core/constants';
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
  ToolbarWidget,
} from '../types';
import { useFont, resolveFontForWeight } from '../contexts/FontContext';
import {
  resolveTextStyle,
  calculateTextAutoHeightMSDF,
  calculateTextAutoSizeMSDF,
} from '../utils/text-texture';
import { DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT } from '../core/constants';

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
  return (
    <ToolbarContext.Provider value={value}>
      {children}
    </ToolbarContext.Provider>
  );
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
  comment: ['backgroundColor', 'textColor', 'fontSize'],
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
  /** Card props passed to the Kookie UI Card wrapper */
  cardProps?: Omit<CardProps, 'children'>;
  /** Override toolbar content entirely (ignores entityTypes toolbar config) */
  children?: ToolbarRenderFn;
}

export function Toolbar({ cardProps, children: renderOverride }: ToolbarProps) {
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

    const { selectedEntityIds, viewport } = store.getState();
    if (selectedEntityIds.size === 0) {
      el.style.visibility = 'hidden';
      return;
    }

    // Check if any selected entity has a toolbar config
    const entities = getSelectedEntitiesWithToolbar(store.getState(), entityTypes);
    if (entities.length === 0 && !renderOverride) {
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
    onEntitiesChange
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
      <Card size="1" {...cardProps}>
        {toolbarContent}
      </Card>
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

function getSelectedEntitiesWithToolbar(
  state: { selectedEntityIds: Set<string>; entityMap: Map<string, Entity> },
  entityTypes: Record<string, EntityTypeDefinition>
): Entity[] {
  const result: Entity[] = [];
  for (const id of state.selectedEntityIds) {
    const entity = state.entityMap.get(id);
    if (!entity) continue;
    const typeDef = entityTypes[entity.type];
    if (typeDef?.toolbar != null && typeDef.toolbar !== false) {
      result.push(entity);
    }
  }
  return result;
}

/**
 * The toolbar's vertical tick.
 *
 * A Separator takes its length from whatever contains it, and a vertical one stretches to the
 * full height of the row it sits in — the whole toolbar. The 16px box is what the old `size="1"`
 * meant, stated in the one place it can now be stated.
 */
function ToolbarDivider() {
  return (
    <Flex height="16px">
      <Separator orientation="vertical" />
    </Flex>
  );
}

function resolveToolbarContent(
  entities: Entity[],
  entityTypes: Record<string, EntityTypeDefinition>,
  renderOverride: ToolbarRenderFn | undefined,
  update: (entityId: string, data: Partial<EntityData>) => void,
  batchUpdate: (data: Partial<EntityData>) => void,
  getSelectionBounds: () => { x: number; y: number; width: number; height: number } | null,
  onEntitiesChange?: (changes: EntityChange[]) => void
): ReactNode {
  if (entities.length === 0) return null;

  const bounds = getSelectionBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  const renderProps: ToolbarRenderProps = { entities, update, bounds };

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

  return (
    <Flex align="center" gap="3">
      {defaultWidgets.map((widget, i) => (
        <BuiltInWidget
          key={widget}
          widget={widget}
          entities={entities}
          batchUpdate={batchUpdate}
          onEntitiesChange={onEntitiesChange}
          showSeparator={i > 0}
        />
      ))}
      {extraFn && (
        <>
          {defaultWidgets.length > 0 && <ToolbarDivider />}
          {extraFn(renderProps)}
        </>
      )}
    </Flex>
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
  width = 52,
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
      size="2"
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

  return (
    <input
      aria-label={label}
      type="color"
      value={value}
      onChange={handleChange}
      style={{
        width: 24,
        height: 24,
        border: 'none',
        // The MARK band, not the raw palette. `--radius-1` survived the v1 -> v2 rename by name
        // and lost its meaning with it: in v1 it was a flat 6px, in v2 it is a palette index the
        // radius axis re-authors per level, and at the default level (`full`) it resolves to
        // 9999px — this 24x24 swatch would have rendered as a circle, and as a hard square under
        // `radius="none"`. A colour well is a square control that IS its own mark, so it belongs
        // on the band the mark family already designed for boxes that are not on the height
        // ladder: it answers the radius axis (0/2/4/6), caps at 6px rather than rounding away,
        // and lands on v1's rendered corner exactly at the default.
        borderRadius: 'var(--radius-mark-2)',
        padding: 0,
        cursor: 'pointer',
        background: 'none',
      }}
    />
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

function BuiltInWidget({
  widget,
  entities,
  batchUpdate,
  onEntitiesChange,
  showSeparator,
}: {
  widget: ToolbarWidget;
  entities: Entity[];
  batchUpdate: (data: Partial<EntityData>) => void;
  onEntitiesChange?: (changes: EntityChange[]) => void;
  showSeparator: boolean;
}) {
  // Display values from first entity; updates apply to all selected
  const data = entities[0].data as Record<string, unknown>;

  // Font context for sizing mode transitions (dimension recalculation)
  const fontContext = useFont();

  let content: ReactNode;

  switch (widget) {
    case 'sizingMode': {
      const currentMode = (data.sizingMode as string) ?? 'auto-height';
      content = (
        <SegmentedControl
          size="2"
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
          size="2"
          items={FONT_WEIGHT_LABELS}
          value={String((data.fontWeight as number) ?? 400)}
          onValueChange={(v) => {
            // null is a real argument: Base UI clears the value when the mounted option set
            // changes, and Number(null) is 0 — a font weight of zero, written silently.
            if (v === null) return;
            batchUpdate({ fontWeight: Number(v) });
          }}
        >
          <SelectTrigger aria-label="Font weight" />
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
          size="2"
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
          size="2"
          items={FONT_FAMILY_LABELS}
          value={(data.fontFamily as string) ?? 'system-ui'}
          onValueChange={(v) => {
            if (v === null) return;
            batchUpdate({ fontFamily: v });
          }}
        >
          <SelectTrigger aria-label="Font family" />
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
          value={(data.textColor as string) || '#ffffff'}
          onChange={(v) => batchUpdate({ textColor: v })}
        />
      );
      break;

    case 'objectFit':
      content = (
        <SegmentedControl
          size="2"
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
        <Toggle
          size="2"
          iconOnly
          pressed={locked}
          onPressedChange={(v: boolean) => batchUpdate({ aspectLocked: v })}
          aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        >
          {locked ? <LockIcon /> : <UnlockIcon />}
        </Toggle>
      );
      break;
    }

    default:
      return null;
  }

  return (
    <>
      {showSeparator && <ToolbarDivider />}
      {content}
    </>
  );
}
