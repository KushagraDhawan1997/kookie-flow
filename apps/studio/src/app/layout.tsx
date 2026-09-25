import '@kushagradhawan/kookie-ui-react/styles.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import { TooltipProvider } from '@kushagradhawan/kookie-ui-react';

import { appearanceScript } from './appearance-script';
import { StudioTheme } from './theme';

/**
 * The app's face and the canvas's: kookie-flow's labels are MSDF glyphs cut from Inter, and
 * globals.css spends `--kd-font-canvas` on the body and heading slots as well as the canvas.
 */
const canvas = Inter({
  subsets: ['latin'],
  variable: '--kd-font-canvas',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
});

/** The heading face. globals.css spends `--kd-font-heading` on the heading slot. */
const heading = Inter_Tight({
  subsets: ['latin'],
  variable: '--kd-font-heading',
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
    <html lang="en" className={`${canvas.variable} ${heading.variable}`} suppressHydrationWarning>
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
