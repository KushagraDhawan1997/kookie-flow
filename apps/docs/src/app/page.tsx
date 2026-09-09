'use client';

import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUpRight01Icon,
  ArrowRight01Icon,
  FavouriteIcon,
} from '@hugeicons/core-free-icons';
import { Footer } from '@/components/blocks/footer';
import {
  Avatar,
  Button,
  Heading,
  Link,
  Separator,
  Stack,
  Text,
  Box,
  Flex,
} from '@kookie-ui/react';
import NextLink from 'next/link';

const docs = [
  { name: 'Installation', category: 'Get Started', href: '/docs/installation' },
  { name: 'Quick Start', category: 'Get Started', href: '/docs/quick-start' },
  { name: 'Nodes', category: 'Core Concepts', href: '/docs/nodes' },
  { name: 'Edges', category: 'Core Concepts', href: '/docs/edges' },
  { name: 'Grouping', category: 'Core Concepts', href: '/docs/grouping' },
  { name: 'Clipboard', category: 'Plugins', href: '/docs/plugins/clipboard' },
  { name: 'Keyboard Shortcuts', category: 'Plugins', href: '/docs/plugins/keyboard-shortcuts' },
  { name: 'Undo/Redo', category: 'Plugins', href: '/docs/plugins/undo-redo' },
  { name: 'Context Menu', category: 'Plugins', href: '/docs/plugins/context-menu' },
  { name: 'KookieFlow', category: 'API Reference', href: '/docs/api/kookie-flow' },
  { name: 'useGraph', category: 'API Reference', href: '/docs/api/use-graph' },
  { name: 'useFlowStoreApi', category: 'API Reference', href: '/docs/api/use-flow-store-api' },
];

