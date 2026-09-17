import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listGraphs } from '@/server/graphs';
import { currentUser } from '@/server/session';
import { GraphsPage } from './graphs-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Graphs' };

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const graphs = await listGraphs(user.id);
  return <GraphsPage initial={graphs} />;
}
