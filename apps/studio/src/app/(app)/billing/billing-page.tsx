'use client';

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Flex,
  Heading,
  Notice,
  Page,
  SegmentedControl,
  SegmentedItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  ToolbarButton,
} from '@kushagradhawan/kookie-ui-react';
import { formatUsd } from 'studio-core';

import { TOP_UP_DOLLARS, type LedgerEntry } from '@/shared/billing';
import { startTopUp, useBilling } from '../../balance-menu';
import { EmptyState } from '../../empty-state';
import { PlusIcon } from '../../icons';
import { LocalTime } from '../../local-time';
import { AppPane } from '../app-shell';
import './billing-page.css';

/** How long to keep asking after a checkout, while Stripe's webhook is on its way. */
const CONFIRM_POLL_MS = 2000;
const CONFIRM_POLL_TRIES = 15;

const DEFAULT_TOP_UP = 10;

type Filter = 'all' | 'runs' | 'payments';

interface BillingPageProps {
  topup: string | null;
  reason: string | null;
  openAdd: boolean;
}

/**
 * The rows a person reads. A run moves the ledger up to three times — held, then released, then
 * charged — and only the charge is what it cost. So releases never show, and a hold shows only
 * while its run is still going, as the one moment the money is spoken for but not yet spent.
 */
function readableEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const settled = new Set(
    entries.flatMap((e) => ((e.kind === 'charge' || e.kind === 'release') && e.jobId ? [e.jobId] : []))
  );
  return entries.filter((e) => {
    if (e.kind === 'release') return false;
    if (e.kind === 'hold') return e.jobId !== null && !settled.has(e.jobId);
    return true;
  });
}

