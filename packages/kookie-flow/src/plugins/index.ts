// Plugins for Kookie Flow
// These are thin wrappers around core store methods for convenience

export { useClipboard } from './useClipboard';
export type { UseClipboardOptions, UseClipboardReturn, PasteOptions } from './useClipboard';

export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export type {
  KeyHandler,
  KeyBinding,
  UseKeyboardShortcutsOptions,
} from './useKeyboardShortcuts';

export { useContextMenu } from './useContextMenu';
export type {
  ContextMenuTarget,
  ContextMenuState,
  UseContextMenuOptions,
  UseContextMenuReturn,
} from './useContextMenu';
