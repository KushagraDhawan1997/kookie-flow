/**
 * Widget resolution utilities for Phase 7D: Socket Widgets
 *
 * Resolves widget configuration by merging socket-level overrides
 * with SocketType defaults.
 */

import type {
  Socket,
  SocketType,
  WidgetType,
  ResolvedWidgetConfig,
  InlineWidgetComponent,
} from '../types';

/**
 * Type guard for inline widget component
 */
function isInlineWidgetComponent(
  widget: WidgetType | false | InlineWidgetComponent | undefined
): widget is InlineWidgetComponent {
  return typeof widget === 'object' && widget !== null && 'component' in widget;
}

/**
 * Resolve widget configuration for a socket.
 *
 * Priority order:
 * 1. Socket-level `widget: false` disables widget
 * 2. Socket-level widget type/component overrides type default
 * 3. SocketType default widget
 * 4. No widget if neither provides one
 *
 * @param socket - The socket to resolve widget config for
 * @param socketTypes - Map of socket type definitions
 * @returns Resolved widget config, or null if no widget should be shown
 */
export function resolveWidgetConfig(
  socket: Socket,
  socketTypes: Record<string, SocketType>
): ResolvedWidgetConfig | null {
  const socketType = socketTypes[socket.type];

  // Check if explicitly disabled at socket level
  if (socket.widget === false) {
    return null;
  }

  // Check for inline component on socket
  if (isInlineWidgetComponent(socket.widget)) {
    // Inline component - still need a type for the config
    // Use 'text' as a fallback type since component overrides rendering
    return {
      type: 'text',
      min: socket.min ?? socketType?.min,
      max: socket.max ?? socketType?.max,
      step: socket.step ?? socketType?.step,
      options: socket.options,
      placeholder: socket.placeholder,
      defaultValue: socket.defaultValue,
      customComponent: socket.widget.component,
    };
  }

  // Determine widget type: socket override → type default → null
  const widgetType: WidgetType | undefined =
    (typeof socket.widget === 'string' ? socket.widget : undefined) ??
    socketType?.widget;

  // No widget configured
  if (!widgetType) {
    return null;
  }

  // Merge config: socket overrides type defaults
  return {
    type: widgetType,
    min: socket.min ?? socketType?.min,
    max: socket.max ?? socketType?.max,
    step: socket.step ?? socketType?.step,
    options: socket.options,
    placeholder: socket.placeholder,
    defaultValue: socket.defaultValue,
  };
}

/**
 * Check if a socket is connected (has an incoming edge).
 *
 * @param nodeId - The node ID containing the socket
 * @param socketId - The socket ID to check
 * @param connectedSockets - Set of connected socket keys in format "nodeId:socketId"
 * @returns true if the socket has an incoming connection
 */
export function isSocketConnected(
  nodeId: string,
  socketId: string,
  connectedSockets: Set<string>
): boolean {
  return connectedSockets.has(`${nodeId}:${socketId}`);
}

/**
 * Build a set of connected input socket keys from edges.
 *
 * @param edges - Array of edges to process
 * @returns Set of connected socket keys in format "nodeId:socketId"
 */
export function buildConnectedSocketsSet(
  edges: Array<{ target: string; targetSocket?: string }>
): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.targetSocket) {
      connected.add(`${edge.target}:${edge.targetSocket}`);
    }
  }
  return connected;
}
