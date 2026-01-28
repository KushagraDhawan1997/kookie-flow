import { getCachedDocMetadata } from '@/lib/docs-metadata';
import KookieFlowApiPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/api/kookie-flow');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function KookieFlowApiPage() {
  const metadata = getCachedDocMetadata('/docs/api/kookie-flow');
  return <KookieFlowApiPageClient metadata={metadata || undefined} />;
}
