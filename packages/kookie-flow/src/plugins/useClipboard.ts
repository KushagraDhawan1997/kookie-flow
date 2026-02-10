import { useCallback } from 'react';
import { useFlowStoreApi } from '../components/context';
import type { CloneElementsResult, EntityData, PasteFromInternalOptions } from '../types';

export interface UseClipboardOptions<T extends EntityData = EntityData> {
  /** Offset for pasted elements. Default: { x: 50, y: 50 } */
  offset?: { x: number; y: number };
  /** Transform function for entity data when pasting */
  transformData?: (data: T) => T;
  /**
   * Preserve external connections when pasting.
   * When true, edges connecting to non-copied entities will be recreated,
   * connecting the pasted entities to the original external entities.
   * Default: false
   */
  preserveExternalConnections?: boolean;
}

export interface PasteOptions<T extends EntityData = EntityData> {
  /** Override offset for this paste operation */
  offset?: { x: number; y: number };
  /** Override preserveExternalConnections for this paste operation */
  preserveExternalConnections?: boolean;
  /** Override transformData for this paste operation */
  transformData?: (data: T) => T;
}

export interface UseClipboardReturn<T extends EntityData = EntityData> {
  /** Copy selected entities and edges to internal clipboard */
  copy: () => void;
  /** Paste from internal clipboard. Can override options per-paste. */
  paste: (options?: PasteOptions<T>) => CloneElementsResult | null;
  /** Cut selected entities and edges (copy + delete) */
  cut: () => void;
  /** Whether there's content in the clipboard */
  hasClipboardContent: () => boolean;
}

/**
 * Hook for internal clipboard operations.
 * Thin wrapper around store methods for convenience.
 *
 * For browser clipboard (cross-tab), use store.toObject() and implement
 * your own serialization based on your app's data shape.
 *
 * @example
 * ```tsx
 * const { copy, paste, cut } = useClipboard();
 *
 * // With custom offset
 * const { paste } = useClipboard({ offset: { x: 100, y: 100 } });
 *
 * // With data transformation
 * const { paste } = useClipboard({
 *   transformData: (data) => ({ ...data, status: 'idle' }),
 * });
 *
 * // With preserved external connections (duplicate with existing connections)
 * const { paste } = useClipboard({ preserveExternalConnections: true });
 *
 * // Override per-paste
 * paste({ preserveExternalConnections: true, offset: { x: 100, y: 0 } });
 * ```
 */
export function useClipboard<T extends EntityData = EntityData>(
  options?: UseClipboardOptions<T>
): UseClipboardReturn<T> {
  const store = useFlowStoreApi();

  const copy = useCallback(() => {
    store.getState().copySelectedToInternal();
  }, [store]);

  const paste = useCallback(
    (pasteOptions?: PasteOptions<T>) => {
      return store.getState().pasteFromInternal<T>({
        offset: pasteOptions?.offset ?? options?.offset,
        transformData: pasteOptions?.transformData ?? options?.transformData,
        preserveExternalConnections:
          pasteOptions?.preserveExternalConnections ?? options?.preserveExternalConnections,
      });
    },
    [store, options?.offset, options?.transformData, options?.preserveExternalConnections]
  );

  const cut = useCallback(() => {
    store.getState().cutSelectedToInternal();
  }, [store]);

  const hasClipboardContent = useCallback(() => {
    const clipboard = store.getState().internalClipboard;
    return clipboard !== null && clipboard.entities.length > 0;
  }, [store]);

  return { copy, paste, cut, hasClipboardContent };
}
