/**
 * TextEditOverlay — Hidden textarea for text editing input capture.
 * Phase 10C: WebGL-native text editing.
 *
 * Mounts an invisible <textarea> that captures all keyboard input, IME
 * composition, and clipboard operations. All visual rendering (text, cursor,
 * selection) happens in WebGL via TextEntities and TextEditCursor.
 *
 * The textarea's content and selection are synced bidirectionally with
 * the Zustand store (editingContent, editingCursor).
 */

import { useRef, useState, useCallback, useLayoutEffect } from 'react';
import { useFlowStoreApi } from './context';
import { useFont } from '../contexts/FontContext';
import type { TextEntityData, EntityChange } from '../types';
import { DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_PADDING } from '../core/constants';
import { resolveTextStyle, calculateTextAutoHeightMSDF } from '../utils/text-texture';
import type { GlyphMap, KerningMap } from '../utils/text-layout';
import {
  getSharedCharPositionTable,
  getCursorXY,
  contentOffsetToLineColumn,
  lineColumnToContentOffset,
} from '../utils/text-cursor-layout';

// Stable empty maps to avoid re-creating on every render when font isn't loaded
const emptyGlyphMap: GlyphMap = new Map();
const emptyKerningMap: KerningMap = new Map();

// Module-level ref for the textarea, accessible from InputHandler (kookie-flow.tsx)
let _textareaEl: HTMLTextAreaElement | null = null;
export function getEditingTextarea(): HTMLTextAreaElement | null {
  return _textareaEl;
}

// Suppress the next blur-triggered commit (set by InputHandler when clicking on editing entity)
let _suppressNextBlur = false;
export function suppressEditBlur(): void {
  _suppressNextBlur = true;
}

interface TextEditOverlayProps {
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function TextEditOverlay({ onEntitiesChange }: TextEditOverlayProps) {
  const store = useFlowStoreApi();
  const fontContext = useFont();
  const regularFont = fontContext.regular;

  // Pre-built lookup maps from FontContext (shared across all text components)
  const glyphMap = regularFont?.glyphMap ?? emptyGlyphMap;
  const kerningMap = regularFont?.kerningMap ?? emptyKerningMap;

  const [editingId, setEditingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to editingEntityId changes (React re-render for mount/unmount)
  useLayoutEffect(() => {
    return store.subscribe(
      (s) => s.editingEntityId,
      (id) => setEditingId(id)
    );
  }, [store]);

  // Calculate auto-height using MSDF measurement
  const calcAutoHeight = useCallback(
    (content: string, data: TextEntityData, entityWidth: number): number => {
      const style = resolveTextStyle(data);
      if (regularFont && glyphMap.size > 0) {
        return calculateTextAutoHeightMSDF(
          content, style, entityWidth,
          regularFont.metrics.info.size, glyphMap, kerningMap
        );
      }
      return style.fontSize * style.lineHeight + 2 * style.padding;
    },
    [regularFont, glyphMap, kerningMap]
  );

  // When editing starts: populate textarea, focus, sync to store
  useLayoutEffect(() => {
    if (!editingId || !textareaRef.current) return;

    const entity = store.getState().entityMap.get(editingId);
    if (!entity || entity.type !== 'text') return;

    const data = entity.data as TextEntityData;
    const content = data.content ?? '';

    const ta = textareaRef.current;
    ta.value = content;
    ta.focus();
    // Select all text on entry (Figma behavior: double-click selects all,
    // then single click repositions cursor)
    ta.selectionStart = 0;
    ta.selectionEnd = content.length;

    // Sync to store
    store.getState().setEditingContent(content);
    store.getState().setEditingCursor(0, content.length);

    // Store module-level ref
    _textareaEl = ta;

    return () => {
      _textareaEl = null;
    };
  }, [editingId, store]);

  // Commit content and exit edit mode
  const commitAndExit = useCallback(() => {
    const currentId = store.getState().editingEntityId;
    if (!currentId) return;

    const editingContent = store.getState().editingContent;
    const entity = store.getState().entityMap.get(currentId);
    if (entity) {
      const data = entity.data as TextEntityData;
      const newContent = editingContent ?? data.content ?? '';

      if (newContent !== data.content) {
        const w = entity.width ?? DEFAULT_TEXT_WIDTH;
        const newHeight = calcAutoHeight(newContent, data, w);

        onEntitiesChange?.([
          { type: 'data', id: currentId, data: { ...data, content: newContent } },
          { type: 'dimensions', id: currentId, dimensions: { width: w, height: newHeight } },
        ]);

        store.getState().updateEntityDimensions(currentId, w, newHeight);
      }
    }

    store.getState().stopEditing();
  }, [store, onEntitiesChange, calcAutoHeight]);

  // Sync textarea → store on input
  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const content = ta.value;
    store.getState().setEditingContent(content);
    store.getState().setEditingCursor(ta.selectionStart, ta.selectionEnd);

    // Auto-height update
    const entityId = store.getState().editingEntityId;
    if (entityId) {
      const entity = store.getState().entityMap.get(entityId);
      if (entity) {
        const data = entity.data as TextEntityData;
        const w = entity.width ?? DEFAULT_TEXT_WIDTH;
        const newHeight = calcAutoHeight(content, data, w);
        store.getState().updateEntityDimensions(entityId, w, newHeight);
      }
    }
  }, [store, calcAutoHeight]);

