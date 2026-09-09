import {
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useFlowStoreApi } from './context';
import type { EntityTypeDefinition, Entity, CommentEntityData, EntityChange } from '../types';
import { TextEditOverlay } from './text-edit-overlay';
import { ToolbarProvider } from './toolbar';

const EMPTY_ENTITY_TYPES: Record<string, EntityTypeDefinition> = {};

/**
 * Below this zoom the comment layer hides entirely. Matches the minZoom default.
 * Labels used to share this threshold; they now render in GL and carry their own
 * (text-renderer.tsx: MIN_TEXT_ZOOM 0.15, MIN_SOCKET_ZOOM 0.35, MIN_EDGE_ZOOM 0.25).
 */
const MIN_ZOOM_FOR_LABELS = 0.1;

export interface DOMLayerProps {
  entityTypes?: Record<string, EntityTypeDefinition>;
  /** Show comment entities. Default: true */
  showComments?: boolean;
  /** Callback when entities change (for text editing) */
  onEntitiesChange?: (changes: EntityChange[]) => void;
  children?: ReactNode;
}

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
  entityTypes = EMPTY_ENTITY_TYPES,
  showComments = true,
  onEntitiesChange,
  children,
}: DOMLayerProps) {
  return (
    <div style={containerStyle}>
      {showComments && <CommentsContainer />}
      <TextEditOverlay onEntitiesChange={onEntitiesChange} />
      <ToolbarProvider entityTypes={entityTypes} onEntitiesChange={onEntitiesChange}>
        {children}
      </ToolbarProvider>
    </div>
  );
}

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

  /**
   * The ids behind `commentEntities`, for detecting a structural change by identity.
   *
   * Seeded from the SAME initializer as the state above. Seeded empty, the first entity publish
   * after mount would see a length mismatch and fire a setState that changes nothing — and if that
   * publish is a pointermove, that is a React commit during a drag, which is the one thing this
   * project's rules forbid outright.
   */
  const commentIdsRef = useRef<string[]>(
    store
      .getState()
      .entities.filter((n): n is Entity<CommentEntityData> => n.type === 'comment')
      .map((c) => c.id)
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

      // Content and presentation are written HERE, not in the JSX.
      //
      // The JSX rendered `{data.content}`, the background, the text colour and the font size, and
      // it only re-ran when the NUMBER of comments changed. Editing a comment's text through
      // `onEntitiesChange` — which is the only route a consumer has — left the div showing the
      // words it had at mount, for the life of the mount. Same for its colours and its size.
      //
      // It cannot be fixed by re-rendering more often: `entities.filter(...)` allocates a fresh
      // array on every store change and `updateEntityPositions` republishes `entities` on every
      // pointermove, so a reference compare would re-render once per drag frame. This path already
      // runs per frame, already allocates nothing, and already owns the transform.
      const data = entity.data as CommentEntityData;

      const content = data.content ?? '';
      if (el.textContent !== content) el.textContent = content;

      // The `dataset` shadow is load-bearing: `el.style.backgroundColor` serialises, so a token
      // written as '#FFF9C4' reads back as 'rgb(255, 249, 196)' and a guard comparing against the
      // raw value would never hold — writing the style every frame for every comment.
      const bg = data.backgroundColor ?? DEFAULT_COMMENT_BG;
      if (el.dataset.bg !== bg) {
        el.dataset.bg = bg;
        el.style.backgroundColor = bg;
      }
      const fg = data.textColor ?? DEFAULT_COMMENT_TEXT_COLOR;
      if (el.dataset.fg !== fg) {
        el.dataset.fg = fg;
        el.style.color = fg;
      }

      // Comments always scale text with zoom since they're visual canvas elements (not labels)
      const baseFontSize = data.fontSize ?? DEFAULT_COMMENT_FONT_SIZE;
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

    // Fine-grained subscriptions instead of bare store.subscribe
    // Entity count changes → re-render React for element creation/removal
    const unsubEntities = store.subscribe(
      (state) => state.entities,
      (entities) => {
        const currentComments = entities.filter(
          (n): n is Entity<CommentEntityData> => n.type === 'comment'
        );
        // Identity, not count. A remove-and-add in one batch keeps the count and changes which
        // comments exist, so a length compare leaves the new one mounted blank and unpositioned.
        const prev = commentIdsRef.current;
        let changed = currentComments.length !== prev.length;
        if (!changed) {
          for (let i = 0; i < currentComments.length; i++) {
            if (currentComments[i].id !== prev[i]) {
              changed = true;
              break;
            }
          }
        }
        if (changed) {
          commentIdsRef.current = currentComments.map((c) => c.id);
          setCommentEntities(currentComments);
        }
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

    // Selection changes → update selection border
    const unsubSelection = store.subscribe(
      (state) => state.selectedEntityIds,
      () => scheduleUpdate()
    );

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
      unsubEntities();
      unsubViewport();
      unsubPositions();
      unsubSelection();
      resizeObserver?.disconnect();
    };
    // `commentEntities` rather than `commentEntities.length`, and the dep is load-bearing rather
    // than cosmetic: `updateComments` is the only thing that paints a comment after React commits
    // it, and the subscription's own microtask runs BEFORE that commit. Without a dep that changes
    // on a swap, a replaced comment mounts hidden and blank and stays that way until an unrelated
    // pan, zoom or selection happens to repaint. Setting state only on an identity change is what
    // makes depending on the array itself cheap.
  }, [store, updateComments, scheduleUpdate, commentEntities]);

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
      {/*
        Structure only. Content, colours and font size are written by `updateComments`, which is
        the one owner of everything that can change without the set of comments changing. Two
        owners for one property is what produced the stale text: the JSX wrote it once and the
        imperative path, which runs every frame, did not know about it.
      */}
      {commentEntities.map((entity) => (
        <div
          key={entity.id}
          ref={setCommentRef(entity.id)}
          data-entity-id={entity.id}
          style={commentStyle}
        />
      ))}
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
