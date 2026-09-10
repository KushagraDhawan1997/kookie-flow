import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { DocsLayout } from '@/components/docs-layout';
import { appearanceScript } from './appearance-script';

/**
 * The face the WebGL MSDF atlas is built from, loaded for the DOM too.
 *
 * kookie-flow draws every label as instanced MSDF glyphs cut from Inter, and the edit overlay is a
 * real <input> that lands on top of those glyphs and has to sit on the same shapes. Without this
 * the overlay falls back to system-ui and the text jumps the moment a field is focused.
 */
const inter = Inter({ subsets: ['latin'], weight: ['400', '600'], display: 'swap' });

const siteConfig = {
  name: 'Kookie Flow',
  description:
    "WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.",
  url: 'https://kookie-flow.vercel.app',
  author: {
    name: 'Kushagra Dhawan',
    url: 'https://github.com/KushagraDhawan1997',
  },
  github: 'https://github.com/KushagraDhawan1997/kookie-flow',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s – ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    'node graph',
    'webgl',
    'react',
    'three.js',
    'react-three-fiber',
    'node editor',
    'workflow',
    'diagram',
    'canvas',
    'performance',
    'gpu',
  ],
  authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
  creator: siteConfig.author.name,
  publisher: siteConfig.author.name,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: ['/opengraph-image.png'],
    creator: '@kushagradh',
  },
  alternates: {
    canonical: siteConfig.url,
  },
  category: 'technology',
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Stamps data-appearance on <html> before first paint. The root Theme is
            appearance="inherit", so this attribute is the scope every token resolves
            against — the DOM's and the WebGL canvas's alike. */}
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body className={inter.className}>
        <Providers>
          <DocsLayout>{children}</DocsLayout>
        </Providers>
      </body>
    </html>
  );
}
