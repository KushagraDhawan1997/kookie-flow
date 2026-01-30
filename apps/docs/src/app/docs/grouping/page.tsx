import { getCachedDocMetadata } from '@/lib/docs-metadata';
import GroupingPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/grouping');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function GroupingPage() {
  const metadata = getCachedDocMetadata('/docs/grouping');
  return <GroupingPageClient metadata={metadata || undefined} />;
}