export function BillingPage({ topup, reason, openAdd }: BillingPageProps) {
  const { view, reload } = useBilling();
  const [problem, setProblem] = React.useState<string | null>(topup === 'failed' ? reason : null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [adding, setAdding] = React.useState(openAdd);
  const [filter, setFilter] = React.useState<Filter>('all');

  // Back from checkout: the payment is confirmed by Stripe's webhook, which can land a moment after
  // the browser does. Ask until a top-up newer than this page appears, or give up quietly.
  React.useEffect(() => {
    if (topup !== 'done') return;
    const since = Date.now() - 5 * 60_000;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      await reload();
      if (tries >= CONFIRM_POLL_TRIES) clearInterval(timer);
    }, CONFIRM_POLL_MS);
    const found = view?.entries.some((e) => e.kind === 'topup' && Date.parse(e.createdAt) > since);
    if (found) {
      setConfirmed(true);
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [topup, reload, view]);

  const markupPercent = view ? Math.round(view.markup * 100) : 50;
  const enabled = view?.enabled !== false;

  const rows = view ? readableEntries(view.entries) : [];
  const filtered = rows.filter((e) =>
    filter === 'all' ? true : filter === 'runs' ? e.jobId !== null : e.kind === 'topup' || e.kind === 'adjust'
  );

  const addCredits = enabled ? (
    <ToolbarButton emphasis="loud" tone="accent" leading={<PlusIcon />} onClick={() => setAdding(true)}>
      Add credits
    </ToolbarButton>
  ) : undefined;

  return (
    <AppPane actions={addCredits}>
      <Page
        title="Billing"
        description={`You pay what each model costs, plus ${markupPercent}%. No subscription, and your balance never expires.`}
      >
        <Stack gap="8">
          {(topup === 'done' || topup === 'cancelled' || problem) && (
            <Stack gap="3">
              {topup === 'done' && (
                <Notice tone={confirmed ? 'success' : 'neutral'}>
                  {confirmed ? 'Payment received. Your balance is updated.' : 'Payment received. Waiting for Stripe to confirm it…'}
                </Notice>
              )}
              {topup === 'cancelled' && <Notice>Checkout was cancelled. Nothing was charged.</Notice>}
              {problem && <Notice tone="destructive">{problem}</Notice>}
            </Stack>
          )}

          <Stack gap="1">
            <Text size="2" emphasis="medium">
              Balance
            </Text>
            {/* The card-title step, under the page title and the Activity heading: the balance is a
                fact on the page, not the page's headline. */}
            <Heading size="6" render={<p />} className="kd-num">
              {view ? formatUsd(view.balanceMicros) : '—'}
            </Heading>
            {!enabled && (
              <Text size="2" emphasis="medium">
                Payments are not set up on this server, so runs are free.
              </Text>
            )}
          </Stack>

          <Stack gap="4">
            <Flex justify="space-between" align="center" gap="4" wrap="wrap">
              <Heading size="7" render={<h2 />}>
                Activity
              </Heading>
              {rows.length > 0 && (
                <SegmentedControl value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Show">
                  <SegmentedItem value="all">All</SegmentedItem>
                  <SegmentedItem value="runs">Runs</SegmentedItem>
                  <SegmentedItem value="payments">Payments</SegmentedItem>
                </SegmentedControl>
              )}
            </Flex>

            {filtered.length === 0 ? (
              <EmptyState
                  title={rows.length === 0 ? 'No activity yet' : 'Nothing here'}
                  description={
                    rows.length === 0
                      ? 'Payments and the cost of every run you make will show here.'
                      : filter === 'runs'
                        ? 'No runs have been charged yet.'
                        : 'No payments yet.'
                  }
                />
            ) : (
              <div className="kd-billing-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="kd-billing-date">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead align="end">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((entry) => (
                      <ActivityRow key={entry.id} entry={entry} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Stack>
        </Stack>
      </Page>

      <AddCreditsDialog open={adding} onOpenChange={setAdding} onProblem={setProblem} />
    </AppPane>
  );
}

function ActivityRow({ entry }: { entry: LedgerEntry }) {
  const { run } = entry;
  let title: string;
  let detail: string | null = null;
  if (entry.kind === 'topup') title = 'Added credits';
  else if (entry.kind === 'adjust') title = entry.note ?? 'Adjustment';
  else {
    title = run?.label ?? 'Run';
    // One amount per row, the one in the Amount column: no split, which reads as two charges.
    if (entry.kind === 'hold') detail = 'Running';
  }

  return (
    <TableRow>
      <TableCell className="kd-billing-date">
        <Text size="2" emphasis="medium">
          <LocalTime iso={entry.createdAt} short />
        </Text>
      </TableCell>
      <TableCell>
        <Stack gap="0">
          <Text size="2">{title}</Text>
          {/* On a phone the date column goes, so the date joins this line instead. */}
          <Text size="2" emphasis="medium">
            <span className="kd-billing-when">
              <LocalTime iso={entry.createdAt} short />
              {detail ? ' · ' : ''}
            </span>
            {detail}
          </Text>
        </Stack>
      </TableCell>
      <TableCell align="end" className="kd-num">
        <Text size="2" weight={entry.amountMicros > 0 ? 'medium' : undefined} emphasis={entry.kind === 'hold' ? 'medium' : undefined}>
          {entry.amountMicros > 0 ? '+' : ''}
          {formatUsd(entry.amountMicros)}
        </Text>
      </TableCell>
    </TableRow>
  );
}

interface AddCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProblem: (problem: string | null) => void;
}

/** Pick an amount, then leave for Stripe. One decision, one button. */
function AddCreditsDialog({ open, onOpenChange, onProblem }: AddCreditsDialogProps) {
  const [dollars, setDollars] = React.useState<number>(DEFAULT_TOP_UP);
  const [busy, setBusy] = React.useState(false);

  const pay = async () => {
    setBusy(true);
    onProblem(null);
    try {
      await startTopUp(dollars);
    } catch (error) {
      setBusy(false);
      onOpenChange(false);
      onProblem(error instanceof Error ? error.message : 'Checkout could not start.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Stack gap="5">
          <Stack gap="2">
            <DialogTitle>Add credits</DialogTitle>
            <DialogDescription>Paid through Stripe. The balance updates as soon as the payment clears.</DialogDescription>
          </Stack>
          <SegmentedControl
            value={String(dollars)}
            onValueChange={(value) => setDollars(Number(value))}
            aria-label="Amount"
            className="kd-billing-amounts"
          >
            {TOP_UP_DOLLARS.map((d) => (
              <SegmentedItem key={d} value={String(d)}>
                ${d}
              </SegmentedItem>
            ))}
          </SegmentedControl>
          <Flex justify="space-between" align="baseline" className="kd-billing-total">
            <Text size="2" emphasis="medium">
              You pay
            </Text>
            <Text size="4" weight="medium" className="kd-num">
              ${dollars.toFixed(2)}
            </Text>
          </Flex>
          <Flex gap="3" justify="end">
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button emphasis="loud" tone="accent" loading={busy} onClick={() => void pay()}>
              Continue to payment
            </Button>
          </Flex>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
