'use client';

import { DocsToc } from '@/components/blocks/docs-toc';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface UndoRedoPageClientProps {
  metadata?: DocMetadata;
}

export default function UndoRedoPageClient({
  metadata,
}: UndoRedoPageClientProps) {
  return (
    <SiteDocsPage
      meta={metadata}
      tableOfContents={
        <DocsToc />
      }
    >
      <ContentMDX />
    </SiteDocsPage>
  );
}
