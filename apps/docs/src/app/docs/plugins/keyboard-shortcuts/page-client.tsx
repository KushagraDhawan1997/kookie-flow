'use client';

import { TableOfContents } from '@kushagradhawan/kookie-blocks';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface KeyboardShortcutsPageClientProps {
  metadata?: DocMetadata;
}

export default function KeyboardShortcutsPageClient({
  metadata,
}: KeyboardShortcutsPageClientProps) {
  return (
    <SiteDocsPage
      meta={metadata}
      tableOfContents={
        <TableOfContents renderContainer={(content) => content || null} />
      }
    >
      <ContentMDX />
    </SiteDocsPage>
  );
}
