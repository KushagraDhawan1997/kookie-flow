/**
 * jsdom setup for the DOM tier.
 *
 * jsdom implements neither WebGL nor the pointer APIs the canvas host calls unguarded, so a
 * component that mounts InputHandler throws before any assertion runs. These are the minimum
 * stubs that let a mount succeed; each one is here because its absence is a TypeError, not
 * because the behaviour is being faked.
 *
 * Nothing here should ever be used to assert a visual claim — jsdom cannot rasterise. Pixel
 * questions belong in harness/, which drives real Chromium.
 */

// ResizeObserver: used by CameraController and the minimap to track canvas size.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// Pointer capture: called at four sites in the input handler with no feature guard.
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
}

// matchMedia: jsdom does not implement it, and the minimap uses it to notice a device-pixel-ratio
// change. Without this the component cannot mount in this tier at all. The stub reports "no match"
// and never fires, which is the honest answer for a fake with no display behind it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom ships MouseEvent but not PointerEvent. Extending MouseEvent keeps clientX/clientY,
// button and the modifier flags real, which is what the input paths actually read.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly pressure: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
      this.pressure = params.pressure ?? 0.5;
    }
  }
  globalThis.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

// Deliberately NOT stubbed: getContext('webgl2'). A DOM test that reaches for a GL context
// should fail loudly rather than silently assert against a null renderer.
