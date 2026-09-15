import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import { BillingPage } from './billing-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string; reason?: string; add?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=%2Fbilling');
  const { topup, reason, add } = await searchParams;
  return <BillingPage topup={topup ?? null} reason={reason ?? null} openAdd={add === '1'} />;
}