export default function Page() {
  const currentYear = new Date().getFullYear();

  return (
    <>
      <Box py={{ initial: "6", sm: "9" }}>
        <Box mx="auto" style={{ maxWidth: "72rem", width: "100%" }}>
          <Flex
            direction="column"
            align="start"
            gap={{ initial: '5', sm: '8' }}
            py={{ initial: '4', sm: '6' }}
            px={{ initial: '4', sm: '6' }}
          >
            <Flex direction="column" gap="2" width="100%">
              <Heading size="3" weight="medium">
                Kookie Flow
              </Heading>
              <Separator />
            </Flex>

            <Stack align="start" gap={{ initial: '6', sm: '8' }}>
              <Heading size="9" weight="medium">
                WebGL-native node graphs for React.
              </Heading>

              <Text render={<p />} size="4" tone="neutral">
                An open-source node graph library with{' '}
                <Link
                  target="_blank"
                  href="https://reactflow.dev/"
                  rel="noopener noreferrer"
                  tone="blue"
                >
                  React Flow
                </Link>
                {"'s "}
                ergonomics, GPU-rendered for performance at scale. 50,000+ nodes
                at 60fps.
              </Text>

              <Flex gap="3" align="center" wrap="wrap">
                <Button emphasis="loud" size="2" render={<NextLink href="/docs/installation" />}>
                    Get Started
                    <HugeiconsIcon icon={ArrowUpRight01Icon} />
                  </Button>
                <Button emphasis="medium" size="2" render={<a href="https://github.com/KushagraDhawan1997/kookie-flow" target="_blank" rel="noopener noreferrer" />}>
                    GitHub
                    <HugeiconsIcon icon={ArrowRight01Icon} />
                  </Button>
              </Flex>
            </Stack>
          </Flex>
        </Box>
      </Box>

      <Box py={{ initial: "6", sm: "9" }}>
        <Box mx="auto" style={{ maxWidth: "72rem", width: "100%" }}>
          <Flex
            direction="column"
            align="start"
            gap={{ initial: '6', sm: '10' }}
            py={{ initial: '4', sm: '6' }}
            px={{ initial: '4', sm: '6' }}
          >
            <Flex direction="column" gap="2" width="100%">
              <Heading size="3" weight="medium">
                Documentation
              </Heading>
              <Separator />
            </Flex>
            <Flex
              direction={{ initial: 'column', lg: 'row' }}
              gap={{ initial: '6', md: '12' }}
              width="100%"
              align="stretch"
            >
              <Flex
                direction="column"
                gap={{ initial: '6', sm: '8' }}
                flexShrink="0"
                maxWidth={{ initial: '100%', lg: '600px' }}
                position={{ initial: 'static', lg: 'sticky' }}
                top="96px"
                style={{ alignSelf: 'flex-start' }}
              >
                <Heading
                  size="8"
                  weight="medium"
                  style={{ textWrap: 'balance' }}
                >
                  GPU-rendered graphs with React ergonomics. Zero re-renders during interaction.
                </Heading>
                <Flex gap="3" justify="start">
                  <Button emphasis="loud" size="2" render={<NextLink href="/docs/installation" />}>
                      Get Started
                      <HugeiconsIcon icon={ArrowUpRight01Icon} />
                    </Button>
                  <Button emphasis="medium" size="2" render={<a href="https://github.com/KushagraDhawan1997/kookie-flow" target="_blank" rel="noopener noreferrer" />}>
                      GitHub
                      <HugeiconsIcon icon={ArrowRight01Icon} />
                    </Button>
                </Flex>
              </Flex>
              <Flex
                direction="column"
                justify="between"
                gap={{ initial: '6', sm: '8' }}
                width="100%"
                px={{ initial: '0', md: '4' }}
              >
                <Flex direction="column" gap="4" width="100%">
                  {docs.map((doc) => (
                    <React.Fragment key={doc.href}>
                      <Flex
                        justify="between"
                        width="100%"
                        gap="3"
                        align={{ initial: 'start', md: 'center' }}
                        direction={{ initial: 'column', md: 'row' }}
                      >
                        <Link render={<NextLink href={doc.href} />}>
                            <Flex gap="1" align="center">
                              <Text size="3" weight="medium">
                                {doc.name}
                              </Text>
                              <Flex flexShrink="0">
                                <HugeiconsIcon
                                  icon={ArrowUpRight01Icon}
                                  size={16}
                                  color="currentColor"
                                />
                              </Flex>
                            </Flex>
                          </Link>
                        <Text size="2" weight="regular" tone="neutral">
                          {doc.category}
                        </Text>
                      </Flex>
                      <Separator />
                    </React.Fragment>
                  ))}
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        </Box>
      </Box>

      <Box py={{ initial: "6", sm: "9" }}>
        <Box mx="auto" style={{ maxWidth: "72rem", width: "100%" }}>
          <Flex direction="column" align="start" gap={{ initial: '6', sm: '10' }} py={{ initial: '4', sm: '6' }} px={{ initial: '4', sm: '6' }}>
            <Flex direction="column" gap="2" width="100%">
              <Heading size="3" weight="medium">
                Support
              </Heading>
              <Separator />
            </Flex>
            <Flex
              direction={{ initial: 'column', lg: 'row' }}
              gap={{ initial: '6', md: '12' }}
              width="100%"
              align="stretch"
            >
              <Flex
                direction="column"
                gap={{ initial: '6', sm: '8' }}
                flexShrink="0"
                maxWidth={{ initial: '100%', lg: '600px' }}
                position={{ initial: 'static', lg: 'sticky' }}
                top="96px"
                style={{ alignSelf: 'flex-start' }}
              >
                <Heading
                  size="9"
                  weight="medium"
                  style={{ textWrap: 'balance' }}
                >
                  I build open-source tools for designers and developers. Your sponsorship helps keep them free.
                </Heading>
              </Flex>
              <Flex
                direction="column"
                justify="between"
                gap={{ initial: '6', sm: '8' }}
                width="100%"
                px={{ initial: '0', md: '4' }}
              >
                <Flex direction="column" gap="4" width="100%">
                  {[
                    { name: 'Kookie UI', description: 'Design system and component library. Open-source fork of Radix Themes.', url: 'https://github.com/KushagraDhawan1997/kookie-ui' },
                    { name: 'Kookie Blocks', description: 'Higher-level patterns and blocks built on Kookie UI.', url: 'https://github.com/KushagraDhawan1997/kookie-blocks' },
                    { name: 'Kookie Flow', description: 'WebGL-native node graph library for React. 50,000+ nodes at 60fps.', url: 'https://github.com/KushagraDhawan1997/kookie-flow' },
                  ].map((project) => (
                    <React.Fragment key={project.name}>
                      <Flex
                        width="100%"
                        gap="1"
                        align="start"
                        direction="column"
                      >
                        <Link href={project.url} target="_blank">
                          <Flex gap="1" align="center">
                            <Text size="3" weight="medium">{project.name}</Text>
                            <Flex flexShrink="0">
                              <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} color="currentColor" />
                            </Flex>
                          </Flex>
                        </Link>
                        <Text size="2" tone="neutral">{project.description}</Text>
                      </Flex>
                      <Separator />
                    </React.Fragment>
                  ))}
                </Flex>
                <Flex justify="end">
                  <Button emphasis="loud" size="2" render={<a href="https://github.com/sponsors/KushagraDhawan1997" target="_blank" rel="noopener noreferrer" />}>
                      <HugeiconsIcon icon={FavouriteIcon} strokeWidth={1.75} />
                      Sponsor my work
                    </Button>
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        </Box>
      </Box>

      <Box mb={{ initial: '6', sm: '9' }}>
        <Separator />
        <Box mx="auto" px={{ initial: '4', sm: '6' }} py={{ initial: '6', sm: '8' }} style={{ maxWidth: '72rem', width: '100%' }}>
          <Footer
            brand={
              <Avatar fallback="K" size="4" src="/logos/kookie-flow/kookie-flow.png" />
            }
            groups={[
              {
                title: 'Projects',
                links: [
                  { label: 'Kookie UI', href: 'https://www.hellokookie.com/' },
                  { label: 'Kookie Blocks', href: 'https://kookieblocks.com/' },
                  { label: 'Womp 3D', href: 'https://womp.com' },
                ],
              },
              {
                title: 'Support',
                links: [
                  {
                    label: 'GitHub Sponsors',
                    href: 'https://github.com/sponsors/KushagraDhawan1997',
                  },
                ],
              },
            ]}
            note={`© ${currentYear} Kushagra Dhawan. Built with Kookie UI.`}
            legal={[
              {
                label: 'GitHub',
                href: 'https://github.com/KushagraDhawan1997/kookie-flow',
              },
            ]}
          />
        </Box>
      </Box>
    </>
  );
}
