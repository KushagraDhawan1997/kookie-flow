import type {
  Node,
  SocketHandle,
  SocketType,
  ConnectionMode,
  IsValidConnectionFn,
  ConnectionValidationParams,
} from '../types';

/**
 * Extended socket type config with compatibility info.
 */
interface SocketTypeConfig extends SocketType {
  compatibleWith?: string[] | '*';
}

/**
 * Check if two socket types are compatible for connection.
 * Exported for use in hot paths where we already have the socket types.
 */
export function areTypesCompatible(
  typeA: string,
  typeB: string,
  socketTypes: Record<string, SocketType>
): boolean {
  // Same type always compatible
  if (typeA === typeB) return true;

  // Check 'any' type
  if (typeA === 'any' || typeB === 'any') return true;

  // Check explicit compatibility
  const configA = socketTypes[typeA] as SocketTypeConfig | undefined;
  const configB = socketTypes[typeB] as SocketTypeConfig | undefined;

  if (configA?.compatibleWith === '*' || configB?.compatibleWith === '*') {
    return true;
  }

  if (
    Array.isArray(configA?.compatibleWith) &&
    configA.compatibleWith.includes(typeB)
  ) {
    return true;
  }

  if (
    Array.isArray(configB?.compatibleWith) &&
    configB.compatibleWith.includes(typeA)
  ) {
    return true;
  }

  return false;
}

/**
 * Check if two sockets are compatible for connection.
 * Rules:
 * 1. Cannot connect input to input or output to output
 * 2. Cannot connect a socket to itself or same node
 * 3. Type compatibility: same type, 'any', or explicit compatibleWith
 *
 * Accepts either nodes array or nodeMap for flexibility.
 * Use nodeMap in hot paths (like useFrame) for O(1) lookups.
 */
export function isSocketCompatible(
  source: SocketHandle,
  target: SocketHandle,
  nodesOrMap: Node[] | Map<string, Node>,
  socketTypes: Record<string, SocketType>
): boolean {
  // Rule 1: Must connect input to output (or vice versa)
  if (source.isInput === target.isInput) return false;

  // Rule 2: Cannot connect to same node
  if (source.nodeId === target.nodeId) return false;

  // Get actual socket definitions - O(1) with Map, O(n) with array
  let sourceNode: Node | undefined;
  let targetNode: Node | undefined;

  if (nodesOrMap instanceof Map) {
    sourceNode = nodesOrMap.get(source.nodeId);
    targetNode = nodesOrMap.get(target.nodeId);
  } else {
    sourceNode = nodesOrMap.find((n) => n.id === source.nodeId);
    targetNode = nodesOrMap.find((n) => n.id === target.nodeId);
  }

  if (!sourceNode || !targetNode) return false;

  const sourceSockets = source.isInput ? sourceNode.inputs : sourceNode.outputs;
  const targetSockets = target.isInput ? targetNode.inputs : targetNode.outputs;

  const sourceSocket = sourceSockets?.find((s) => s.id === source.socketId);
  const targetSocket = targetSockets?.find((s) => s.id === target.socketId);
  if (!sourceSocket || !targetSocket) return false;

  // Rule 3: Type compatibility
  return areTypesCompatible(sourceSocket.type, targetSocket.type, socketTypes);
}

/**
 * Validate a connection based on mode and optional custom validator.
 * - 'loose' mode: only checks structural compatibility (input/output, different nodes)
 * - 'strict' mode: also checks type compatibility
 * - isValidConnection: custom validator overrides mode
 *
 * Accepts either nodes array or nodeMap for flexibility.
 * Use nodeMap in hot paths for O(1) lookups.
 */
export function validateConnection(
  source: SocketHandle,
  target: SocketHandle,
  nodesOrMap: Node[] | Map<string, Node>,
  socketTypes: Record<string, SocketType>,
  connectionMode: ConnectionMode = 'loose',
  isValidConnection?: IsValidConnectionFn
): boolean {
  // Structural validation (always required)
  // Rule 1: Must connect input to output (or vice versa)
  if (source.isInput === target.isInput) return false;

  // Rule 2: Cannot connect to same node
  if (source.nodeId === target.nodeId) return false;

  // Get actual socket definitions - O(1) with Map, O(n) with array
  let sourceNode: Node | undefined;
  let targetNode: Node | undefined;

  if (nodesOrMap instanceof Map) {
    sourceNode = nodesOrMap.get(source.nodeId);
    targetNode = nodesOrMap.get(target.nodeId);
  } else {
    sourceNode = nodesOrMap.find((n) => n.id === source.nodeId);
    targetNode = nodesOrMap.find((n) => n.id === target.nodeId);
  }

  if (!sourceNode || !targetNode) return false;

  const sourceSockets = source.isInput ? sourceNode.inputs : sourceNode.outputs;
  const targetSockets = target.isInput ? targetNode.inputs : targetNode.outputs;

  const sourceSocket = sourceSockets?.find((s) => s.id === source.socketId);
  const targetSocket = targetSockets?.find((s) => s.id === target.socketId);
  if (!sourceSocket || !targetSocket) return false;

  // Custom validator overrides everything
  if (isValidConnection) {
    const params: ConnectionValidationParams = {
      source,
      target,
      sourceSocketType: sourceSocket.type,
      targetSocketType: targetSocket.type,
    };
    return isValidConnection(params, socketTypes);
  }

  // Mode-based validation
  if (connectionMode === 'strict') {
    return areTypesCompatible(sourceSocket.type, targetSocket.type, socketTypes);
  }

  // 'loose' mode: structural checks passed, allow connection
  return true;
}
