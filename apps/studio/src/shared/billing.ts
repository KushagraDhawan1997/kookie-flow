/**
 * The balance as the browser sees it: the wire shape of `/api/billing`, and the event that says
 * it is worth asking for again.
 */

import type { LedgerKind } from '@/server/db/schema';

/** Dispatched on `window` when something may have moved the balance: a run held, charged or released. */
export const BALANCE_CHANGED = 'studio:balance-changed';

export function announceBalanceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BALANCE_CHANGED));
}

/** The top-up amounts offered, in whole US dollars. */
export const TOP_UP_DOLLARS = [5, 10, 25] as const;

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amountMicros: number;
  note: string | null;
  jobId: string | null;
  createdAt: string;
  /** For a run's rows: what ran, and the price split the fee was added to. */
  run: { label: string; model: string; modelMicros: number | null; feeMicros: number | null } | null;
}

export interface BillingView {
  enabled: boolean;
  balanceMicros: number;
  /** The service fee as a fraction of the model price, shown wherever a price is. */
  markup: number;
  entries: LedgerEntry[];
}
