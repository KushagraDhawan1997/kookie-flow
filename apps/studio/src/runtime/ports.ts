/**
 * The ports a node's `run` can reach, as this app provides them. Phase 1: assets are real, the
 * GPU, media and job ports say so when asked.
 */

import { NotAvailableError, type MediaRef, type Ports } from 'studio-core';

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  if (!blob.type.startsWith('image/')) return { width: 0, height: 0 };
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export const ports: Ports = {
  gpu: {
    run: () => Promise.reject(new NotAvailableError('GPU processing')),
    load: () => Promise.reject(new NotAvailableError('GPU processing')),
  },
  media: {
    notYet: () => {
      throw new NotAvailableError('video processing');
    },
  },
  jobs: {
    /**
     * Submit and wait. The route answers when the job is done, so there is nothing to poll yet —
     * a real provider will need that, and the signal is already wired for the cancel it brings.
     */
    async run({ entityId, model, input, signal, progress }) {
      progress?.(0.1);
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, model, input }),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`job failed: ${detail || res.status}`);
      }
      const body = (await res.json()) as { output: Record<string, unknown>; cost?: number };
      progress?.(1);
      return { output: body.output, cost: body.cost };
    },
  },
  assets: {
    async put(blob, kind = blob.type.startsWith('video/') ? 'video' : 'image'): Promise<MediaRef> {
      const { width, height } = await measure(blob);
      const form = new FormData();
      form.set('file', blob);
      form.set('width', String(width));
      form.set('height', String(height));
      const res = await fetch('/api/assets', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload failed: ${await res.text()}`);
      const body = (await res.json()) as { hash: string; url: string; mime: string };
      return { kind, hash: body.hash, width, height, url: body.url, preview: body.url, mime: body.mime };
    },
  },
};
