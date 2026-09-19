/**
 * An agent turn's money on a throwaway database: held before the model is asked, charged on the tokens
 * it used, released when it used none, settled once however often it is closed, and refused with
 * nothing written when the balance cannot cover the hold.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findAgentModel, tokenMicros, withFee } from 'studio-core';
import { balanceMicros, closeTurn, InsufficientBalance, listEntries, openTurn, topUp } from '../billing';
import { getDb } from '../db';
import { agentTurns } from '../db/schema';

const WS = 'ws-turns';
const MODEL = 'anthropic/claude-sonnet-5';
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-turns-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_BILLING = 'on';
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('agent turns', () => {
  it('holds, then charges the tokens used, once', async () => {
    const db = await getDb();
    await topUp(db, { workspaceId: WS, sessionId: 'cs_turns_1', amountMicros: 1_000_000 });
    const turn = await openTurn(db, { workspaceId: WS, graphId: 'g1', model: MODEL, estimateMicros: 100_000 });
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - withFee(100_000).total);

    const usage = { input: 20_000, output: 1_000, cacheRead: 5_000, cacheWrite: 0 };
    await closeTurn(db, turn.id, usage);
    await closeTurn(db, turn.id, usage);
    const model = findAgentModel(MODEL);
    if (!model) throw new Error('missing model');
    const charged = withFee(tokenMicros(model, usage)).total;
    expect(await balanceMicros(db, WS)).toBe(1_000_000 - charged);

    const [row] = await db.select().from(agentTurns).where(eq(agentTurns.id, turn.id));
    expect(row?.billing).toBe('charged');
    expect(row?.inputTokens).toBe(20_000);

    const entries = await listEntries(db, WS);
    const charge = entries.find((e) => e.kind === 'charge');
    expect(charge?.run?.label).toBe('Agent · Claude Sonnet 5');
    expect(charge?.jobId).toBe(turn.id);
  });

  it('releases a turn that used nothing', async () => {
    const db = await getDb();
    const before = await balanceMicros(db, WS);
    const turn = await openTurn(db, { workspaceId: WS, graphId: 'g1', model: MODEL, estimateMicros: 50_000 });
    await closeTurn(db, turn.id, null, 'failed');
    expect(await balanceMicros(db, WS)).toBe(before);
  });

  it('refuses a turn the balance cannot cover and writes nothing', async () => {
    const db = await getDb();
    const rows = (await db.select().from(agentTurns)).length;
    await expect(
      openTurn(db, { workspaceId: 'ws-empty', graphId: 'g2', model: MODEL, estimateMicros: 10_000 })
    ).rejects.toBeInstanceOf(InsufficientBalance);
    expect((await db.select().from(agentTurns)).length).toBe(rows);
  });
});
