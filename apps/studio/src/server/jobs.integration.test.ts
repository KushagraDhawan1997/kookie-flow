/**
 * The pipeline end to end on a throwaway database, with the mock provider and a short delay: an
 * ask becomes a row, the same ask finds it, a poll finishes it into storage, and a failed or
 * cancelled row does not answer the next ask. Runs from `apps/studio`, where the migrations and
 * the mock's files are.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isMediaRef } from 'studio-core';
import { BadJobRequest, cancel, findJob, findOrSubmit, getJob, refresh } from './jobs';

const DELAY = 400;
let dataDir: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-jobs-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_PROVIDER = 'mock';
  process.env.STUDIO_MOCK_DELAY_MS = String(DELAY);
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('the job pipeline', () => {
  it('submits, is found again by the same ask, and is finished by a poll into storage', async () => {
    const ask = {
      task: 'gpt-image-2.5',
      input: { prompt: 'a fox', variant: 'flare', seed: 1 },
      nodeId: 'n1',
    };
    const row = await findOrSubmit(ask);
    expect(row.status).toBe('queued');
    expect(row.provider).toBe('mock');
    expect(row.task).toBe('gpt-image-2.5');
    expect(row.providerId).toBe(`mock-${row.id}`);
    expect(row.key).toMatch(/^[0-9a-f]{64}$/);

    // The same inputs in another order are the same ask.
    const again = await findOrSubmit({
      task: 'gpt-image-2.5',
      input: { seed: 1, variant: 'flare', prompt: 'a fox' },
    });
    expect(again.id).toBe(row.id);

    const early = await refresh(row);
    expect(['queued', 'running']).toContain(early.row.status);

    await sleep(DELAY + 50);
    const done = await refresh(row);
    expect(done.row.status).toBe('succeeded');
    const image = done.row.output?.image;
    expect(isMediaRef(image)).toBe(true);
    if (!isMediaRef(image)) return;
    // The photograph's own size and type, read from its bytes, and its file in the store.
    expect(image).toMatchObject({ kind: 'image', width: 3999, height: 2896, mime: 'image/jpeg' });
    expect(image.url).toBe(`/api/blob/${image.hash}.jpg`);
    await expect(fs.stat(path.join(dataDir, 'blobs', `${image.hash}.jpg`))).resolves.toBeTruthy();

    // Finished, it still answers the same ask, with its output.
    const found = await findOrSubmit(ask);
    expect(found.id).toBe(row.id);
    expect(found.status).toBe('succeeded');

    // Another seed is another ask.
    const other = await findOrSubmit({
      task: 'gpt-image-2.5',
      input: { prompt: 'a fox', variant: 'flare', seed: 2 },
    });
    expect(other.id).not.toBe(row.id);
  });

  it('gives a clip its size and length from the file', async () => {
    const row = await findOrSubmit({ task: 'wan-i2v', input: { prompt: 'pan', seed: 3 } });
    await sleep(DELAY + 50);
    const { row: done } = await refresh(row);
    expect(done.status).toBe('succeeded');
    const video = done.output?.video;
    expect(isMediaRef(video)).toBe(true);
    if (!isMediaRef(video)) return;
    expect(video).toMatchObject({ kind: 'video', width: 2560, height: 1440, mime: 'video/mp4' });
    expect(video.duration).toBeCloseTo(17.95, 1);
  });

  it('does not answer an ask from a cancelled row', async () => {
    const ask = { task: 'clarity-upscaler', input: { factor: 2, seed: 4 } };
    const row = await findOrSubmit(ask);
    const stopped = await cancel(row);
    expect(stopped.status).toBe('cancelled');
    expect((await getJob(row.id))?.status).toBe('cancelled');
    const next = await findOrSubmit(ask);
    expect(next.id).not.toBe(row.id);
    expect(next.status).toBe('queued');
  });

  it('records a submission the provider refused as a failed row, which the next ask does not reuse', async () => {
    process.env.STUDIO_PROVIDER = 'fal';
    try {
      const ask = { task: 'gpt-image-2.5', input: { prompt: 'a fox', seed: 5 } };
      const row = await findOrSubmit(ask);
      expect(row.status).toBe('failed');
      expect(row.error).toBe('FAL_KEY is not set');
      expect(row.model).toBe('openai/gpt-image-2.5/flare/text-to-image');
      const retry = await findOrSubmit(ask);
      expect(retry.id).not.toBe(row.id);
    } finally {
      process.env.STUDIO_PROVIDER = 'mock';
    }
  });

  it('finds an ask already made, and never submits one that was not', async () => {
    const ask = { task: 'gpt-image-2.5', input: { prompt: '', seed: 6 } };
    expect(await findJob(ask)).toBeNull();
    // Asking again still finds nothing: the look made no row.
    expect(await findJob(ask)).toBeNull();
    const row = await findOrSubmit(ask);
    expect((await findJob(ask))?.id).toBe(row.id);
  });

  it('refuses a task nobody can run', async () => {
    await expect(findOrSubmit({ task: 'make-coffee', input: {} })).rejects.toBeInstanceOf(
      BadJobRequest
    );
  });
});
