import { getCachedDocMetadata } from '@/lib/docs-metadata';
import KeyboardShortcutsPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/plugins/keyboard-shortcuts');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function KeyboardShortcutsPage() {
  const metadata = getCachedDocMetadata('/docs/plugins/keyboard-shortcuts');
  return <KeyboardShortcutsPageClient metadata={metadata || undefined} />;
}
