import {
  connectedSocketKey,
  entitySocketKey,
} from '@kushagradhawan/kookie-flow-core/internal/utils/socket-key';
/**
 * Widget resolution utilities for Phase 7D: Socket Widgets
 *
 * Resolves widget configuration by merging socket-level overrides
 * with SocketType defaults.
 */

import type { Entity, Socket, SocketType, WidgetType, ResolvedWidgetConfig } from '../types/index';

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

  // A graph must describe GPU controls as data. Reject obsolete inline DOM components loudly.
  if (typeof socket.widget === 'object' && socket.widget !== null) {
    throw new TypeError('Inline DOM widgets are not supported. Use a built-in WebGL widget type.');
  }

  // Determine widget type: socket override → type default → null
  const widgetType: WidgetType | undefined =
    (typeof socket.widget === 'string' ? socket.widget : undefined) ?? socketType?.widget;

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
    optionLabels: socket.optionLabels,
    placeholder: socket.placeholder,
    defaultValue: socket.defaultValue,
    rows: socket.rows,
    dimensions: socket.dimensions ?? socketType?.dimensions,
  };
}

/**
 * Which widget type a socket resolves to, without building a config.
 *
 * For the pointermove path, which asks on every move over a widget and must not allocate:
 * `resolveWidgetConfig` returns a fresh object. Same three rules in the same order, so the two
 * agree on `type` by construction.
 */
export function widgetTypeOf(
  socket: Socket,
  socketTypes: Record<string, SocketType>
): WidgetType | null {
  if (socket.widget === false) return null;
  return (
    (typeof socket.widget === 'string' ? socket.widget : undefined) ??
    socketTypes[socket.type]?.widget ??
    null
  );
}

/** The widget type on input `socketId` of an entity, or null. Allocation-free, like widgetTypeOf. */
export function inputWidgetType(
  entity: Entity | undefined,
  socketId: string,
  socketTypes: Record<string, SocketType>
): WidgetType | null {
  const inputs = entity?.inputs;
  if (!inputs) return null;
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].id === socketId) return widgetTypeOf(inputs[i], socketTypes);
  }
  return null;
}

/**
 * Check if a socket is connected (has an incoming edge).
 *
 * @param entityId - The entity ID containing the socket
 * @param socketId - The socket ID to check
 * @param connectedSockets - Set of connected socket keys, `entityId:socketId:input|output`
 * @returns true if the socket has an incoming connection
 */
export function isSocketConnected(
  entityId: string,
  socketId: string,
  connectedSockets: Set<string>
): boolean {
  // Inputs only: a widget stands in for a value the socket does not receive, and only an input
  // receives one. The direction suffix is not decoration — see rebuildConnectedSockets.
  return connectedSockets.has(connectedSocketKey(entityId, socketId, true));
}

/**
 * Build a set of connected input socket keys from edges.
 *
 * @param edges - Array of edges to process
 * @returns Set of connected socket keys in format "entityId:socketId"
 */
export function buildConnectedSocketsSet(
  edges: Array<{ target: string; targetSocket?: string }>
): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.targetSocket) {
      connected.add(entitySocketKey(edge.target, edge.targetSocket));
    }
  }
  return connected;
}
