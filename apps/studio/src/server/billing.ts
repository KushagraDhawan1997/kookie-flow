/**
 * The balance: an append-only ledger in dollars, and the holds that keep a run from spending money
 * the account does not have.
 *
 * A BALANCE IS A SUM, NEVER A STORED NUMBER. Every change is a row — a top-up, a hold taken when a
 * run is submitted, the hold released when it ends, the charge for what it made — so the history
 * explains the balance line by line and nothing can drift out of step with it.
 *
 * A RUN HOLDS BEFORE IT SPENDS. The estimate plus the fee is held in the same transaction that
 * writes the job row, under a per-workspace lock, so two runs submitted at once cannot both pass on
 * the same dollars. When the job ends the hold is released and, if it made something, the real
 * price is charged. The job row's `billing` goes `held` → `charged` or `released` exactly once: the
 * move is a conditional update, so two polls that see the same ending settle it once.
 *
 * On when there is a Stripe key (or `STUDIO_BILLING=on`); off for a self-host paying its own
 * provider bill, where there is nobody to charge.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { actualModelMicros, formatUsd, registry, TASK_BY_NODE_TYPE, withFee, type Charge } from 'studio-core';
import type { Db } from './db';
import { jobs, ledger, type JobRow, type LedgerKind } from './db/schema';

export function billingEnabled(): boolean {
  const stated = process.env.STUDIO_BILLING;
  if (stated === 'on') return true;
  if (stated === 'off') return false;
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** A run that would spend more than the balance holds. Answered as 402, and shown on the node. */
export class InsufficientBalance extends Error {
  constructor(
    readonly needed: number,
    readonly balance: number
  ) {
    super(
      `Not enough balance: this run needs ${formatUsd(needed)} and you have ${formatUsd(balance)}. Add funds to run it.`
    );
    this.name = 'InsufficientBalance';
  }
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function entryId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export async function balanceMicros(db: Db | Tx, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledger.amountMicros}), 0)` })
    .from(ledger)
    .where(eq(ledger.workspaceId, workspaceId));
  return Number(row?.total ?? 0);
}

/**
 * Hold `charge.total` for a job, inside the caller's transaction, or throw. The advisory lock
 * serialises holds per workspace until the transaction ends, so the balance read and the hold
 * written are one decision.
 */
export async function hold(tx: Tx, workspaceId: string, jobId: string, charge: Charge): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
  const balance = await balanceMicros(tx, workspaceId);
  if (balance < charge.total) throw new InsufficientBalance(charge.total, balance);
  await tx.insert(ledger).values({
    id: entryId(),
    workspaceId,
    kind: 'hold',
    amountMicros: -charge.total,
    jobId,
    note: `Held for a run: model ${formatUsd(charge.model)} + fee ${formatUsd(charge.fee)}`,
  });
}

/**
 * End a held job's billing: release the hold, and charge the real price if it made something.
 * A job not holding anything is returned as it is.
 */
export async function settle(db: Db, row: JobRow): Promise<JobRow> {
  if (row.billing !== 'held') return row;
  const succeeded = row.status === 'succeeded';
  if (!succeeded && row.status !== 'failed' && row.status !== 'cancelled') return row;

  const price =
    succeeded && row.task ? withFee(actualModelMicros(row.task, row.input, row.output) ?? 0) : null;

  return db.transaction(async (tx) => {
    const [moved] = await tx
      .update(jobs)
      .set(
        price
          ? { billing: 'charged', modelMicros: price.model, feeMicros: price.fee }
          : { billing: 'released' }
      )
      .where(and(eq(jobs.id, row.id), eq(jobs.billing, 'held')))
      .returning();
    // Someone else settled it first; theirs stands.
    if (!moved) {
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, row.id)).limit(1);
      return current ?? row;
    }
    const entries: Array<typeof ledger.$inferInsert> = [
      {
        id: entryId(),
        workspaceId: row.workspaceId,
        kind: 'release',
        amountMicros: moved.holdMicros ?? 0,
        jobId: row.id,
        note: succeeded ? 'Hold released' : `Hold released: the run ${row.status}`,
      },
    ];
    if (price) {
      entries.push({
        id: entryId(),
        workspaceId: row.workspaceId,
        kind: 'charge',
        amountMicros: -price.total,
        jobId: row.id,
        note: `${row.task}: model ${formatUsd(price.model)} + fee ${formatUsd(price.fee)}`,
      });
    }
    await tx.insert(ledger).values(entries);
    return moved;
  });
}

/**
 * Add a paid top-up. Keyed by the Stripe Checkout session, so the webhook arriving twice credits
 * once. True when this call credited it.
 */
export async function topUp(
  db: Db,
  top: { workspaceId: string; sessionId: string; amountMicros: number }
): Promise<boolean> {
  const inserted = await db
    .insert(ledger)
    .values({
      id: entryId(),
      workspaceId: top.workspaceId,
      kind: 'topup',
      amountMicros: top.amountMicros,
      stripeSessionId: top.sessionId,
      note: `Added ${formatUsd(top.amountMicros)}`,
    })
    .onConflictDoNothing({ target: ledger.stripeSessionId })
    .returning({ id: ledger.id });
  return inserted.length > 0;
}

/** A task's name as the node that asks for it is called on the canvas: "GPT Image 2.5", not "gpt-image-2.5". */
const TASK_LABEL = new Map(
  Object.entries(TASK_BY_NODE_TYPE).flatMap(([type, task]) => {
    const label = registry.get(type)?.label;
    return label ? [[task, label] as const] : [];
  })
);

export interface LedgerEntryView {
  id: string;
  kind: LedgerKind;
  amountMicros: number;
  note: string | null;
  jobId: string | null;
  createdAt: string;
  run: { label: string; model: string; modelMicros: number | null; feeMicros: number | null } | null;
}

export async function listEntries(db: Db, workspaceId: string, limit = 100): Promise<LedgerEntryView[]> {
  const rows = await db
    .select({ entry: ledger, job: jobs })
    .from(ledger)
    .leftJoin(jobs, eq(jobs.id, ledger.jobId))
    .where(eq(ledger.workspaceId, workspaceId))
    .orderBy(desc(ledger.createdAt))
    .limit(limit);
  return rows.map(({ entry: r, job }) => ({
    id: r.id,
    kind: r.kind,
    amountMicros: r.amountMicros,
    note: r.note,
    jobId: r.jobId,
    createdAt: r.createdAt.toISOString(),
    run: job
      ? {
          label: (job.task && TASK_LABEL.get(job.task)) ?? job.task ?? 'Run',
          model: job.model,
          modelMicros: job.modelMicros,
          feeMicros: job.feeMicros,
        }
      : null,
  }));
}
