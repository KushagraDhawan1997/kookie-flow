import type { Node, SocketHandle, SocketType } from '../types';

/**
 * Extended socket type config with compatibility info.
 */
interface SocketTypeConfig extends SocketType {
  compatibleWith?: string[] | '*';
}

/**
 * Check if two socket types are compatible for connection.
 */
function areTypesCompatible(
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
 */
export function isSocketCompatible(
  source: SocketHandle,
  target: SocketHandle,
  nodes: Node[],
  socketTypes: Record<string, SocketType>
): boolean {
  // Rule 1: Must connect input to output (or vice versa)
  if (source.isInput === target.isInput) return false;

  // Rule 2: Cannot connect to same node
  if (source.nodeId === target.nodeId) return false;

  // Get actual socket definitions
  const sourceNode = nodes.find((n) => n.id === source.nodeId);
  const targetNode = nodes.find((n) => n.id === target.nodeId);
  if (!sourceNode || !targetNode) return false;

  const sourceSockets = source.isInput ? sourceNode.inputs : sourceNode.outputs;
  const targetSockets = target.isInput ? targetNode.inputs : targetNode.outputs;

  const sourceSocket = sourceSockets?.find((s) => s.id === source.socketId);
  const targetSocket = targetSockets?.find((s) => s.id === target.socketId);
  if (!sourceSocket || !targetSocket) return false;

  // Rule 3: Type compatibility
  return areTypesCompatible(sourceSocket.type, targetSocket.type, socketTypes);
}
