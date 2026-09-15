/**
 * The ports a node's `run` can reach, as this app provides them. Assets and jobs are real; the
 * GPU and media ports say so when asked.
 */

import { NotAvailableError, type MediaRef, type Ports } from 'studio-core';
import { announceBalanceChange } from '@/shared/billing';
import { isPending, type JobView } from '@/shared/jobs';

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  if (!blob.type.startsWith('image/')) return { width: 0, height: 0 };
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** How often a pending job is asked about. A picture takes seconds, a clip minutes. */
const POLL_MS = 1500;
/**
 * Polls that may fail in a row before the job is given up on. A failed poll is not a failed job:
 * the dev server reloading, a gateway blinking. The job is on the server either way, and the
 * next ask for the same inputs finds it.
 */
const POLL_FAILURES = 5;

/** An answer from `/api/jobs` that was not a job. */
class JobRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'JobRequestError';
  }
}

async function readJob(res: Response): Promise<JobView> {
  const body = (await res.json().catch(() => null)) as (JobView & { error?: string }) | null;
  if (!res.ok || !body || typeof body.id !== 'string') {
    throw new JobRequestError(res.status, body?.error ?? `job request answered ${res.status}`);
  }
  return body;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', done);
      resolve();
    }, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Only a number the provider gave. A made-up one (a token 5% queued, 30% running) parks the ring
 * at that spot for the whole job; reporting nothing keeps the canvas's travelling arc, which says
 * "working, length unknown" truthfully.
 */
function report(job: JobView, progress?: (fraction: number) => void) {
  if (progress && job.status === 'running' && job.progress !== undefined) progress(job.progress);
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
     * Submit, then poll by id until the job settles. No request is held open while the provider
     * works, so nothing here is lost to a refresh: the server finds the same job for the same
     * inputs on the next ask, and this loop picks it up wherever it is. The signal stops the
     * waiting, not the job — a node whose inputs change mid-run leaves the job to finish, and
     * the result is there should the inputs come back.
     *
     * A restore asks the same way but submits nothing; 204 is the server saying it was never made.
     */
    async run({ entityId, task, input, restore = false, signal, progress }) {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, task, input, restore }),
        signal,
      });
      if (restore && res.status === 204) return null;
      // A submission holds against the balance and an ending charges or releases it, so the
      // balance shown is asked for again at both ends, whichever way the job goes.
      try {
        let job = await readJob(res);
        if (!restore) announceBalanceChange();
        report(job, progress);

        let failures = 0;
        while (isPending(job.status)) {
          await sleep(POLL_MS, signal);
          try {
            job = await readJob(await fetch(`/api/jobs/${job.id}`, { signal }));
            failures = 0;
          } catch (error) {
            // Gone for good, or asked to stop: say so. Otherwise it is a blip until it is not.
            const gone = error instanceof JobRequestError && error.status < 500;
            if (signal.aborted || gone || ++failures >= POLL_FAILURES) throw error;
          }
          report(job, progress);
        }

        if (job.status !== 'succeeded' || !job.output)
          throw new Error(job.error ?? `job ${job.status}`);
        // No closing progress(1): the engine's success hold completes the ring either way, and a 1
        // after an arc would jump it to a full ring for a frame.
        return { output: job.output, cost: job.cost };
      } finally {
        announceBalanceChange();
      }
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
      return {
        kind,
        hash: body.hash,
        width,
        height,
        url: body.url,
        preview: body.url,
        mime: body.mime,
      };
    },
  },
};
