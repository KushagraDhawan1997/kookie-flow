import { getCachedDocMetadata } from '@/lib/docs-metadata';
import ClipboardPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/plugins/clipboard');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function ClipboardPage() {
  const metadata = getCachedDocMetadata('/docs/plugins/clipboard');
  return <ClipboardPageClient metadata={metadata || undefined} />;
}
