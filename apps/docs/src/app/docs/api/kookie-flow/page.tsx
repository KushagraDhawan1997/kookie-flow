import { getCachedDocMetadata } from '@/lib/docs-metadata';
import KookieFlowPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/api/kookie-flow');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function KookieFlowPage() {
  const metadata = getCachedDocMetadata('/docs/api/kookie-flow');
  return <KookieFlowPageClient metadata={metadata || undefined} />;
}
