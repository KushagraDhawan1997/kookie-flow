/**
 * Money end to end on a throwaway database, with the mock provider and a short delay: a run holds
 * before it spends, a finished run is charged its real price exactly once, every other ending gives
 * the hold back, a balance that cannot cover a run refuses it with nothing written, and a top-up
 * delivered twice credits once.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actualModelMicros, estimateModelMicros, withFee } from 'studio-core';
import { balanceMicros, InsufficientBalance, topUp } from './billing';
import { getDb } from './db';
import { cancel, findJob, findOrSubmit, refresh } from './jobs';

const DELAY = 300;
const WS = 'ws-billing';
let dataDir: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-billing-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_PROVIDER = 'mock';
  process.env.STUDIO_MOCK_DELAY_MS = String(DELAY);
  process.env.STUDIO_BILLING = 'on';
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

const ask = (seed: number) => ({
  task: 'gpt-image-2.5',
  input: { prompt: 'a fox', size: 'square_hd', quality: 'medium', seed },
});

describe('billing', () => {
  it('refuses a run the balance cannot cover, and writes nothing', async () => {
    await expect(findOrSubmit(ask(1), WS)).rejects.toBeInstanceOf(InsufficientBalance);
    expect(await findJob(ask(1), WS)).toBeNull();
    expect(await balanceMicros(await getDb(), WS)).toBe(0);
  });

  it('credits a top-up once, however many times it is delivered', async () => {
    const db = await getDb();
    const top = { workspaceId: WS, sessionId: 'cs_test_1', amountMicros: 1_000_000 };
    expect(await topUp(db, top)).toBe(true);
    expect(await topUp(db, top)).toBe(false);
    expect(await balanceMicros(db, WS)).toBe(1_000_000);
  });

  it('holds on submit, holds nothing for the same ask, and charges the real price once', async () => {
    const db = await getDb();
    const held = withFee(estimateModelMicros('gpt-image-2.5', ask(2).input) ?? 0);

    const row = await findOrSubmit(ask(2), WS);
    expect(row.billing).toBe('held');
    expect(row.holdMicros).toBe(held.total);
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - held.total);

    const again = await findOrSubmit(ask(2), WS);
    expect(again.id).toBe(row.id);
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - held.total);

    await sleep(DELAY + 50);
    const { row: done } = await refresh(row);
    expect(done.status).toBe('succeeded');
    expect(done.billing).toBe('charged');
    const charged = withFee(actualModelMicros('gpt-image-2.5', ask(2).input, done.output) ?? 0);
    expect(done.modelMicros).toBe(charged.model);
    expect(done.feeMicros).toBe(charged.fee);
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - charged.total);

    // A second poll of a finished job does not charge again.
    await refresh(done);
    await refresh(row);
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - charged.total);
  });

  it('gives the hold back when a run is cancelled or refused', async () => {
    const db = await getDb();
    const before = await balanceMicros(db, WS);

    const row = await findOrSubmit(ask(3), WS);
    expect(await balanceMicros(db, WS)).toBeLessThan(before);
    const stopped = await cancel(row);
    expect(stopped.billing).toBe('released');
    expect(await balanceMicros(db, WS)).toBe(before);

    process.env.STUDIO_PROVIDER = 'fal';
    try {
      const refused = await findOrSubmit(ask(4), WS);
      expect(refused.status).toBe('failed');
      expect(refused.billing).toBe('released');
    } finally {
      process.env.STUDIO_PROVIDER = 'mock';
    }
    expect(await balanceMicros(db, WS)).toBe(before);
  });

  it('keeps each workspace’s balance to itself', async () => {
    expect(await balanceMicros(await getDb(), 'someone-else')).toBe(0);
    await expect(findOrSubmit(ask(5), 'someone-else')).rejects.toBeInstanceOf(InsufficientBalance);
  });
});
