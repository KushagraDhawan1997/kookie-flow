'use client';

import { DocsToc } from '@/components/blocks/docs-toc';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface GroupingPageClientProps {
  metadata?: DocMetadata;
}

export default function GroupingPageClient({ metadata }: GroupingPageClientProps) {
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
