/**
 * The jobs port against a scripted `/api/jobs`: it submits once, polls until the job settles,
 * rides out a blip, and stops on what it cannot ride out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ports } from './ports';

type Answer = { status: number; body: unknown };

/** A fetch that answers from a script, one answer per call, and records what was asked. */
function scripted(answers: Answer[]) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    if (init?.signal?.aborted) throw new Error('aborted');
    const next = answers.shift();
    if (!next) throw new Error(`no answer scripted for ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

const request = (signal = new AbortController().signal, progress?: (f: number) => void) =>
  ports.jobs.run({
    entityId: 'n1',
    task: 'text-to-image',
    input: { prompt: 'x' },
    signal,
    progress,
  });

/** Let the loop reach its sleep, then step the clock past it, until the run settles. */
async function settle<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  run.then(
    () => (settled = true),
    () => (settled = true)
  );
  while (!settled) await vi.advanceTimersByTimeAsync(1500);
  return run;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the jobs port', () => {
  it('submits, polls by id until the job is done, and reports how far along it is', async () => {
    const calls = scripted([
      { status: 200, body: { id: 'j1', status: 'queued' } },
      { status: 200, body: { id: 'j1', status: 'running', progress: 0.5 } },
      {
        status: 200,
        body: { id: 'j1', status: 'succeeded', output: { image: { kind: 'image' } }, cost: 0 },
      },
    ]);
    const progress = vi.fn();
    const result = await settle(request(undefined, progress));
    expect(result).toEqual({ output: { image: { kind: 'image' } }, cost: 0 });
    expect(calls).toEqual([
      { url: '/api/jobs', method: 'POST' },
      { url: '/api/jobs/j1', method: 'GET' },
      { url: '/api/jobs/j1', method: 'GET' },
    ]);
    expect(progress.mock.calls.map((c) => c[0])).toEqual([0.05, 0.5, 1]);
  });

  it('answers at once when the server already has the result', async () => {
    const calls = scripted([
      { status: 200, body: { id: 'j2', status: 'succeeded', output: { image: 1 } } },
    ]);
    expect((await settle(request())).output).toEqual({ image: 1 });
    expect(calls).toHaveLength(1);
  });

  it('rides out a poll that fails, and gives up after five in a row', async () => {
    scripted([
      { status: 200, body: { id: 'j3', status: 'running' } },
      { status: 502, body: { error: 'gateway' } },
      { status: 200, body: { id: 'j3', status: 'succeeded', output: {} } },
    ]);
    expect((await settle(request())).output).toEqual({});

    scripted([
      { status: 200, body: { id: 'j4', status: 'running' } },
      ...Array.from({ length: 5 }, () => ({ status: 502, body: { error: 'gateway' } })),
    ]);
    await expect(settle(request())).rejects.toThrow('gateway');
  });

  it('stops at once on a job that is gone or that failed', async () => {
    const gone = scripted([
      { status: 200, body: { id: 'j5', status: 'queued' } },
      { status: 404, body: { error: 'not found' } },
    ]);
    await expect(settle(request())).rejects.toThrow('not found');
    expect(gone).toHaveLength(2);

    scripted([
      { status: 200, body: { id: 'j6', status: 'running' } },
      { status: 200, body: { id: 'j6', status: 'failed', error: 'prompt is empty' } },
    ]);
    await expect(settle(request())).rejects.toThrow('prompt is empty');
  });

  it('surfaces a refused submission with its reason', async () => {
    scripted([{ status: 400, body: { error: 'mock cannot run make-coffee' } }]);
    await expect(settle(request())).rejects.toThrow('mock cannot run make-coffee');
  });

  it('stops waiting when the signal aborts, and asks nothing more', async () => {
    const calls = scripted([{ status: 200, body: { id: 'j7', status: 'running' } }]);
    const controller = new AbortController();
    const run = request(controller.signal);
    run.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await expect(run).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });
});
