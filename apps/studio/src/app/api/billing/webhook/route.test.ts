/**
 * The webhook on a throwaway database: an unsigned or forged delivery changes nothing, a signed
 * paid top-up credits the amount chosen (not the total with tax), and Stripe's retry credits nothing
 * more.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceMicros } from '@/server/billing';
import { getDb } from '@/server/db';
import { POST } from './route';

const SECRET = 'whsec_test_secret';
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-webhook-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_used_for_verification';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function completed(session: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', ...session } },
  });
}

async function deliver(payload: string, signature: string | null): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature) headers.set('stripe-signature', signature);
  return POST(new Request('http://127.0.0.1:3002/api/billing/webhook', { method: 'POST', headers, body: payload }));
}

const sign = (payload: string, secret = SECRET) =>
  new Stripe('sk_test_x').webhooks.generateTestHeaderStringAsync({ payload, secret });

const paid = completed({
  id: 'cs_test_paid',
  payment_status: 'paid',
  amount_total: 605,
  metadata: { purpose: 'studio-topup', workspaceId: 'ws-1', amountCents: '500' },
});

describe('the Stripe webhook', () => {
  it('refuses a delivery with no signature or a forged one, and credits nothing', async () => {
    expect((await deliver(paid, null)).status).toBe(400);
    expect((await deliver(paid, await sign(paid, 'whsec_wrong'))).status).toBe(400);
    expect(await balanceMicros(await getDb(), 'ws-1')).toBe(0);
  });

  it('credits the amount chosen, once, however often Stripe retries', async () => {
    expect((await deliver(paid, await sign(paid))).status).toBe(200);
    expect((await deliver(paid, await sign(paid))).status).toBe(200);
    expect(await balanceMicros(await getDb(), 'ws-1')).toBe(5_000_000);
  });

  it('ignores a session that is unpaid or not a top-up', async () => {
    const unpaid = completed({
      id: 'cs_test_unpaid',
      payment_status: 'unpaid',
      metadata: { purpose: 'studio-topup', workspaceId: 'ws-2', amountCents: '500' },
    });
    const other = completed({ id: 'cs_test_other', payment_status: 'paid', metadata: { workspaceId: 'ws-2' } });
    expect((await deliver(unpaid, await sign(unpaid))).status).toBe(200);
    expect((await deliver(other, await sign(other))).status).toBe(200);
    expect(await balanceMicros(await getDb(), 'ws-2')).toBe(0);
  });
});