  // Sync selection changes (arrow keys, shift+click, etc.)
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    store.getState().setEditingCursor(ta.selectionStart, ta.selectionEnd);
  }, [store]);

  // Keyboard handlers
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitAndExit();
        return;
      }

      // Arrow Up/Down need special handling for wrapped lines
      // (textarea sees flat text, but visual lines are word-wrapped)
      // Let Ctrl/Cmd+Arrow fall through for native paragraph navigation
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !e.ctrlKey && !e.metaKey &&
        regularFont && glyphMap.size > 0
      ) {
        const ta = textareaRef.current;
        if (!ta) return;

        const entityId = store.getState().editingEntityId;
        if (!entityId) return;

        const entity = store.getState().entityMap.get(entityId);
        if (!entity || entity.type !== 'text') return;

        const data = entity.data as TextEntityData;
        const content = ta.value;
        const w = entity.width ?? DEFAULT_TEXT_WIDTH;
        const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const lineHeightMul = data.lineHeight ?? 1.5;
        const letterSpacing = data.letterSpacing ?? 0;
        const textAlign = data.textAlign ?? 'left';
        const pad = DEFAULT_TEXT_PADDING;

        const table = getSharedCharPositionTable(
          content, fontSize, lineHeightMul, textAlign,
          w, pad, entity.position.x, entity.position.y,
          regularFont.metrics, glyphMap, kerningMap, letterSpacing
        );

        if (table.lineCount <= 1) return; // Let textarea handle single-line

        e.preventDefault();

        const cursorOffset = ta.selectionStart;
        const { line } = contentOffsetToLineColumn(cursorOffset, table);

        const targetLine = e.key === 'ArrowUp' ? line - 1 : line + 1;
        if (targetLine < 0 || targetLine >= table.lineCount) return;

        // Maintain visual X position (standard text editor behavior)
        const currentPos = getCursorXY(
          cursorOffset, table,
          entity.position.x, entity.position.y, pad
        );

        // Find the closest character on the target line by X position
        const lineLen = table.lineLengths[targetLine];
        let bestCol = 0;
        let bestDist = Infinity;

        for (let col = 0; col <= lineLen; col++) {
          const testOffset = lineColumnToContentOffset(targetLine, col, table);
          const testPos = getCursorXY(
            testOffset, table,
            entity.position.x, entity.position.y, pad
          );
          const dist = Math.abs(testPos.x - currentPos.x);
          if (dist < bestDist) {
            bestDist = dist;
            bestCol = col;
          }
        }

        const newOffset = lineColumnToContentOffset(targetLine, bestCol, table);

        if (e.shiftKey) {
          // Extend selection
          const anchor = ta.selectionDirection === 'backward'
            ? ta.selectionEnd
            : ta.selectionStart;
          const newStart = Math.min(anchor, newOffset);
          const newEnd = Math.max(anchor, newOffset);
          ta.selectionStart = newStart;
          ta.selectionEnd = newEnd;
          store.getState().setEditingCursor(newStart, newEnd);
        } else {
          ta.selectionStart = newOffset;
          ta.selectionEnd = newOffset;
          store.getState().setEditingCursor(newOffset, newOffset);
        }

        return;
      }

      // Home/End: navigate to visual (wrapped) line start/end, not content line
      if (
        (e.key === 'Home' || e.key === 'End') &&
        !e.ctrlKey && !e.metaKey &&
        regularFont && glyphMap.size > 0
      ) {
        const ta = textareaRef.current;
        if (!ta) return;

        const entityId = store.getState().editingEntityId;
        if (!entityId) return;

        const entity = store.getState().entityMap.get(entityId);
        if (!entity || entity.type !== 'text') return;

        const data = entity.data as TextEntityData;
        const content = ta.value;
        const w = entity.width ?? DEFAULT_TEXT_WIDTH;
        const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const lineHeightMul = data.lineHeight ?? 1.5;
        const letterSpacing = data.letterSpacing ?? 0;
        const textAlign = data.textAlign ?? 'left';
        const pad = DEFAULT_TEXT_PADDING;

        const table = getSharedCharPositionTable(
          content, fontSize, lineHeightMul, textAlign,
          w, pad, entity.position.x, entity.position.y,
          regularFont.metrics, glyphMap, kerningMap, letterSpacing
        );

        if (table.lineCount <= 1) {
          // Single line — let textarea handle natively
          e.stopPropagation();
          return;
        }

        e.preventDefault();

        const cursorOffset = ta.selectionStart;
        const { line } = contentOffsetToLineColumn(cursorOffset, table);

        const newOffset = e.key === 'Home'
          ? lineColumnToContentOffset(line, 0, table)
          : lineColumnToContentOffset(line, table.lineLengths[line], table);

        if (e.shiftKey) {
          const anchor = ta.selectionDirection === 'backward'
            ? ta.selectionEnd
            : ta.selectionStart;
          const newStart = Math.min(anchor, newOffset);
          const newEnd = Math.max(anchor, newOffset);
          ta.selectionStart = newStart;
          ta.selectionEnd = newEnd;
          store.getState().setEditingCursor(newStart, newEnd);
        } else {
          ta.selectionStart = newOffset;
          ta.selectionEnd = newOffset;
          store.getState().setEditingCursor(newOffset, newOffset);
        }

        return;
      }

      // Stop propagation to prevent InputHandler from processing
      e.stopPropagation();
    },
    [commitAndExit, store, regularFont, glyphMap, kerningMap]
  );

  // Handle blur — commit and exit (unless suppressed by click on editing entity)
  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (_suppressNextBlur) {
        _suppressNextBlur = false;
        // Re-focus textarea since we're still editing
        textareaRef.current?.focus();
        return;
      }
      if (store.getState().editingEntityId) {
        commitAndExit();
      }
    });
  }, [store, commitAndExit]);

  if (!editingId) return null;

  return (
    <textarea
      ref={textareaRef}
      onInput={handleInput}
      onSelect={handleSelect}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '1px',
        height: '1px',
        opacity: 0,
        padding: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        // Keep in DOM flow for IME popup positioning
        pointerEvents: 'none',
        zIndex: -1,
      }}
    />
  );
}
