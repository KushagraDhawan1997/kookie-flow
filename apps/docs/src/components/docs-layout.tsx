'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Chip,
  Button,
  Flex,
  Shell,
  ShellContent,
  ShellNavGroup,
  ShellNavItem,
  ShellPaneFooter,
  ShellPaneHeader,
  ShellScroll,
  ShellSidebar,
  ShellTrigger,
} from '@kookie-ui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { GithubIcon, Menu01Icon } from '@hugeicons/core-free-icons';

import { docsNavigation } from '../../navigation-config';
import { DarkModeToggle } from './dark-mode';

/**
 * The docs chrome, on KookieUI v2's own Shell.
 *
 * This replaces `DocsShell` from `@kushagradhawan/kookie-blocks`, which peer-depends on v1
 * and so could not come with the app. It is not a port line-for-line: v2 ships Shell as a
 * first-class component with the anatomy the block was wrapping, so the block's job is now
 * the system's. v2 also deleted v1's `thin` sidebar mode and its exclusivity rules, which is
 * why the thin toggle and its two SVGs are gone rather than translated.
 *
 * Shell's pinned-stack anatomy: siblings BEFORE a ShellScroll pin above it, siblings after
 * pin below. So the masthead and the footer stay put while the nav list scrolls.
 */
export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <Shell>
      <ShellSidebar presentation="auto">
        <ShellPaneHeader>
          <Flex align="center" justify="between" width="100%" gap="2">
            <Link href="/" aria-label="Kookie Flow">
              <Image
                src="/logos/kookie-flow/kookie-flow.png"
                alt="Kookie Flow"
                width={28}
                height={28}
                priority
              />
            </Link>
            <Flex gap="2" align="center">
              <Button
                iconOnly
                emphasis="quiet"
                tone="neutral"
                aria-label="GitHub"
                render={
                  <Link
                    href="https://github.com/KushagraDhawan1997/kookie-flow"
                    target="_blank"
                  />
                }
              >
                <HugeiconsIcon icon={GithubIcon} strokeWidth={1.75} />
              </Button>
              <Chip>v{process.env.KOOKIE_FLOW_VERSION}</Chip>
            </Flex>
          </Flex>
        </ShellPaneHeader>

        <ShellScroll>
          {docsNavigation.groups.map((group) => (
            <ShellNavGroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <ShellNavItem
                  key={item.href}
                  current={pathname === item.href}
                  leading={
                    item.icon ? (
                      <HugeiconsIcon icon={item.icon} strokeWidth={1.75} />
                    ) : undefined
                  }
                  render={<Link href={item.href} />}
                >
                  {item.title}
                </ShellNavItem>
              ))}
            </ShellNavGroup>
          ))}
        </ShellScroll>

        <ShellPaneFooter>
          <DarkModeToggle />
        </ShellPaneFooter>
      </ShellSidebar>

      <ShellContent>
        <ShellPaneHeader float>
          <ShellTrigger
            target="sidebar"
            render={
              <Button iconOnly emphasis="quiet" tone="neutral" aria-label="Toggle navigation">
                <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.75} />
              </Button>
            }
          />
        </ShellPaneHeader>

        <ShellScroll>{children}</ShellScroll>
      </ShellContent>
    </Shell>
  );
}
