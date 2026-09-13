/**
 * The viewer the expand button opens: one piece of media, as large as the window allows.
 *
 * DOM, and only while it is open. The rule this library keeps is that everything PERSISTENT paints
 * in GL and the DOM appears transiently for one thing and then goes away — the widget edit overlay
 * is the other instance. A viewer is the clearest case for the DOM there is: a full-size picture
 * wants the browser's own image scaling, and a clip at full size wants sound, a real scrubber and
 * the platform's fullscreen button, none of which a canvas quad has.
 *
 * The overlay is the library's own — a full-bleed scrim with the media on it, not a panel — and the
 * one control on it is v2's: the close button is a v2 `Button` with `backdrop`, so it wears the
 * theme's glass over whatever is behind it rather than an imitation of it.
 *
 * A MODEL gets a small three.js renderer of its own, for as long as the viewer is open. A second
 * WebGL context is the price, and it is paid only while someone is looking at one model; the loaded
 * scene is not shared with the canvas, because disposing it on either side would take it from both.
 *
 * PORTALED TO THE THEME ROOT, so a transformed ancestor cannot trap a `position: fixed` overlay
 * inside the canvas's box, while v2's tokens still reach the button. React still bubbles a portal's
 * events through the component tree, into the canvas's own pointer and key handlers, so the root
 * stops every one of them.
 */

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, iconStroke } from '@kookie-ui/react';
import * as THREE from 'three';
import { MeshSceneManager, frameCamera } from '../utils/mesh-loader';
import { orbitDirection, orbitFromDrag, type OrbitAngles } from '../utils/media-chrome';
import { themeRoot } from '../utils/theme-root';
import type { PreviewBitmap } from '../utils/preview-source';

export type MediaView =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string; startTime: number }
  | { kind: 'mesh'; src: string; orbit: OrbitAngles }
  | { kind: 'bitmap'; image: PreviewBitmap };

interface MediaViewerProps {
  view: MediaView | null;
  onClose: () => void;
}

/** How far in from the window's edges the media stops, so the close button never sits on it. */
const MARGIN = 72;

/** A drag in the viewer turns the model at half the canvas rate: the model is several times larger here. */
const VIEWER_ORBIT_SCALE = 0.5;

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.86)',
  outline: 'none',
};

const mediaStyle: CSSProperties = {
  maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
  maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
  objectFit: 'contain',
  borderRadius: 12,
  display: 'block',
};

const closeStyle: CSSProperties = {
  position: 'absolute',
  top: 20,
  right: 20,
};

const messageStyle: CSSProperties = {
  position: 'absolute',
  color: 'rgba(255, 255, 255, 0.7)',
  font: '14px system-ui, sans-serif',
};

function stop(e: SyntheticEvent): void {
  e.stopPropagation();
}

export function MediaViewer({ view, onClose }: MediaViewerProps) {
  if (!view || typeof document === 'undefined') return null;
  return createPortal(<ViewerDialog view={view} onClose={onClose} />, themeRoot() ?? document.body);
}

function ViewerDialog({ view, onClose }: { view: MediaView; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Focus moves in so Escape reaches the dialog, and back to wherever it was when the viewer closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={view.kind === 'mesh' ? 'Model viewer' : view.kind === 'video' ? 'Video viewer' : 'Image viewer'}
      tabIndex={-1}
      style={backdropStyle}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onWheel={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onKeyUp={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      {view.kind === 'image' ? <img src={view.src} alt="" style={mediaStyle} /> : null}
      {view.kind === 'video' ? <VideoView src={view.src} startTime={view.startTime} /> : null}
      {view.kind === 'bitmap' ? <BitmapView image={view.image} /> : null}
      {view.kind === 'mesh' ? <MeshView src={view.src} orbit={view.orbit} /> : null}
      <Button iconOnly aria-label="Close" size="3" backdrop style={closeStyle} onClick={onClose}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={iconStroke}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6L18 18M18 6L6 18" />
        </svg>
      </Button>
    </div>
  );
}

/** Picks up from the frame the canvas was on. Opened by a press, so it may play with sound. */
function VideoView({ src, startTime }: { src: string; startTime: number }) {
  return (
    <video
      src={src}
      style={mediaStyle}
      controls
      autoPlay
      loop
      playsInline
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = startTime;
      }}
    />
  );
}

/** A bitmap, image element or canvas handed to a band: copied once into a canvas of its own size. */
function BitmapView({ image }: { image: PreviewBitmap }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // An image element's `width` is its layout width; the pixels are `naturalWidth`.
    canvas.width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    canvas.height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    ctx.drawImage(image, 0, 0);
  }, [image]);
  return <canvas ref={canvasRef} style={mediaStyle} />;
}

function MeshView({ src, orbit }: { src: string; orbit: OrbitAngles }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /**
     * A canvas of the effect's own, not one React rendered. Cleanup forces the context lost, and a
     * lost context stays lost on its canvas: under StrictMode the effect runs twice on the same
     * element, and the second renderer got a dead context and threw reading its precision.
     */
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);

    let raf = 0;
    let angles = orbit;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const dir = new THREE.Vector3();

    const draw = () => {
      raf = 0;
      const entry = manager.getEntry(src);
      if (!entry?.scene) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const d = orbitDirection(angles);
      dir.set(d.x, d.y, d.z);
      frameCamera(camera, entry.center, entry.radius, dir);
      renderer.render(entry.scene, camera);
    };
    // Drawn on demand, never in a loop: a still model is one frame.
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(draw);
    };

    const manager = new MeshSceneManager(() => {
      const entry = manager.getEntry(src);
      setState(entry?.state === 'error' ? 'error' : 'loaded');
      schedule();
    });
    manager.acquire(src);

    const resize = new ResizeObserver(schedule);
    resize.observe(canvas);

    let drag: { id: number; x: number; y: number; start: OrbitAngles } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: angles };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      angles = orbitFromDrag(
        drag.start,
        (e.clientX - drag.x) * VIEWER_ORBIT_SCALE,
        (e.clientY - drag.y) * VIEWER_ORBIT_SCALE
      );
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      manager.disposeAll();
      renderer.dispose();
      // A viewer opened and closed a few times must not leave contexts for the browser to evict.
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [src, orbit]);

  return (
    <>
      <div
        ref={hostRef}
        style={{
          width: `calc(100vw - ${MARGIN * 2}px)`,
          height: `calc(100vh - ${MARGIN * 2}px)`,
          cursor: 'grab',
          touchAction: 'none',
        }}
      />
      {state === 'loading' ? <span style={messageStyle}>Loading model</span> : null}
      {state === 'error' ? <span style={messageStyle}>This model could not be loaded.</span> : null}
    </>
  );
}
