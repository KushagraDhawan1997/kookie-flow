'use client';

import { DocsToc } from '@/components/blocks/docs-toc';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface KookieFlowPageClientProps {
  metadata?: DocMetadata;
}

export default function KookieFlowPageClient({
  metadata,
}: KookieFlowPageClientProps) {
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
