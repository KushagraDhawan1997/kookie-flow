import "@kookie-ui/react/styles.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@kookie-ui/react";

import { appearanceScript } from "./appearance-script";
import { DevOutlineGate } from "./dev-outline";
import { DocsTheme } from "./theme-store";

/**
 * THE CANVAS'S FACE, AND ONLY THE CANVAS'S.
 *
 * The site reads in V2's faces — Switzer, Neue Montreal Mono and Boska, declared in globals.css.
 * The canvas is the exception: kookie-flow draws every label as MSDF glyphs cut from Inter, and
 * the edit overlay is a real <textarea> that lands on those glyphs and inherits its face from the
 * DOM around it. Set in Switzer, the text would jump the moment a field is focused. So Inter
 * publishes `--kd-font-canvas` and `.kd-canvas` (globals.css) spends it on the specimens and the
 * demo routes — nowhere else.
 */
const canvas = Inter({
  subsets: ["latin"],
  variable: "--kd-font-canvas",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
});

const siteConfig = {
  name: "Kookie Flow",
  description:
    "WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.",
  url: "https://kookie-flow.vercel.app",
  author: {
    name: "Kushagra Dhawan",
    url: "https://github.com/KushagraDhawan1997",
  },
  github: "https://github.com/KushagraDhawan1997/kookie-flow",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s – ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "node graph",
    "webgl",
    "react",
    "three.js",
    "react-three-fiber",
    "node editor",
    "workflow",
    "diagram",
    "canvas",
    "performance",
    "gpu",
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
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: ["/opengraph-image.png"],
    creator: "@kushagradhawan",
  },
  alternates: {
    canonical: siteConfig.url,
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The root scope, and ONLY the scope. `appearance="inherit"` is the whole dark-SSR design:
 * the Theme stamps every axis EXCEPT appearance, which lives on <html> where the pre-paint
 * script put it — one element owns the mode, no flash, and hydration matches because the
 * server never guessed. `suppressHydrationWarning` covers exactly the attributes that script
 * writes before React ever runs. It is also what kookie-flow's WebGL layer depends on: the
 * canvas reads the resolved tokens off that same scope, so the DOM and the GL paint one mode.
 *
 * The site chrome (header, nav, page padding) lives in the (docs) route group; the demo routes
 * own their own full-viewport canvas. The root stays chrome-free so a route can be an app
 * rather than a page.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The font class only publishes `--kd-font-canvas`; it sets no font-family here, so
    // globals.css is the one place that decides where each face lands.
    <html
      lang="en"
      className={canvas.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body>
        {/* The docs run on the system's own glass. Selectivity means this costs nothing at
            rest: popups pass it by construction, `backdrop`-marked controls take it, and every
            unmarked in-flow control still resolves solid. */}
        {/* THE AXES COME FROM A STORE (theme-store.tsx): the sidebar's Theme panel writes them
            and this root reads them. Its resting values are what was written here —
            `material="regular"`, `radius="full"`, `size="2"`. */}
        <DocsTheme>
          {/* THE SITE'S TOOLTIP TIMING, ONCE (2026-09-06, Kushagra: "Why no tooltip?" — and
              there were tooltips; what was missing is this).

              The Provider does two things and the second is the one that was absent. It states
              the delay, and it GROUPS every tooltip inside it, so the first one waits and the
              rest appear as the pointer travels. With no Provider anywhere on a site, every
              tooltip waits its full 600ms independently — measured 656ms cold and 640ms
              travelling to the very next control in the same toolbar. Moving along a row of
              five icons, nobody is ever still long enough on any one of them, so nothing
              appears and the row reads as if it carries no tooltips at all.

              The package's own instruction says to wrap an app once near the root, and this is
              that. */}
          <TooltipProvider>{children}</TooltipProvider>
        </DocsTheme>
        {/* Dev only: bare `o` outlines every box on the page. Null in a production build. */}
        <DevOutlineGate />
      </body>
    </html>
  );
}
