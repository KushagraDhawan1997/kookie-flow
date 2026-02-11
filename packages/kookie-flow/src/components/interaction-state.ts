/**
 * Side-channel for communicating interaction mode to renderers.
 * Avoids adding to Zustand state (no GC from state changes per frame).
 * Set by InputHandler, read by EntitySelection useFrame.
 */

export type InteractionMode = 'idle' | 'dragging' | 'resizing' | 'connecting' | 'boxSelecting';

let _interactionMode: InteractionMode = 'idle';

export function getInteractionMode(): InteractionMode {
  return _interactionMode;
}

export function setInteractionMode(mode: InteractionMode): void {
  _interactionMode = mode;
}
