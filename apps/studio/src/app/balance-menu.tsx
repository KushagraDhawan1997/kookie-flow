'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, ToolbarButton } from '@kookie-ui/react';
import { formatUsd } from 'studio-core';

import { BALANCE_CHANGED, type BillingView } from '@/shared/billing';
import { authClient } from './auth-client';

/** The balance, asked for again whenever something may have moved it. Null until the first answer. */
export function useBilling(): { view: BillingView | null; reload: () => Promise<void> } {
  const [view, setView] = React.useState<BillingView | null>(null);
  const reload = React.useCallback(async () => {
    try {
      const res = await fetch('/api/billing');
      if (res.ok) setView((await res.json()) as BillingView);
    } catch {
      // Offline: the last balance shown stands until the next ask.
    }
  }, []);
  React.useEffect(() => {
    void reload();
    const onChange = () => void reload();
    addEventListener(BALANCE_CHANGED, onChange);
    addEventListener('focus', onChange);
    return () => {
      removeEventListener(BALANCE_CHANGED, onChange);
      removeEventListener('focus', onChange);
    };
  }, [reload]);
  return { view, reload };
}

/** Start a top-up and leave for Stripe's checkout. Throws with the server's reason if it cannot. */
export async function startTopUp(dollars: number): Promise<void> {
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dollars }),
  });
  const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !body?.url) throw new Error(body?.error ?? `checkout answered ${res.status}`);
  location.assign(body.url);
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
  location.assign('/sign-in');
}

/**
 * The editor's account corner: the balance on the button, and in its menu adding credits, billing
 * and signing out. Adding credits opens the billing page's dialog, which has room to say why a
 * checkout failed.
 */
export function BalanceMenu({ inToolbar = false }: { inToolbar?: boolean }) {
  const router = useRouter();
  const { view } = useBilling();

  const label = view?.enabled ? formatUsd(view.balanceMicros) : 'Account';
  const trigger = inToolbar ? (
    <ToolbarButton aria-label={view?.enabled ? `Balance ${label}` : 'Account'}>{label}</ToolbarButton>
  ) : (
    <Button emphasis="quiet" aria-label={view?.enabled ? `Balance ${label}` : 'Account'}>
      {label}
    </Button>
  );

  return (
    <Menu>
      <MenuTrigger render={trigger} />
      <MenuContent>
        {view?.enabled && <MenuLabel>Balance {label}</MenuLabel>}
        {view?.enabled && <MenuItem onClick={() => router.push('/billing?add=1')}>Add credits</MenuItem>}
        <MenuItem onClick={() => router.push('/billing')}>Billing</MenuItem>
        <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}
