import { NextResponse } from 'next/server';
import { MARKUP } from 'studio-core';
import type { BillingView } from '@/shared/billing';
import { balanceMicros, billingEnabled, listEntries } from '@/server/billing';
import { getDb } from '@/server/db';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

/** The signed-in workspace's balance and its history, newest first. */
export async function GET() {
  const user = await currentUser();
  if (!user) return signInRequired();
  const db = await getDb();
  const view: BillingView = {
    enabled: billingEnabled(),
    balanceMicros: await balanceMicros(db, user.id),
    markup: MARKUP,
    entries: await listEntries(db, user.id),
  };
  return NextResponse.json(view);
}
