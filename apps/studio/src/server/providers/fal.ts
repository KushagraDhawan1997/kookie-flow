/**
 * fal, through its queue.
 *
 * Every request is submitted to `queue.fal.run` and answered later: the submission returns the
 * three URLs to ask about it, and those go on the row, so a status check or a cancel needs
 * nothing but the row — not the process that submitted it, not the tab. The key never leaves the
 * server. A webhook is not used: dev has no public URL, and a poll from whoever next asks does
 * the same work a little later.
 *
 * A picture the node holds is on this server, which fal cannot reach. It is uploaded to fal's own
 * storage first and the URL that gives back goes in the request; the URL is remembered per hash
 * for the life of the process, so the same picture through five nodes is sent once.
 */

import type { MediaRef } from 'studio-core';
import { getStorage } from '../storage';
import { FAL_TASKS } from './fal-tasks';
import { JobFailed, type Provider, type ProviderJob, type ProviderStatus } from './provider';

const QUEUE = 'https://queue.fal.run';
const REST = 'https://rest.fal.ai';
/** fal's single-request upload limit; a picture is far under it. */
const UPLOAD_LIMIT = 90 * 1024 * 1024;

function key(): string {
  const stated = process.env.FAL_KEY?.trim();
  if (!stated) throw new JobFailed('FAL_KEY is not set');
  return stated;
}

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Key ${key()}`, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** fal's error bodies: a string `detail`, or a list of field errors with a `msg` each. */
function detail(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object') {
    const d = (body as { detail?: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      const msgs = d.map((e) =>
        e && typeof e === 'object' && 'msg' in e ? String(e.msg) : String(e)
      );
      if (msgs.length) return msgs.join('; ');
    }
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return fallback;
}

/**
 * One call to fal. A 4xx is fal's judgement on the request and ends the job; a 5xx or a fault on
 * the way is not, and is thrown plainly so the caller tries again later.
 */
async function call(
  url: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<Record<string, unknown>> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...headers(json !== undefined), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body: unknown = await res.json().catch(() => null);
  if (res.ok)
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const message = detail(body, `fal answered ${res.status}`);
  if (res.status >= 400 && res.status < 500) throw new JobFailed(message);
  throw new Error(message);
}

interface Urls {
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

function urls(job: ProviderJob): Urls {
  const s = job.state ?? {};
  const { statusUrl, responseUrl, cancelUrl } = s;
  if (
    typeof statusUrl !== 'string' ||
    typeof responseUrl !== 'string' ||
    typeof cancelUrl !== 'string'
  ) {
    throw new JobFailed('the request was never submitted to fal');
  }
  return { statusUrl, responseUrl, cancelUrl };
}

/** Bytes for a picture this server holds: its stored file, or the data URL it came with. */
async function readMedia(url: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const head = url.slice(5, comma);
    if (comma < 0 || !head.endsWith(';base64'))
      throw new JobFailed('the picture is a data URL that is not base64');
    const buffer = Buffer.from(url.slice(comma + 1), 'base64');
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return { bytes, mime: head.slice(0, -';base64'.length) || 'application/octet-stream' };
  }
  const match = /^\/api\/blob\/([^/?#]+)$/.exec(url);
  const stored = match ? await getStorage().open(match[1]) : null;
  if (!stored) throw new JobFailed(`the picture at ${url} is not in storage`);
  const bytes = new Uint8Array(await new Response(stored.body()).arrayBuffer());
  return { bytes, mime: stored.mime };
}

const uploaded = new Map<string, Promise<string>>();

async function upload(ref: MediaRef): Promise<string> {
  const url = ref.url;
  if (!url) throw new JobFailed(`the ${ref.kind} has no bytes to send`);
  if (/^https?:\/\//.test(url)) return url;
  const { bytes, mime } = await readMedia(url);
  if (bytes.byteLength > UPLOAD_LIMIT)
    throw new JobFailed('the picture is too large to send to fal');
  const init = await call(`${REST}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: 'POST',
    json: { content_type: mime, file_name: `${ref.hash}.${mime.split('/')[1] ?? 'bin'}` },
  });
  const { upload_url: uploadUrl, file_url: fileUrl } = init;
  if (typeof uploadUrl !== 'string' || typeof fileUrl !== 'string')
    throw new Error('fal gave no upload URL');
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'Content-Type': mime },
  });
  if (!put.ok) throw new Error(`upload to fal answered ${put.status}`);
  return fileUrl;
}

/** The same picture is sent once per process, and a failed send is forgotten so it can be retried. */
function mediaUrl(ref: MediaRef): Promise<string> {
  let pending = uploaded.get(ref.hash);
  if (!pending) {
    pending = upload(ref);
    pending.catch(() => uploaded.delete(ref.hash));
    uploaded.set(ref.hash, pending);
  }
  return pending;
}

export const falProvider: Provider = {
  id: 'fal',

  model: (task, input) => FAL_TASKS[task]?.endpoint(input),

  async submit(job) {
    const task = FAL_TASKS[job.task];
    if (!task) throw new JobFailed(`fal cannot run ${job.task}`);
    const body = await task.body(job.input, mediaUrl);
    const res = await call(`${QUEUE}/${job.model}`, { method: 'POST', json: body });
    const {
      request_id: requestId,
      status_url: statusUrl,
      response_url: responseUrl,
      cancel_url: cancelUrl,
    } = res;
    if (
      typeof requestId !== 'string' ||
      typeof statusUrl !== 'string' ||
      typeof responseUrl !== 'string'
    ) {
      throw new Error('fal accepted the request without saying where to ask about it');
    }
    return {
      providerId: requestId,
      state: { statusUrl, responseUrl, cancelUrl: cancelUrl ?? null },
    };
  },

  async status(job): Promise<ProviderStatus> {
    const res = await call(urls(job).statusUrl);
    if (res.status === 'COMPLETED') {
      // A request that failed on fal's side also completes; the error rides on the status.
      return typeof res.error === 'string'
        ? { kind: 'failed', error: res.error }
        : { kind: 'done' };
    }
    if (res.status === 'IN_PROGRESS') return { kind: 'running' };
    return {
      kind: 'queued',
      position: typeof res.queue_position === 'number' ? res.queue_position : undefined,
    };
  },

  async result(job) {
    const task = FAL_TASKS[job.task];
    if (!task) throw new JobFailed(`fal cannot run ${job.task}`);
    const res = await call(urls(job).responseUrl);
    if (typeof res.error === 'string') throw new JobFailed(res.error);
    return { files: task.files(res, job.input) };
  },

  async cancel(job) {
    const { cancelUrl } = urls(job);
    // Already finished is not a failure to cancel.
    await call(cancelUrl, { method: 'PUT' }).catch((error: unknown) => {
      if (!(error instanceof JobFailed)) throw error;
    });
  },
};
