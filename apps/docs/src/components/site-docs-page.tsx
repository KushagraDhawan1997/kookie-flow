'use client';

import type { ReactNode } from 'react';
import { Box, Flex, Page } from '@kookie-ui/react';

import { Footer } from './blocks/footer';

export interface DocsPageMeta {
  title: string;
  description?: string;
  category?: string;
  source?: string;
}

interface SiteDocsPageProps {
  children: ReactNode;
  meta?: DocsPageMeta;
  tableOfContents?: ReactNode;
}

/**
 * A documentation page: title, deck, prose, a table of contents beside it, and the footer.
 *
 * This replaces `DocsPage` from `@kushagradhawan/kookie-blocks`, and it is deliberately a
 * fraction of its size. That component took twenty-one layout props — padding, paddingX,
 * paddingY, contentGap, outerMargin, headerContentGap, headerRootGap and the rest — and this
 * app passed exactly two of them: `meta` and `tableOfContents`, on all twelve pages. The
 * knobs nobody turned are not ported.
 *
 * v2's `Page` owns the title lockup, so the header this used to assemble by hand is the
 * system's now. `data-content-area` stays on the prose wrapper because TableOfContents scans
 * inside it for headings.
 */
export function SiteDocsPage({ children, meta, tableOfContents }: SiteDocsPageProps) {
  return (
    <Flex direction="column" style={{ minHeight: '100%' }}>
      <Flex gap="8" align="start" justify="center" p={{ initial: '4', sm: '6' }}>
        <Box style={{ maxWidth: '48rem', width: '100%' }}>
          <Page title={meta?.title ?? ''} description={meta?.description}>
            <Box data-content-area>{children}</Box>
          </Page>
        </Box>

        {tableOfContents ? (
          <Box
            display={{ initial: 'none', md: 'block' }}
            style={{
              width: '16rem',
              position: 'sticky',
              top: 'var(--space-6)',
              flexShrink: 0,
            }}
          >
            {tableOfContents}
          </Box>
        ) : null}
      </Flex>

      <Box px={{ initial: '4', sm: '6' }} pb="8">
        <Footer
          groups={[]}
          note={`© ${new Date().getFullYear()} Kushagra Dhawan.`}
          legal={[
            {
              label: 'GitHub',
              href: 'https://github.com/KushagraDhawan1997/kookie-flow',
            },
          ]}
        />
      </Box>
    </Flex>
  );
}
