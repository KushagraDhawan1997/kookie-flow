"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A live canvas in the middle of a chapter must not take the page's scroll.
 *
 * `<KookieFlow>` is built to own its box: its container calls `preventDefault()` on every wheel
 * event (a wheel is a zoom) and states `touch-action: none` (a drag is a pan). Full-screen that
 * is right. In a figure 360px tall it means a reader scrolling down the chapter lands on the
 * specimen and the page stops while the graph zooms, and on a phone a swipe that starts on the
 * canvas moves nothing. V2's specimens are ordinary DOM and never trap the scroll.
 *
 * THE FIX IS THE DOCS', NOT THE EXAMPLE'S, so the source a reader copies stays the plain
 * component they would write in their own app.
 *
 * WHEEL: a capture-phase listener on this box stops a plain wheel before it reaches the
 * library's container, so nothing calls `preventDefault()` and the page scrolls. A trackpad
 * pinch arrives as a wheel with `ctrlKey`, and cmd+wheel is the deliberate zoom, so both still
 * reach the canvas. Passive, because it never cancels anything.
 *
 * TOUCH: a child's `touch-action: none` cannot be loosened from a parent, so on a coarse pointer
 * a veil with `touch-action: pan-y` lies over the stage until the first tap, then removes itself
 * and the canvas owns every touch after it. Refs only — nothing here re-renders during a gesture.
 */
export function CanvasGuard({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    box.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => box.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const reveal = () => {
    const veil = veilRef.current;
    if (veil) veil.hidden = true;
  };

  return (
    <div ref={boxRef} className="kd-canvas-guard kd-canvas">
      <div className="kd-canvas-guard-stage">{children}</div>
      <div ref={veilRef} className="kd-canvas-guard-veil" aria-hidden="true" onClick={reveal} />
    </div>
  );
}
