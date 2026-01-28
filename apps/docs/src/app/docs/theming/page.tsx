import { getCachedDocMetadata } from '@/lib/docs-metadata';
import ThemingPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/theming');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function ThemingPage() {
  const metadata = getCachedDocMetadata('/docs/theming');
  return <ThemingPageClient metadata={metadata || undefined} />;
}
