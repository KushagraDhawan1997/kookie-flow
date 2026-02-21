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
import { DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_PADDING, DEFAULT_TEXT_SIZING_MODE } from '../core/constants';
import { resolveTextStyle, calculateTextAutoHeightMSDF, calculateTextAutoSizeMSDF, NO_WRAP_WIDTH } from '../utils/text-texture';
import type { GlyphMap, KerningMap } from '../utils/text-layout';
import {
  getSharedCharPositionTable,
  getCursorXY,
  visualLineForOffset,
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
        const sizingMode = data.sizingMode ?? DEFAULT_TEXT_SIZING_MODE;

        let newW = w;
        let newH = entity.height ?? calcAutoHeight(newContent, data, w);

        if (sizingMode === 'auto-width' && regularFont && glyphMap.size > 0) {
          const style = resolveTextStyle(data);
          const size = calculateTextAutoSizeMSDF(
            newContent, style, regularFont.metrics.info.size, glyphMap, kerningMap
          );
          newW = size.width;
          newH = size.height;
        } else if (sizingMode === 'auto-height') {
          newH = calcAutoHeight(newContent, data, w);
        }
        // fixed: keep current dimensions

        onEntitiesChange?.([
          { type: 'data', id: currentId, data: { ...data, content: newContent } },
          { type: 'dimensions', id: currentId, dimensions: { width: newW, height: newH } },
        ]);

        store.getState().updateEntityDimensions(currentId, newW, newH);
      }
    }

    store.getState().stopEditing();
  }, [store, onEntitiesChange, calcAutoHeight, regularFont, glyphMap, kerningMap]);

  // Sync textarea → store on input.
  // Dimension updates (auto-height / auto-width) are deferred to the
  // text-entities.tsx useFrame loop via pendingDimUpdatesRef, avoiding
  // expensive store mutations (array spread + quadtree rebuild) per keystroke.
  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    store.getState().setEditingContent(ta.value);
    store.getState().setEditingCursor(ta.selectionStart, ta.selectionEnd);
  }, [store]);

  // Sync selection changes (arrow keys, shift+click, etc.)
  // Guard: only sync cursor when textarea content matches store content.
  // Prevents stale cursor positioning if selectionchange fires before input.
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.value !== store.getState().editingContent) return;
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
        const sizingMode = data.sizingMode ?? DEFAULT_TEXT_SIZING_MODE;
        const layoutWidth = sizingMode === 'auto-width' ? NO_WRAP_WIDTH : w;
        const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const lineHeightMul = data.lineHeight ?? 1.5;
        const letterSpacing = data.letterSpacing ?? 0;
        const textAlign = data.textAlign ?? 'left';
        const pad = DEFAULT_TEXT_PADDING;

        const table = getSharedCharPositionTable(
          content, fontSize, lineHeightMul, textAlign,
          layoutWidth, pad, entity.position.x, entity.position.y,
          regularFont.metrics, glyphMap, kerningMap, letterSpacing
        );

        if (table.lineCount <= 1) return; // Let textarea handle single-line

        e.preventDefault();

        const cursorOffset = ta.selectionStart;
        // Use visual line (consistent with getCursorXY line-boundary adjustment)
        const line = visualLineForOffset(cursorOffset, table);

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
        const sizingModeHome = data.sizingMode ?? DEFAULT_TEXT_SIZING_MODE;
        const layoutWidthHome = sizingModeHome === 'auto-width' ? NO_WRAP_WIDTH : w;
        const fontSize = data.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const lineHeightMul = data.lineHeight ?? 1.5;
        const letterSpacing = data.letterSpacing ?? 0;
        const textAlign = data.textAlign ?? 'left';
        const pad = DEFAULT_TEXT_PADDING;

        const table = getSharedCharPositionTable(
          content, fontSize, lineHeightMul, textAlign,
          layoutWidthHome, pad, entity.position.x, entity.position.y,
          regularFont.metrics, glyphMap, kerningMap, letterSpacing
        );

        if (table.lineCount <= 1) {
          // Single line — let textarea handle natively
          e.stopPropagation();
          return;
        }

        e.preventDefault();

        const cursorOffset = ta.selectionStart;
        // Use visual line (consistent with getCursorXY line-boundary adjustment)
        const line = visualLineForOffset(cursorOffset, table);

        let newOffset: number;
        if (e.key === 'Home') {
          newOffset = lineColumnToContentOffset(line, 0, table);
        } else {
          // End: go one past last char on the line (the \n or trimmed space).
          // Can't use lineColumnToContentOffset(line, lineLength) — that overflows
          // to the next line's first position.
          const lastCol = table.lineLengths[line] - 1;
          if (lastCol >= 0) {
            newOffset = lineColumnToContentOffset(line, lastCol, table) + 1;
          } else {
            // Empty line
            newOffset = lineColumnToContentOffset(line, 0, table);
          }
        }

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
