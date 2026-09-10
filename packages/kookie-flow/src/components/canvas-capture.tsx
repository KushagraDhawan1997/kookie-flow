/**
 * The canvas, as a picture.
 *
 * Rendered into a target of its own rather than read off the visible canvas. Two reasons, and
 * both are the difference between working and mostly working:
 *
 *   `toDataURL` on a WebGL canvas returns a blank image unless the context was created with
 *   `preserveDrawingBuffer`, which costs every frame of every session for a feature used once.
 *
 *   A target has a resolution of its own, so an export can be twice the size of the window
 *   without the window ever changing size — no resize, no reflow, no frame where the board is
 *   the wrong shape.
 *
 * What comes out is what is on screen: the same camera, the same viewport. Fit the view first if
 * the whole graph is wanted; `fitView()` and this compose.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { registerCapture, type CaptureOptions } from '../utils/canvas-runtime';

export function CanvasCapture() {
  const store = useFlowStoreApi();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    registerCapture(store, (options: CaptureOptions = {}) => {
      const pixelRatio = Math.max(0.1, Math.min(options.pixelRatio ?? 2, 8));
      const width = Math.max(1, Math.round(size.width * pixelRatio));
      const height = Math.max(1, Math.round(size.height * pixelRatio));

      const target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.texture.colorSpace = THREE.SRGBColorSpace;

      const previousTarget = gl.getRenderTarget();
      const previousAlpha = gl.getClearAlpha();
      const previousColor = new THREE.Color();
      gl.getClearColor(previousColor);

      try {
        gl.setRenderTarget(target);
        if (options.background) {
          gl.setClearColor(new THREE.Color(options.background), 1);
        } else {
          // Transparent by default: a graph dropped into a document should carry the document's
          // paper, not this canvas's.
          gl.setClearColor(0x000000, 0);
        }
        gl.clear(true, true, false);
        gl.render(scene, camera);

        const pixels = new Uint8Array(width * height * 4);
        gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const image = ctx.createImageData(width, height);
        // GL reads bottom-up; a PNG is written top-down, so the rows are copied in reverse.
        const rowBytes = width * 4;
        for (let y = 0; y < height; y++) {
          const from = (height - 1 - y) * rowBytes;
          image.data.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
        }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL(options.type ?? 'image/png');
      } finally {
        gl.setRenderTarget(previousTarget);
        gl.setClearColor(previousColor, previousAlpha);
        target.dispose();
      }
    });
    return () => registerCapture(store, null);
  }, [store, gl, scene, camera, size.width, size.height]);

  return null;
}
