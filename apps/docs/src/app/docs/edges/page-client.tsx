'use client';

import { TableOfContents } from '@kushagradhawan/kookie-blocks';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface EdgesPageClientProps {
  metadata?: DocMetadata;
}

export default function EdgesPageClient({ metadata }: EdgesPageClientProps) {
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
