import { listGraphs } from '@/server/graphs';
import { GraphList } from './graph-list';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const graphs = await listGraphs();
  return <GraphList initial={graphs} />;
}
