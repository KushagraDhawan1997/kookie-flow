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
  var bitmap = null;
  try {
    bitmap = createImageBitmap(blob);
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
    bitmap = null; // Ownership moved to the main thread.
  } catch (err) {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
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

/** Infrastructure failure: the caller may retry this image on the main thread. */
export class WorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

type DecodeMessage =
  ({ id: number; ok: true } & DecodeResult) | { id: number; ok: false; error: string };

/**
 * Manages a single persistent Web Worker for off-thread image decoding.
 * Single worker (not pool) — createImageBitmap is internally parallelized by the browser.
 */
export class ImageDecodeWorker {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  /** A failed or disposed worker is never restarted by this facade. */
  private terminalError: Error | null = null;

  /**
   * Check synchronous construction failure. Startup can still fail asynchronously (for example
   * when CSP blocks the script); the error handlers settle all pending decodes in that case.
   */
  tryStart(): boolean {
    try {
      this.getWorker();
      return true;
    } catch {
      return false;
    }
  }

  private getWorker(): Worker {
    if (this.terminalError) throw this.terminalError;
    if (!this.worker) {
      const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
      let url: string | undefined;
      try {
        url = URL.createObjectURL(blob);
        this.worker = new Worker(url);
        this.worker.onmessage = this.handleMessage;
        this.worker.onerror = this.handleError;
        this.worker.onmessageerror = this.handleMessageError;
      } catch (error) {
        throw this.fail(`Image decode worker could not start: ${String(error)}`);
      } finally {
        // Also revoke when construction throws, otherwise blocked workers leak their source Blob.
        if (url !== undefined) URL.revokeObjectURL(url);
      }
    }
    return this.worker;
  }

  private handleMessage = (e: MessageEvent<DecodeMessage>): void => {
    const data = e.data;
    const entry = this.pending.get(data.id);
    if (!entry) {
      // A transferred reply may already be queued when disposal or an error rejects its request.
      if (data.ok) data.bitmap.close();
      return;
    }
    this.pending.delete(data.id);

    if (data.ok) {
      entry.resolve({
        bitmap: data.bitmap,
        naturalWidth: data.naturalWidth,
        naturalHeight: data.naturalHeight,
      });
    } else {
      // A malformed image does not mean the worker itself is unusable.
      entry.reject(new Error(data.error));
    }
  };

  private handleError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.fail(event.message || 'Image decode worker failed to start or run');
  };

  private handleMessageError = (): void => {
    this.fail('Image decode worker returned an unreadable message');
  };

  private fail(message: string): Error {
    const error = this.terminalError ?? new WorkerUnavailableError(message);
    this.stop(error);
    return error;
  }

  private stop(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

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
      try {
        this.getWorker().postMessage({ id, maxDim, blob });
      } catch (error) {
        // Unlike a failed-image reply, posting or constructing failed before a reply was possible.
        this.fail(`Image decode worker could not accept a request: ${String(error)}`);
        // A terminal facade already cleared its queue; a later decode must still reject itself.
        this.pending.delete(id);
        reject(this.terminalError ?? error);
      }
    });
  }

  dispose(): void {
    this.stop(new Error('Image decode worker disposed'));
  }
}
