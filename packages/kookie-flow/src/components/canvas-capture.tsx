/**
 * The canvas, as a picture.
 *
 * Rendered by the canvas's own framebuffer at the export's resolution, and read back in the same
 * task: the browser composites only after the task ends, so the drawing buffer is still intact
 * without `preserveDrawingBuffer`, which would cost every frame of every session for a feature
 * used once.
 *
 * Not into a render target, which is what this did first, and which cannot match the screen.
 * Three renders every non-XR target in LINEAR output. In a plain target the materials that encode
 * for the screen (media quads, ink) come out dark; in an sRGB target the GPU encodes the
 * ShaderMaterials that already write screen values, and they come out washed out. The screen's
 * framebuffer is the one every layer is written for, so the export is rendered there.
 *
 * The buffer is resized for the capture, put back, and the frame repainted at its normal size
 * before the task ends, so no frame is ever composited at the wrong size or empty.
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

  useEffect(() => {
    registerCapture(store, (options: CaptureOptions = {}) => {
      const pixelRatio = Math.max(0.1, Math.min(options.pixelRatio ?? 2, 8));
      const context = gl.getContext();
      const previousRatio = gl.getPixelRatio();
      const previousTarget = gl.getRenderTarget();
      const previousAlpha = gl.getClearAlpha();
      const previousColor = new THREE.Color();
      gl.getClearColor(previousColor);

      try {
        gl.setRenderTarget(null);
        gl.setPixelRatio(pixelRatio);
        // What the browser granted, not what was asked: a buffer past its limit is clamped
        // silently, and reading the asked-for size would read past the buffer's edge.
        const width = context.drawingBufferWidth;
        const height = context.drawingBufferHeight;
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
        context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const image = ctx.createImageData(width, height);
        const out = image.data;
        // GL reads bottom-up; a PNG is written top-down, so the rows are copied in reverse.
        const rowBytes = width * 4;
        for (let y = 0; y < height; y++) {
          out.set(pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
        }
        // Blending over a transparent clear leaves colour multiplied by its alpha, and ImageData
        // is straight alpha. Unmultiplied here, or every translucent pixel — grid dots, glow, every
        // antialiased edge — exports darker than it draws.
        for (let i = 0; i < out.length; i += 4) {
          const a = out[i + 3];
          if (a === 0 || a === 255) continue;
          const k = 255 / a;
          out[i] = Math.min(255, Math.round(out[i] * k));
          out[i + 1] = Math.min(255, Math.round(out[i + 1] * k));
          out[i + 2] = Math.min(255, Math.round(out[i + 2] * k));
        }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL(options.type ?? 'image/png');
      } finally {
        gl.setPixelRatio(previousRatio);
        gl.setClearColor(previousColor, previousAlpha);
        // The resize cleared the visible buffer. Painted again inside this task, or the next
        // composite shows an empty canvas until something else asks for a frame.
        gl.render(scene, camera);
        gl.setRenderTarget(previousTarget);
      }
    });
    return () => registerCapture(store, null);
  }, [store, gl, scene, camera]);

  return null;
}
