import { getCachedDocMetadata } from '@/lib/docs-metadata';
import ContextMenuPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/plugins/context-menu');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function ContextMenuPage() {
  const metadata = getCachedDocMetadata('/docs/plugins/context-menu');
  return <ContextMenuPageClient metadata={metadata || undefined} />;
}
