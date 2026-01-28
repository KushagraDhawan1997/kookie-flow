import { getCachedDocMetadata } from '@/lib/docs-metadata';
import EdgesPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/edges');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function EdgesPage() {
  const metadata = getCachedDocMetadata('/docs/edges');
  return <EdgesPageClient metadata={metadata || undefined} />;
}
