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
  SegmentedControl,
  Separator,
} from '@kushagradhawan/kookie-ui';
import type { CardProps } from '@kushagradhawan/kookie-ui';
import { useFlowStoreApi } from './context';
import { getInteractionMode } from './interaction-state';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { useSocketLayout } from '../contexts/StyleContext';
import { DEFAULT_ENTITY_WIDTH } from '../core/constants';
import type {
  Entity,
  EntityData,
  EntityTypeDefinition,
  EntityChange,
  ToolbarConfig,
  ToolbarRenderFn,
  ToolbarRenderProps,
  ToolbarWidget,
} from '../types';

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
  return (
    <ToolbarContext.Provider value={{ entityTypes, onEntitiesChange }}>
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

  // Stable update helper for toolbar render props
  const update = useCallback(
    (entityId: string, data: Partial<EntityData>) => {
      onEntitiesChange?.([{ type: 'data', id: entityId, data: data as EntityData }]);
    },
    [onEntitiesChange]
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

    // Poll interaction mode since it's a side-channel (not in store)
    let rafId = 0;
    let lastMode = getInteractionMode();
    const checkMode = () => {
      const mode = getInteractionMode();
      if (mode !== lastMode) {
        lastMode = mode;
        scheduleUpdate();
      }
      rafId = requestAnimationFrame(checkMode);
    };
    rafId = requestAnimationFrame(checkMode);

    return () => {
      unsubSelection();
      unsubViewport();
      unsubPositions();
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [store, updatePosition, scheduleUpdate]);

  // Resolve toolbar content
  const toolbarContent = resolveToolbarContent(
    selectedEntities,
    entityTypes,
    renderOverride,
    update,
    getSelectionBounds
  );

  if (!visible || !toolbarContent) {
    return <div ref={containerRef} style={toolbarContainerStyle} />;
  }

  return (
    <div ref={containerRef} style={toolbarContainerStyle}>
      <Card size="1" variant="classic" {...cardProps}>
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

function resolveToolbarContent(
  entities: Entity[],
  entityTypes: Record<string, EntityTypeDefinition>,
  renderOverride: ToolbarRenderFn | undefined,
  update: (entityId: string, data: Partial<EntityData>) => void,
  getSelectionBounds: () => { x: number; y: number; width: number; height: number } | null
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
    <Flex align="center" gap="3" p="2">
      {defaultWidgets.map((widget, i) => (
        <BuiltInWidget
          key={widget}
          widget={widget}
          entity={entities[0]}
          update={update}
          showSeparator={i > 0}
        />
      ))}
      {extraFn && (
        <>
          {defaultWidgets.length > 0 && <Separator orientation="vertical" size="1" />}
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
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
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

// ============================================================================
// Built-in toolbar widgets (Kookie UI components)
// ============================================================================

function BuiltInWidget({
  widget,
  entity,
  update,
  showSeparator,
}: {
  widget: ToolbarWidget;
  entity: Entity;
  update: (entityId: string, data: Partial<EntityData>) => void;
  showSeparator: boolean;
}) {
  const data = entity.data as Record<string, unknown>;

  let content: ReactNode;

  switch (widget) {
    case 'fontSize':
      content = (
        <TextField.Root
          size="2"
          variant="soft"
          type="number"
          value={String((data.fontSize as number) ?? 16)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) update(entity.id, { fontSize: v });
          }}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          style={{ width: 52 }}
        />
      );
      break;

    case 'lineHeight':
      content = (
        <TextField.Root
          size="2"
          variant="soft"
          type="number"
          value={String((data.lineHeight as number) ?? 1.5)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) update(entity.id, { lineHeight: v });
          }}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          style={{ width: 52 }}
        />
      );
      break;

    case 'letterSpacing':
      content = (
        <TextField.Root
          size="2"
          variant="soft"
          type="number"
          value={String((data.letterSpacing as number) ?? 0)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) update(entity.id, { letterSpacing: v });
          }}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          style={{ width: 52 }}
        />
      );
      break;

    case 'fontWeight':
      content = (
        <Select.Root
          size="2"
          value={String((data.fontWeight as number) ?? 400)}
          onValueChange={(v: string) => update(entity.id, { fontWeight: Number(v) })}
        >
          <Select.Trigger
            variant="soft"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          />
          <Select.Content>
            <Select.Item value="400">Regular</Select.Item>
            <Select.Item value="600">Semibold</Select.Item>
            <Select.Item value="700">Bold</Select.Item>
          </Select.Content>
        </Select.Root>
      );
      break;

    case 'textAlign':
      content = (
        <SegmentedControl.Root
          size="2"
          value={(data.textAlign as string) ?? 'left'}
          onValueChange={(v: string) => update(entity.id, { textAlign: v })}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        >
          <SegmentedControl.Item value="left" iconOnly>
            <AlignLeftIcon />
          </SegmentedControl.Item>
          <SegmentedControl.Item value="center" iconOnly>
            <AlignCenterIcon />
          </SegmentedControl.Item>
          <SegmentedControl.Item value="right" iconOnly>
            <AlignRightIcon />
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      );
      break;

    case 'fontFamily':
      content = (
        <Select.Root
          size="2"
          value={(data.fontFamily as string) ?? 'system-ui'}
          onValueChange={(v: string) => update(entity.id, { fontFamily: v })}
        >
          <Select.Trigger
            variant="soft"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          />
          <Select.Content>
            <Select.Item value="system-ui">System</Select.Item>
            <Select.Item value="serif">Serif</Select.Item>
            <Select.Item value="monospace">Mono</Select.Item>
          </Select.Content>
        </Select.Root>
      );
      break;

    case 'textColor':
      content = (
        <input
          type="color"
          value={(data.textColor as string) || '#ffffff'}
          onChange={(e) => update(entity.id, { textColor: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            borderRadius: 'var(--radius-1)',
            padding: 0,
            cursor: 'pointer',
            background: 'none',
          }}
        />
      );
      break;

    default:
      return null;
  }

  return (
    <>
      {showSeparator && <Separator orientation="vertical" size="1" />}
      {content}
    </>
  );
}
