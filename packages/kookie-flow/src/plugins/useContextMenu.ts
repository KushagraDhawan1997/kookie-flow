import { useState, useCallback, useEffect, useRef } from 'react';
import type { Node, Edge, XYPosition } from '../types';

export type ContextMenuTarget =
  | { type: 'node'; node: Node }
  | { type: 'edge'; edge: Edge }
  | { type: 'pane' }
  | { type: 'selection'; nodeIds: string[]; edgeIds: string[] };

export interface ContextMenuState {
  /** The target that was right-clicked */
  target: ContextMenuTarget;
  /** Screen position for menu placement */
  position: XYPosition;
  /** World position of the click */
  worldPosition: XYPosition;
}

export interface UseContextMenuOptions {
  /** Long-press duration in ms for touch devices. Default: 500 */
  longPressDuration?: number;
  /** Whether context menu is enabled. Default: true */
  enabled?: boolean;
}

export interface UseContextMenuReturn {
  /** Current context menu state, or null if closed */
  contextMenu: ContextMenuState | null;
  /** Close the context menu */
  closeMenu: () => void;
  /** Open context menu programmatically */
  openMenu: (state: ContextMenuState) => void;
  /** Handler for contextmenu event - attach to your container */
  onContextMenu: (
    event: React.MouseEvent,
    target: ContextMenuTarget,
    worldPosition: XYPosition
  ) => void;
  /** Props for long-press detection on touch devices */
  longPressProps: {
    onTouchStart: (
      event: React.TouchEvent,
      target: ContextMenuTarget,
      worldPosition: XYPosition
    ) => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
  };
}

/**
 * Hook for context menu state management.
 *
 * This hook provides:
 * - Right-click handling
 * - Long-press detection for touch devices
 * - Menu state (open/closed, position, target)
 *
 * You provide your own menu UI component.
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const { contextMenu, closeMenu, onContextMenu, longPressProps } = useContextMenu();
 *
 *   const handleContextMenu = (e: React.MouseEvent) => {
 *     const worldPos = screenToWorld(e.clientX, e.clientY, viewport);
 *     const node = getNodeAtPosition(nodes, worldPos, viewport);
 *
 *     if (node) {
 *       onContextMenu(e, { type: 'node', node }, worldPos);
 *     } else {
 *       onContextMenu(e, { type: 'pane' }, worldPos);
 *     }
 *   };
 *
 *   return (
 *     <>
 *       <div onContextMenu={handleContextMenu}>
 *         <KookieFlow ... />
 *       </div>
 *
 *       {contextMenu && (
 *         <ContextMenu
 *           target={contextMenu.target}
 *           position={contextMenu.position}
 *           onClose={closeMenu}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */
export function useContextMenu(options?: UseContextMenuOptions): UseContextMenuReturn {
  const { longPressDuration = 500, enabled = true } = options ?? {};

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTargetRef = useRef<{
    target: ContextMenuTarget;
    worldPosition: XYPosition;
    touchPosition: XYPosition;
  } | null>(null);

  const closeMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openMenu = useCallback((state: ContextMenuState) => {
    setContextMenu(state);
  }, []);

  const onContextMenu = useCallback(
    (event: React.MouseEvent, target: ContextMenuTarget, worldPosition: XYPosition) => {
      if (!enabled) return;

      event.preventDefault();
      event.stopPropagation();

      setContextMenu({
        target,
        position: { x: event.clientX, y: event.clientY },
        worldPosition,
      });
    },
    [enabled]
  );

  // Long-press handlers for touch devices
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTargetRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent, target: ContextMenuTarget, worldPosition: XYPosition) => {
      if (!enabled) return;

      const touch = event.touches[0];
      if (!touch) return;

      longPressTargetRef.current = {
        target,
        worldPosition,
        touchPosition: { x: touch.clientX, y: touch.clientY },
      };

      longPressTimerRef.current = setTimeout(() => {
        if (longPressTargetRef.current) {
          setContextMenu({
            target: longPressTargetRef.current.target,
            position: longPressTargetRef.current.touchPosition,
            worldPosition: longPressTargetRef.current.worldPosition,
          });
        }
        clearLongPress();
      }, longPressDuration);
    },
    [enabled, longPressDuration, clearLongPress]
  );

  const onTouchEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const onTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    clearLongPress();
  }, [clearLongPress]);

  // Close menu on outside click
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => {
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    // Delay adding listener to avoid closing immediately
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, closeMenu]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, [clearLongPress]);

  return {
    contextMenu,
    closeMenu,
    openMenu,
    onContextMenu,
    longPressProps: {
      onTouchStart,
      onTouchEnd,
      onTouchMove,
    },
  };
}
