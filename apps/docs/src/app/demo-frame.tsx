'use client';

import NextLink from 'next/link';
import {
  Box,
  Flex,
  Shell,
  ShellContent,
  ShellPaneFooter,
  ShellPaneHeader,
  Toolbar,
  ToolbarButton,
  ToolbarTitle,
} from '@kushagradhawan/kookie-ui-react';

import { AppearanceToggle } from './appearance-toggle';
import { ArrowLeftIcon } from './icons';

/**
 * The frame every full-screen demo sits in, laid out as studio's editor is: the canvas takes the
 * whole pane, and a floating band above and below it holds the page's controls. The graph passes
 * behind both, so neither costs the canvas any room.
 *
 * `kd-canvas` sets Inter, the face the MSDF labels are cut from — see the root layout.
 */
export function DemoFrame({
  title,
  actions,
  footer,
  children,
}: {
  title: string;
  /** Controls for the demo, at the band's trailing edge before the appearance toggle. */
  actions?: React.ReactNode;
  /** A second band along the bottom — readouts and hints. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box height="100dvh" className="kd-canvas">
      <Shell>
        <ShellContent flush style={{ position: 'relative', overflow: 'hidden' }}>
          <ShellPaneHeader float>
            <Toolbar backdrop>
              <Flex gap="3" align="center">
                <ToolbarButton iconOnly aria-label="Back to docs" render={<NextLink href="/" />}>
                  <ArrowLeftIcon />
                </ToolbarButton>
                <ToolbarTitle>{title}</ToolbarTitle>
              </Flex>
              <Flex gap="3" align="center">
                {actions}
                <AppearanceToggle />
              </Flex>
            </Toolbar>
          </ShellPaneHeader>
          <Box position="absolute" inset="0">
            {children}
          </Box>
          {footer && (
            <ShellPaneFooter float>
              <Toolbar backdrop>{footer}</Toolbar>
            </ShellPaneFooter>
          )}
        </ShellContent>
      </Shell>
    </Box>
  );
}
