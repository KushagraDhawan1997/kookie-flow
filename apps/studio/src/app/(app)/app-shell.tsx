'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Avatar,
  Box,
  Flex,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Shell,
  ShellContent,
  ShellNavGroup,
  ShellNavItem,
  ShellPaneFooter,
  ShellPaneHeader,
  ShellScroll,
  ShellSidebar,
  ShellTrigger,
  Stack,
  Text,
  Toolbar,
  ToolbarButton,
  ToolbarTitle,
} from '@kookie-ui/react';
import { formatUsd } from 'studio-core';

import { setAppearance, useAppearance, type AppearanceChoice } from '../appearance';
import { signOut, useBilling } from '../balance-menu';
import { BillingIcon, GraphsIcon, PanelLeftIcon, SignOutIcon } from '../icons';
import { Wordmark } from '../wordmark';
import './app-shell.css';

const APPEARANCES: readonly AppearanceChoice[] = ['system', 'light', 'dark'];
const APPEARANCE_LABEL: Record<AppearanceChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function initials(name: string, email: string): string {
  const words = (name.trim() || email).split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

interface AppShellProps {
  name: string;
  email: string;
  children: React.ReactNode;
}

/**
 * The frame around the graph list and billing. The sidebar is the app's places and the account;
 * the balance rides beside Billing so it is always in view without being a control of its own.
 */
export function AppShell({ name, email, children }: AppShellProps) {
  const pathname = usePathname();
  const { view } = useBilling();
  const { choice } = useAppearance();

  return (
    <Shell>
      <ShellSidebar aria-label="Studio" width={248}>
        <ShellPaneHeader>
          <NextLink href="/" aria-label="Studio, all graphs" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Wordmark />
          </NextLink>
        </ShellPaneHeader>

        <ShellScroll fade>
          <ShellNavGroup>
            <ShellNavItem current={pathname === '/'} leading={<GraphsIcon />} render={<NextLink href="/" />}>
              Graphs
            </ShellNavItem>
            <ShellNavItem
              current={pathname.startsWith('/billing')}
              leading={<BillingIcon />}
              trailing={
                view?.enabled ? (
                  <Text size="2" emphasis="medium" className="kd-num">
                    {formatUsd(view.balanceMicros)}
                  </Text>
                ) : null
              }
              render={<NextLink href="/billing" />}
            >
              Billing
            </ShellNavItem>
          </ShellNavGroup>
        </ShellScroll>

        <ShellPaneFooter>
          <Menu>
            <MenuTrigger
              render={
                <ShellNavItem
                  leading={<Avatar size="1" fallback={initials(name, email)} />}
                  aria-label={`Account: ${name || email}`}
                />
              }
            >
              {name || email}
            </MenuTrigger>
            <MenuContent side="top" align="start">
              <MenuGroup>
                <MenuLabel>
                  <Stack gap="0">
                    <Text size="2" weight="medium">
                      {name}
                    </Text>
                    <Text size="1" emphasis="medium">
                      {email}
                    </Text>
                  </Stack>
                </MenuLabel>
              </MenuGroup>
              <MenuSub>
                <MenuSubTrigger>Appearance</MenuSubTrigger>
                <MenuSubContent>
                  <MenuRadioGroup value={choice} onValueChange={(value) => setAppearance(value as AppearanceChoice)}>
                    {APPEARANCES.map((c) => (
                      <MenuRadioItem key={c} value={c} closeOnClick>
                        {APPEARANCE_LABEL[c]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubContent>
              </MenuSub>
              <MenuItem leading={<SignOutIcon />} onClick={() => void signOut()}>
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </ShellPaneFooter>
      </ShellSidebar>
      {children}
    </Shell>
  );
}

interface AppPaneProps {
  /** The page's own controls, at the band's trailing edge. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * One page's pane: the band with the way back to the sidebar and the page's actions, and the
 * scroller the page's title and content live in. The title mirrors into the band once it has
 * scrolled away (ToolbarTitle reads the Page in the same pane).
 */
export function AppPane({ actions, children }: AppPaneProps) {
  return (
    <ShellContent>
      <ShellPaneHeader float>
        <Toolbar backdrop>
          <Flex gap="2" align="center">
            <ShellTrigger
              target="sidebar"
              render={
                <ToolbarButton iconOnly aria-label="Toggle navigation">
                  <PanelLeftIcon />
                </ToolbarButton>
              }
            />
            <ToolbarTitle />
          </Flex>
          {actions}
        </Toolbar>
      </ShellPaneHeader>
      <ShellScroll fade>
        {/* ONE MEASURE FOR EVERY PAGE. The sidebar stays put across navigation, so a page with its
            own width moves the title sideways on every switch. A page that wants shorter lines
            caps its own prose inside this column instead. */}
        <Box className="kd-app-column">{children}</Box>
      </ShellScroll>
    </ShellContent>
  );
}
