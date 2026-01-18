import { useEffect, useCallback, useRef } from 'react';

export type KeyHandler = (event: KeyboardEvent) => void;

export interface KeyBinding {
  /** Key combination (e.g., "mod+c", "delete", "shift+a") */
  key: string;
  /** Handler function */
  handler: KeyHandler;
  /** Prevent default browser behavior. Default: true */
  preventDefault?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  /** Key bindings configuration */
  bindings: Record<string, KeyHandler> | KeyBinding[];
  /** Element to attach listeners to. Default: document */
  target?: HTMLElement | Document | null;
  /** Whether shortcuts are enabled. Default: true */
  enabled?: boolean;
  /** Only trigger when target element or its descendants have focus. Default: false */
  requireFocus?: boolean;
  /** Reference to the container element for focus checking */
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * Normalize a key string for comparison.
 * Handles "mod" -> "meta" on Mac, "ctrl" on others.
 */
function normalizeKey(key: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return key
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/mod/g, isMac ? 'meta' : 'ctrl');
}

/**
 * Parse a key binding string into its components.
 */
function parseKeyBinding(binding: string): { modifiers: Set<string>; key: string } {
  const parts = normalizeKey(binding).split('+');
  const key = parts.pop() || '';
  const modifiers = new Set(parts);
  return { modifiers, key };
}

/**
 * Check if a keyboard event matches a key binding.
 */
function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const { modifiers, key } = parseKeyBinding(binding);

  // Check modifiers
  if (modifiers.has('ctrl') !== event.ctrlKey) return false;
  if (modifiers.has('meta') !== event.metaKey) return false;
  if (modifiers.has('alt') !== event.altKey) return false;
  if (modifiers.has('shift') !== event.shiftKey) return false;

  // Check key
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();

  // Handle special keys
  if (key === 'delete' && (eventKey === 'delete' || eventKey === 'backspace')) return true;
  if (key === 'backspace' && eventKey === 'backspace') return true;
  if (key === 'escape' && (eventKey === 'escape' || eventKey === 'esc')) return true;
  if (key === 'enter' && eventKey === 'enter') return true;
  if (key === 'space' && (eventKey === ' ' || eventCode === 'space')) return true;

  // Handle arrow keys
  if (key === 'arrowup' && eventKey === 'arrowup') return true;
  if (key === 'arrowdown' && eventKey === 'arrowdown') return true;
  if (key === 'arrowleft' && eventKey === 'arrowleft') return true;
  if (key === 'arrowright' && eventKey === 'arrowright') return true;

  // Handle letter keys (check both key and code for layout independence)
  if (eventKey === key) return true;
  if (eventCode === `key${key.toUpperCase()}`) return true;

  return false;
}

/**
 * Hook for configurable keyboard shortcuts.
 *
 * @example
 * ```tsx
 * // Object syntax (simple)
 * useKeyboardShortcuts({
 *   bindings: {
 *     'mod+c': () => store.getState().copySelectedToInternal(),
 *     'mod+v': () => store.getState().pasteFromInternal(),
 *     'mod+x': () => store.getState().cutSelectedToInternal(),
 *     'mod+a': () => store.getState().selectAll(),
 *     'delete': () => store.getState().deleteSelected(),
 *     'escape': () => store.getState().deselectAll(),
 *   },
 * });
 *
 * // Array syntax (more control)
 * useKeyboardShortcuts({
 *   bindings: [
 *     { key: 'mod+c', handler: copy, preventDefault: true },
 *     { key: 'mod+v', handler: paste, preventDefault: true },
 *   ],
 * });
 *
 * // With focus requirement
 * const containerRef = useRef<HTMLDivElement>(null);
 * useKeyboardShortcuts({
 *   bindings: { 'delete': deleteSelected },
 *   requireFocus: true,
 *   containerRef,
 * });
 * ```
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { bindings, target, enabled = true, requireFocus = false, containerRef } = options;

  // Convert object syntax to array syntax
  const bindingsArray: KeyBinding[] = Array.isArray(bindings)
    ? bindings
    : Object.entries(bindings).map(([key, handler]) => ({
        key,
        handler,
        preventDefault: true,
      }));

  // Use ref to avoid recreating handler on every render
  const bindingsRef = useRef(bindingsArray);
  bindingsRef.current = bindingsArray;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Skip if typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Check focus requirement
      if (requireFocus && containerRef?.current) {
        if (!containerRef.current.contains(document.activeElement)) {
          return;
        }
      }

      // Check each binding
      for (const binding of bindingsRef.current) {
        if (matchesBinding(event, binding.key)) {
          if (binding.preventDefault !== false) {
            event.preventDefault();
          }
          binding.handler(event);
          return;
        }
      }
    },
    [requireFocus, containerRef]
  );

  useEffect(() => {
    if (!enabled) return;

    const eventTarget = target ?? document;
    eventTarget.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      eventTarget.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [enabled, target, handleKeyDown]);
}
