import type { Metadata, Viewport } from 'next';
import { JsonLd } from '@/components/json-ld';
import './globals.css';
import '@kushagradhawan/kookie-ui/styles.css';
import '@kushagradhawan/kookie-blocks/styles.css';
import { Providers } from '@/components/providers';

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
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <JsonLd />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
