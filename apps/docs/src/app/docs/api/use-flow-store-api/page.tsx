import { getCachedDocMetadata } from '@/lib/docs-metadata';
import UseFlowStoreApiPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/api/use-flow-store-api');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function UseFlowStoreApiPage() {
  const metadata = getCachedDocMetadata('/docs/api/use-flow-store-api');
  return <UseFlowStoreApiPageClient metadata={metadata || undefined} />;
}
