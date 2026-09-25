/**
 * Side-channel for communicating interaction mode to renderers.
 * Avoids adding to Zustand state (no GC from state changes per frame).
 * Set by InputHandler, read by EntitySelection useFrame.
 */

export type InteractionMode = 'idle' | 'dragging' | 'resizing' | 'connecting' | 'boxSelecting';

let _interactionMode: InteractionMode = 'idle';

/**
 * Observers, for consumers that need to KNOW the mode changed rather than to read it in a frame
 * they were already rendering.
 *
 * The toolbar wanted that and, with no way to ask, polled: an unconditional `requestAnimationFrame`
 * loop running for the whole life of the component, every frame, forever, comparing one variable
 * against its previous value. Its own comment said why — "poll interaction mode since it's a
 * side-channel (not in store)" — which is a description of a missing mechanism rather than a
 * reason. A set of callbacks is that mechanism, and it costs nothing when nothing changes.
 *
 * Deliberately NOT moved into the store: the reason this side-channel exists is that the mode
 * changes per frame during a drag, and putting it in Zustand would allocate a new state object
 * every one of those frames. The observer keeps that property — no allocation on read, no
 * allocation on a set that does not change the value.
 */
type ModeObserver = (mode: InteractionMode) => void;
const observers = new Set<ModeObserver>();

export function getInteractionMode(): InteractionMode {
  return _interactionMode;
}

export function setInteractionMode(mode: InteractionMode): void {
  // Notify only on an actual change. A drag sets 'dragging' on every pointermove, and firing
  // observers for a value that did not move would put the polling cost back with extra steps.
  if (mode === _interactionMode) return;
  _interactionMode = mode;
  for (const observer of observers) observer(mode);
}

/** Subscribe to mode changes. Returns an unsubscribe function. */
export function observeInteractionMode(observer: ModeObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}
