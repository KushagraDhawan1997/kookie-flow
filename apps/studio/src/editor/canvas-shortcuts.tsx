'use client';

import type { EdgeChange, EntityChange } from '@kushagradhawan/kookie-flow';
import { useFlowStoreApi } from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';
import { registry, stripResolved } from 'studio-core';

interface CanvasShortcutsProps {
  onEntitiesChange: (changes: EntityChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Is the keyboard in the graph, rather than in the inspector or the header? */
const canvasHasFocus = () => Boolean(document.activeElement?.closest('[data-kookie-flow-container]'));

/**
 * Copy, paste, duplicate, undo and redo for the canvas. Rendered inside `<KookieFlow>` because
 * the clipboard lives in the flow store. Delete and select-all are the library's own.
 *
 * NOTHING IS CANCELLED PAGE-WIDE. These keys are bound on the document, so cancelling them up
 * front took Cmd+C away from every other part of the page: selecting the text a node produced in
 * the inspector and copying it put nothing on the clipboard. Each binding now declines the key
 * unless the graph itself has focus, and only then prevents the browser's own action.
 *
 * A PASTE LANDS IN THE STORE FIRST, and the controlled owner must be told or the next prop sync
 * takes it straight back out — the same two-step the library's own add paths make.
 */
export function CanvasShortcuts({ onEntitiesChange, onEdgesChange, onUndo, onRedo }: CanvasShortcutsProps) {
  const store = useFlowStoreApi();
  const { copy, paste } = useClipboard({ offset: { x: 40, y: 40 } });

  const pasteAndReport = () => {
    const result = paste();
    if (!result) return;
    // The clones come out of the store RESOLVED: the sockets, size and label the type table filled
    // in are on them. Reported as they are, they become part of the graph the editor owns and get
    // saved that way, freezing the catalog of the day they were pasted. The ids stay exactly as
    // the store made them — it has already selected the clones by those ids.
    const { entities, edges } = stripResolved(result.entities, result.edges, registry);
    if (entities.length) onEntitiesChange(entities.map((entity) => ({ type: 'add', entity })));
    if (edges.length) onEdgesChange(edges.map((edge) => ({ type: 'add', edge })));
  };

  /** Run `action` only when the graph has focus, and take the key from the browser only then. */
  const onCanvas = (action: () => void) => (event: KeyboardEvent) => {
    if (!canvasHasFocus()) return;
    event.preventDefault();
    action();
  };

  useKeyboardShortcuts({
    bindings: [
      { key: 'mod+c', preventDefault: false, handler: onCanvas(copy) },
      { key: 'mod+v', preventDefault: false, handler: onCanvas(pasteAndReport) },
      {
        key: 'mod+d',
        preventDefault: false,
        handler: onCanvas(() => {
          // Duplicate means "this selection again". With nothing selected it used to paste
          // whatever was last copied, which is a different thing entirely.
          if (store.getState().selectedEntityIds.size === 0) return;
          copy();
          pasteAndReport();
        }),
      },
      // Undo is the editor's, so the canvas's pending widget values are folded in first. The
      // plugin already declines every key typed into a field, so the inspector keeps its own.
      { key: 'mod+z', preventDefault: false, handler: (e) => { e.preventDefault(); onUndo(); } },
      { key: 'mod+shift+z', preventDefault: false, handler: (e) => { e.preventDefault(); onRedo(); } },
      { key: 'mod+y', preventDefault: false, handler: (e) => { e.preventDefault(); onRedo(); } },
    ],
  });
  return null;
}
