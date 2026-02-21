'use client';

import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUpRight01Icon,
  ArrowRight01Icon,
  FavouriteIcon,
} from '@hugeicons/core-free-icons';
import { Hero, Footer } from '@kushagradhawan/kookie-blocks';
import {
  Avatar,
  Button,
  Heading,
  Section,
  Container,
  Link,
  Separator,
  Text,
  Box,
  Flex,
} from '@kushagradhawan/kookie-ui';
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
      <Section position="relative" size="4">
        <Container size="4">
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
              <Separator size="4" />
            </Flex>

            <Hero.Root align="start" gap={{ initial: '6', sm: '8' }}>
              <Hero.Title
                size={{ initial: '8', sm: '9', lg: '10' }}
                weight="medium"
                align="left"
              >
                WebGL-native node graphs for React.
              </Hero.Title>

              <Hero.Description
                size={{ initial: '3', sm: '4' }}
                color="gray"
                align="left"
              >
                An open-source node graph library with{' '}
                <Link
                  target="_blank"
                  href="https://reactflow.dev/"
                  rel="noopener noreferrer"
                  underline="always"
                  color="blue"
                >
                  React Flow
                </Link>
                {"'s "}
                ergonomics, GPU-rendered for performance at scale. 50,000+ nodes
                at 60fps.
              </Hero.Description>

              <Hero.Actions gap="3">
                <Button asChild variant="solid" size="2" highContrast>
                  <NextLink href="/docs/installation">
                    Get Started
                    <HugeiconsIcon icon={ArrowUpRight01Icon} />
                  </NextLink>
                </Button>
                <Button asChild variant="soft" highContrast size="2">
                  <a
                    href="https://github.com/KushagraDhawan1997/kookie-flow"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                    <HugeiconsIcon icon={ArrowRight01Icon} />
                  </a>
                </Button>
              </Hero.Actions>
            </Hero.Root>
          </Flex>
        </Container>
      </Section>

      <Section size="4">
        <Container size="4">
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
              <Separator size="4" />
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
                  align="left"
                  size={{ initial: '6', sm: '8', lg: '9' }}
                  weight="medium"
                  style={{ textWrap: 'balance' }}
                >
                  GPU-rendered graphs with React ergonomics. Zero re-renders during interaction.
                </Heading>
                <Flex gap="3" justify="start">
                  <Button asChild variant="solid" size="2" highContrast>
                    <NextLink href="/docs/installation">
                      Get Started
                      <HugeiconsIcon icon={ArrowUpRight01Icon} />
                    </NextLink>
                  </Button>
                  <Button asChild variant="soft" highContrast size="2">
                    <a
                      href="https://github.com/KushagraDhawan1997/kookie-flow"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      GitHub
                      <HugeiconsIcon icon={ArrowRight01Icon} />
                    </a>
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
                        <Link asChild highContrast underline="always">
                          <NextLink href={doc.href}>
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
                          </NextLink>
                        </Link>
                        <Text size="2" weight="regular" color="gray">
                          {doc.category}
                        </Text>
                      </Flex>
                      <Separator size="4" />
                    </React.Fragment>
                  ))}
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        </Container>
      </Section>

      <Section size="4">
        <Container size="4">
          <Flex direction="column" align="start" gap={{ initial: '6', sm: '10' }} py={{ initial: '4', sm: '6' }} px={{ initial: '4', sm: '6' }}>
            <Flex direction="column" gap="2" width="100%">
              <Heading size="3" weight="medium">
                Support
              </Heading>
              <Separator size="4" />
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
                  align="left"
                  size={{ initial: '8', sm: '9' }}
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
                        <Link href={project.url} target="_blank" highContrast underline="always">
                          <Flex gap="1" align="center">
                            <Text size="3" weight="medium">{project.name}</Text>
                            <Flex flexShrink="0">
                              <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} color="currentColor" />
                            </Flex>
                          </Flex>
                        </Link>
                        <Text size="2" color="gray">{project.description}</Text>
                      </Flex>
                      <Separator size="4" />
                    </React.Fragment>
                  ))}
                </Flex>
                <Flex justify="end">
                  <Button asChild variant="solid" size="2" highContrast>
                    <a href="https://github.com/sponsors/KushagraDhawan1997" target="_blank" rel="noopener noreferrer">
                      <HugeiconsIcon icon={FavouriteIcon} strokeWidth={1.75} />
                      Sponsor my work
                    </a>
                  </Button>
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        </Container>
      </Section>

      <Box mb={{ initial: '6', sm: '9' }}>
        <Separator size="4" light />
        <Container size="4">
          <Footer.Root p={{ initial: '4', sm: '8' }} gap={{ initial: '6', sm: '8' }} px={{ initial: '4', sm: '6' }}>
            <Footer.Brand gap="6">
              <Avatar
                fallback="K"
                size="4"
                color="gray"
                src="/logos/kookie-flow/kookie-flow.png"
              />
              <Flex direction="column" gap="4">
                <Footer.Tagline>
                  Built with{' '}
                  <Footer.Link
                    href="https://www.hellokookie.com/"
                    target="_blank"
                    underline="always"
                  >
                    Kookie UI
                  </Footer.Link>
                  {' + '}
                  <Footer.Link
                    href="https://kookieblocks.com/"
                    target="_blank"
                    underline="always"
                  >
                    Kookie Blocks
                  </Footer.Link>
                  .
                </Footer.Tagline>
                <Footer.Legal>
                  <Text size="2" color="gray">
                    © {currentYear} Kushagra Dhawan.
                  </Text>
                  <Footer.Link
                    href="https://github.com/KushagraDhawan1997/kookie-flow"
                    target="_blank"
                  >
                    GitHub
                  </Footer.Link>
                </Footer.Legal>
              </Flex>
            </Footer.Brand>
            <Footer.Links>
              <Footer.LinkGroup title="Projects">
                <Footer.Link
                  href="https://www.hellokookie.com/"
                  target="_blank"
                >
                  Kookie UI
                </Footer.Link>
                <Footer.Link
                  href="https://kookieblocks.com/"
                  target="_blank"
                >
                  Kookie Blocks
                </Footer.Link>
                <Footer.Link href="https://womp.com" target="_blank">
                  Womp 3D
                </Footer.Link>
              </Footer.LinkGroup>
              <Footer.LinkGroup title="Support">
                <Footer.Link href="https://github.com/sponsors/KushagraDhawan1997" target="_blank">
                  GitHub Sponsors
                </Footer.Link>
              </Footer.LinkGroup>
            </Footer.Links>
          </Footer.Root>
        </Container>
      </Box>
    </>
  );
}
