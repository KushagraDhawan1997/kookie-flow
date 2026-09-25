import type { EntityChange } from '../types/index';

type ChangeHandler = ((changes: EntityChange[]) => void) | undefined;
const owners = new WeakMap<Element, () => ChangeHandler>();

/** The canvas supplies its current controlled handler without re-registering on every render. */
export function bindHistoryOwner(
  element: Element | null,
  handler: () => ChangeHandler
): () => void {
  if (element) owners.set(element, handler);
  return () => {
    if (element && owners.get(element) === handler) owners.delete(element);
  };
}

export function historyOwner(element: Element): ChangeHandler {
  return owners.get(element)?.();
}
