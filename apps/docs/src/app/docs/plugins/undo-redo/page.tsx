import { getCachedDocMetadata } from '@/lib/docs-metadata';
import UndoRedoPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/plugins/undo-redo');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function UndoRedoPage() {
  const metadata = getCachedDocMetadata('/docs/plugins/undo-redo');
  return <UndoRedoPageClient metadata={metadata || undefined} />;
}
