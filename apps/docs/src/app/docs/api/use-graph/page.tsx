import { getCachedDocMetadata } from '@/lib/docs-metadata';
import UseGraphPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/api/use-graph');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function UseGraphPage() {
  const metadata = getCachedDocMetadata('/docs/api/use-graph');
  return <UseGraphPageClient metadata={metadata || undefined} />;
}
