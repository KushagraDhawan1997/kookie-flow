'use client';

import type { ReactNode } from 'react';
import { DocsPage } from '@kushagradhawan/kookie-blocks';
import type { DocsPageMeta } from '@kushagradhawan/kookie-blocks';

interface SiteDocsPageProps {
  children: ReactNode;
  meta?: DocsPageMeta;
  tableOfContents?: ReactNode;
  maxWidth?: string | number;
  padding?: '3' | '4' | '5' | '6' | '7' | '8' | '9';
  headerActions?: ReactNode;
  headerTabs?: ReactNode;
  header?: ReactNode;
}

/**
 * Site-specific DocsPage wrapper with default footer configuration.
 */
export function SiteDocsPage(props: SiteDocsPageProps) {
  return (
    <DocsPage
      {...props}
      containerSize="2"
      showFooter
      footerCopyright={{
        name: 'Kushagra Dhawan',
        url: 'https://www.kushagradhawan.com',
      }}
      githubUrl="https://github.com/KushagraDhawan1997/kookie-flow"
    />
  );
}
