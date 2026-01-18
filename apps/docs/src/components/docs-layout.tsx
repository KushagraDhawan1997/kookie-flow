'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { DocsShell } from '@kushagradhawan/kookie-blocks';
import { docsNavigation } from '../../navigation-config';
import { Badge, Flex, IconButton } from '@kushagradhawan/kookie-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { GithubIcon } from '@hugeicons/core-free-icons';

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <DocsShell
      navigation={docsNavigation}
      logo={{
        src: '/kookie-flow-logo.svg',
        alt: 'Kookie Flow',
        href: '/',
      }}
      pathname={pathname}
      linkComponent={Link as any}
      headerActions={
        <Flex gap="2" align="center">
          <IconButton
            asChild
            variant="ghost"
            color="gray"
            highContrast
            aria-label="GitHub"
          >
            <Link
              href="https://github.com/KushagraDhawan1997/kookie-flow"
              target="_blank"
            >
              <HugeiconsIcon icon={GithubIcon} strokeWidth={1.75} />
            </Link>
          </IconButton>
          <Badge variant="classic" highContrast color="gray" size="1">
            v{process.env.KOOKIE_FLOW_VERSION}
          </Badge>
        </Flex>
      }
    >
      {children}
    </DocsShell>
  );
}
