import { getCachedDocMetadata } from '@/lib/docs-metadata';
import QuickStartPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/quick-start');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function QuickStartPage() {
  const metadata = getCachedDocMetadata('/docs/quick-start');
  return <QuickStartPageClient metadata={metadata || undefined} />;
}
