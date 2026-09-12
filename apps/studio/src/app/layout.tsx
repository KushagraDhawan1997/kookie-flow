import '@kookie-ui/react/styles.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { TooltipProvider } from '@kookie-ui/react';

import { appearanceScript } from './appearance-script';
import { StudioTheme } from './theme';

/** The canvas's face only: kookie-flow's labels are MSDF glyphs cut from Inter. */
const canvas = Inter({
  subsets: ['latin'],
  variable: '--kd-font-canvas',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
});

export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s – Studio' },
  description: 'Node-based image and video generation, with deterministic ops, logic, and an agent.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={canvas.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body>
        <StudioTheme>
          <TooltipProvider>{children}</TooltipProvider>
        </StudioTheme>
      </body>
    </html>
  );
}
