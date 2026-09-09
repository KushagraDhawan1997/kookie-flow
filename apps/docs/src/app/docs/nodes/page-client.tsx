'use client';

import { DocsToc } from '@/components/blocks/docs-toc';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface NodesPageClientProps {
  metadata?: DocMetadata;
}

export default function NodesPageClient({ metadata }: NodesPageClientProps) {
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
