/**
 * Inline Web Worker for image decoding.
 *
 * Performs createImageBitmap + resize entirely off the main thread.
 * ImageBitmap is transferred back (zero-copy via Transferable).
 *
 * Why inline (blob URL)? tsup has no built-in worker bundling, and an inline
 * worker avoids requiring library consumers to configure worker file serving.
 * The source is plain JS — no imports, no module syntax.
 */

const WORKER_SOURCE = /* js */ `
'use strict';

async function decode(id, maxDim, blob) {
  try {
    var bitmap = createImageBitmap(blob);
    bitmap = await bitmap;
    var naturalWidth = bitmap.width;
    var naturalHeight = bitmap.height;

    if (bitmap.width > maxDim || bitmap.height > maxDim) {
      var scale = maxDim / Math.max(bitmap.width, bitmap.height);
      var tw = Math.round(bitmap.width * scale);
      var th = Math.round(bitmap.height * scale);
      var resized = await createImageBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, {
        resizeWidth: tw,
        resizeHeight: th,
        resizeQuality: 'medium'
      });
      if (resized !== bitmap) bitmap.close();
      bitmap = resized;
    }

    self.postMessage(
      { id: id, ok: true, bitmap: bitmap, naturalWidth: naturalWidth, naturalHeight: naturalHeight },
      [bitmap]
    );
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: (err && err.message) || 'decode failed' });
  }
}

self.onmessage = function(e) {
  var d = e.data;
  decode(d.id, d.maxDim, d.blob);
};
`;

export interface DecodeResult {
  bitmap: ImageBitmap;
  naturalWidth: number;
  naturalHeight: number;
}

interface PendingRequest {
  resolve: (result: DecodeResult) => void;
  reject: (error: Error) => void;
}

/**
 * Manages a single persistent Web Worker for off-thread image decoding.
 * Single worker (not pool) — createImageBitmap is internally parallelized by the browser.
 */
export class ImageDecodeWorker {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();

  private getWorker(): Worker {
    if (!this.worker) {
      const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this.worker = new Worker(url);
      URL.revokeObjectURL(url); // Safe to revoke after Worker constructor
      this.worker.onmessage = this.handleMessage;
    }
    return this.worker;
  }

  private handleMessage = (e: MessageEvent): void => {
    const { id, ok, bitmap, naturalWidth, naturalHeight, error } = e.data;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);

    if (ok) {
      entry.resolve({ bitmap, naturalWidth, naturalHeight });
    } else {
      entry.reject(new Error(error));
    }
  };

  /**
   * Decode and optionally resize an image off-thread.
   * @param maxDim — Maximum dimension on longest side. Pass Infinity to skip resize.
   * @param blob — Image data to decode.
   * @returns Transferred ImageBitmap + natural dimensions of the original image.
   */
  decode(maxDim: number, blob: Blob): Promise<DecodeResult> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.getWorker().postMessage({ id, maxDim, blob });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Worker disposed'));
    }
    this.pending.clear();
  }
}
