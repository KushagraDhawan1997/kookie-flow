/** Keep the usual IDs cheap and readable; escape the entity delimiter only when necessary. */
export function entitySocketKey(entityId: string, socketId: string): string {
  const entity =
    entityId.includes(':') || entityId.includes('%')
      ? entityId.replace(/%/g, '%25').replace(/:/g, '%3A')
      : entityId;
  return `${entity}:${socketId}`;
}

export function connectedSocketKey(entityId: string, socketId: string, isInput: boolean): string {
  return `${entitySocketKey(entityId, socketId)}:${isInput ? 'input' : 'output'}`;
}
