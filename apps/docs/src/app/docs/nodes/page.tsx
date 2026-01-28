import { getCachedDocMetadata } from '@/lib/docs-metadata';
import NodesPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/nodes');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function NodesPage() {
  const metadata = getCachedDocMetadata('/docs/nodes');
  return <NodesPageClient metadata={metadata || undefined} />;
}
