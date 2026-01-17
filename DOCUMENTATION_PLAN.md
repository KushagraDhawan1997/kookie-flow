# Kookie Flow Documentation Setup Plan

This document outlines the steps to set up the Kookie Flow docs app using the same architecture as Kookie UI and Kookie Blocks documentation sites.

---

## Overview

The docs app will use **DocsShell** and related components from `@kushagradhawan/kookie-blocks` to provide:

- Responsive sidebar navigation with mobile overlay
- Consistent page layout with table of contents
- MDX content rendering with syntax highlighting
- Theme support via Kookie UI

---

## Current State

The `apps/docs` folder exists but uses a basic setup with Tailwind CSS. This needs to be replaced with the Kookie design system.

**Current dependencies to remove:**
- `@tailwindcss/postcss`
- `tailwindcss`

**Current files to update:**
- `src/app/layout.tsx`
- `src/app/globals.css`
- `next.config.ts`
- `package.json`

---

## Architecture

```
apps/docs/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (Providers + DocsLayout)
│   │   ├── globals.css             # Minimal global styles
│   │   ├── page.tsx                # Landing page (redirect to /docs)
│   │   └── docs/
│   │       ├── layout.tsx          # Docs section layout (passthrough)
│   │       ├── getting-started/
│   │       │   ├── page.tsx        # Server component (metadata)
│   │       │   ├── page-client.tsx # Client component (DocsPage + ToC)
│   │       │   └── content.mdx     # MDX content
│   │       └── [feature]/
│   │           ├── page.tsx
│   │           ├── page-client.tsx
│   │           └── content.mdx
│   ├── components/
│   │   ├── providers.tsx           # Theme wrapper
│   │   ├── docs-layout.tsx         # DocsShell wrapper
│   │   └── site-docs-page.tsx      # DocsPage wrapper with defaults
│   └── lib/
│       └── docs-metadata.ts        # MDX frontmatter parser
├── navigation-config.ts            # Sidebar navigation structure
├── mdx-components.tsx              # MDX component overrides
├── next.config.mjs                 # MDX plugins configuration
└── package.json
```

---

## Dependencies

### Add to `package.json`

```json
{
  "dependencies": {
    "@kushagradhawan/kookie-blocks": "^0.1.44",
    "@kushagradhawan/kookie-ui": "^0.1.125",
    "@hugeicons/core-free-icons": "^3.1.1",
    "@hugeicons/react": "^1.1.4",
    "@mdx-js/loader": "^3.1.1",
    "@mdx-js/react": "^3.1.1",
    "@next/mdx": "^16.1.1",
    "gray-matter": "^4.0.3",
    "rehype-pretty-code": "^0.14.1",
    "rehype-slug": "^6.0.0",
    "remark-frontmatter": "^5.0.0",
    "remark-gfm": "^4.0.1"
  }
}
```

### Remove from `package.json`

```json
{
  "dependencies": {
    "@tailwindcss/postcss": "^4.1.18",  // REMOVE
    "tailwindcss": "^4.1.18"             // REMOVE
  }
}
```

---

## File Templates

### 1. `navigation-config.ts`

```typescript
import type { DocsNavigationConfig } from "@kushagradhawan/kookie-blocks";
import {
  Download01Icon,
  FlowIcon,
  NodeIcon,
  Link01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

export const docsNavigation: DocsNavigationConfig = {
  groups: [
    {
      label: "Get Started",
      items: [
        {
          href: "/docs/installation",
          title: "Installation",
          icon: Download01Icon,
        },
        {
          href: "/docs/quick-start",
          title: "Quick Start",
          icon: FlowIcon,
        },
      ],
    },
    {
      label: "Core Concepts",
      items: [
        {
          href: "/docs/nodes",
          title: "Nodes",
          icon: NodeIcon,
        },
        {
          href: "/docs/edges",
          title: "Edges",
          icon: Link01Icon,
        },
      ],
    },
    {
      label: "API Reference",
      items: [
        {
          href: "/docs/api/flow-canvas",
          title: "FlowCanvas",
          icon: Settings01Icon,
        },
        {
          href: "/docs/api/use-flow-store",
          title: "useFlowStore",
          icon: Settings01Icon,
        },
      ],
    },
  ],
};
```

---

### 2. `src/components/providers.tsx`

```typescript
'use client';

import { Theme } from '@kushagradhawan/kookie-ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme
      accentColor="iris"
      grayColor="auto"
      material="solid"
      radius="medium"
      fontFamily="sans"
    >
      {children}
    </Theme>
  );
}
```

---

### 3. `src/components/docs-layout.tsx`

```typescript
'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { DocsShell } from '@kushagradhawan/kookie-blocks';
import { docsNavigation } from '../../navigation-config';
import { Badge, Flex, IconButton } from '@kushagradhawan/kookie-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { GithubIcon } from '@hugeicons/core-free-icons';

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <DocsShell
      navigation={docsNavigation}
      logo={{
        src: '/kookie-flow-logo.svg',  // Add logo to public/
        alt: 'Kookie Flow',
        href: '/',
      }}
      pathname={pathname}
      linkComponent={Link as any}
      headerActions={
        <Flex gap="2" align="center">
          <IconButton
            asChild
            variant="ghost"
            color="gray"
            highContrast
            aria-label="GitHub"
          >
            <Link
              href="https://github.com/KushagraDhawan1997/kookie-flow"
              target="_blank"
            >
              <HugeiconsIcon icon={GithubIcon} strokeWidth={1.75} />
            </Link>
          </IconButton>
          <Badge variant="classic" highContrast color="gray" size="1">
            v{process.env.KOOKIE_FLOW_VERSION}
          </Badge>
        </Flex>
      }
    >
      {children}
    </DocsShell>
  );
}
```

---

### 4. `src/components/site-docs-page.tsx`

```typescript
'use client';

import type { ReactNode } from 'react';
import { DocsPage } from '@kushagradhawan/kookie-blocks';
import type { DocsPageMeta } from '@kushagradhawan/kookie-blocks';

interface SiteDocsPageProps {
  children: ReactNode;
  meta?: DocsPageMeta;
  tableOfContents?: ReactNode;
  maxWidth?: string | number;
  padding?: '3' | '4' | '5' | '6' | '7' | '8' | '9';
  headerActions?: ReactNode;
  headerTabs?: ReactNode;
  header?: ReactNode;
}

/**
 * Site-specific DocsPage wrapper with default footer configuration.
 */
export function SiteDocsPage(props: SiteDocsPageProps) {
  return (
    <DocsPage
      {...props}
      containerSize="2"
      showFooter
      footerCopyright={{
        name: 'Kushagra Dhawan',
        url: 'https://www.kushagradhawan.com',
      }}
      githubUrl="https://github.com/KushagraDhawan1997/kookie-flow"
    />
  );
}
```

---

### 5. `src/app/layout.tsx`

```typescript
import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@kushagradhawan/kookie-ui/styles.css';
import '@kushagradhawan/kookie-blocks/styles.css';
import { Providers } from '../components/providers';
import { DocsLayout } from '../components/docs-layout';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://kookieflow.com'),
  title: {
    default: 'Kookie Flow',
    template: '%s – Kookie Flow',
  },
  description: 'A performant node-based canvas library for React.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <DocsLayout>{children}</DocsLayout>
        </Providers>
      </body>
    </html>
  );
}
```

---

### 6. `src/app/globals.css`

```css
/* Minimal global styles - Kookie UI handles the rest */

html,
body {
  height: 100%;
  margin: 0;
  padding: 0;
}

/* Smooth scrolling for anchor links */
html {
  scroll-behavior: smooth;
}

/* Code block styling overrides if needed */
[data-rehype-pretty-code-fragment] {
  position: relative;
}
```

---

### 7. `next.config.mjs`

```javascript
import nextMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../packages/kookie-flow/package.json');

/** @type {import('rehype-pretty-code').Options} */
const rehypePrettyCodeOptions = {
  theme: {
    light: 'github-light',
    dark: 'github-dark',
  },
  keepBackground: false,
  grid: true,
  defaultLang: 'plaintext',
  defaultColor: false,
};

const withMDX = nextMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm, remarkFrontmatter],
    rehypePlugins: [rehypeSlug, [rehypePrettyCode, rehypePrettyCodeOptions]],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  env: {
    KOOKIE_FLOW_VERSION: packageJson.version,
  },
  // Transpile kookie packages
  transpilePackages: [
    '@kushagradhawan/kookie-ui',
    '@kushagradhawan/kookie-blocks',
  ],
};

export default withMDX(nextConfig);
```

---

### 8. `mdx-components.tsx`

```typescript
import type { MDXComponents } from 'mdx/types';
import { Code } from '@kushagradhawan/kookie-ui';
import {
  CodeBlock,
  useCodeBlockContext,
  createMarkdownComponents,
} from '@kushagradhawan/kookie-blocks';

const PreWrapper = ({
  children,
  className,
  ...props
}: React.ComponentProps<'pre'>) => {
  const isInsideCodeBlock = useCodeBlockContext();
  if (isInsideCodeBlock) {
    return (
      <pre className={className} {...props}>
        {children}
      </pre>
    );
  }
  return (
    <CodeBlock>
      <pre className={className} {...props}>
        {children}
      </pre>
    </CodeBlock>
  );
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  const baseComponents = createMarkdownComponents({
    inlineCodeHighContrast: true,
    codeBlockCollapsible: false,
    spacing: 'spacious',
  });

  return {
    ...baseComponents,
    code: ({ children, className, ...props }: any) => {
      // Code blocks with language are handled by rehype-pretty-code
      if (className?.includes('language-')) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      // Inline code
      return (
        <Code size="3" color="gray" variant="soft" highContrast>
          {children}
        </Code>
      );
    },
    pre: (props) => <PreWrapper {...props} />,
    CodeBlock,
    ...components,
  };
}
```

---

### 9. `src/lib/docs-metadata.ts`

```typescript
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface DocMetadata {
  title: string;
  description?: string;
  category?: string;
}

const docsDirectory = path.join(process.cwd(), 'src/app/docs');

// Cache for metadata
const metadataCache = new Map<string, DocMetadata | null>();

export function getDocMetadata(slug: string): DocMetadata | null {
  // Normalize slug
  const normalizedSlug = slug.startsWith('/docs')
    ? slug.replace('/docs', '')
    : slug;
  const slugPath = normalizedSlug.startsWith('/')
    ? normalizedSlug.slice(1)
    : normalizedSlug;

  // Check cache
  if (metadataCache.has(slugPath)) {
    return metadataCache.get(slugPath) || null;
  }

  // Try to find content.mdx
  const mdxPath = path.join(docsDirectory, slugPath, 'content.mdx');

  try {
    if (fs.existsSync(mdxPath)) {
      const fileContents = fs.readFileSync(mdxPath, 'utf8');
      const { data } = matter(fileContents);

      const metadata: DocMetadata = {
        title: data.title || 'Untitled',
        description: data.description,
        category: data.category,
      };

      metadataCache.set(slugPath, metadata);
      return metadata;
    }
  } catch (error) {
    console.error(`Error reading metadata for ${slugPath}:`, error);
  }

  metadataCache.set(slugPath, null);
  return null;
}

// Cached version for use in generateMetadata
export const getCachedDocMetadata = getDocMetadata;
```

---

### 10. Example Page: `src/app/docs/installation/page.tsx`

```typescript
import { getCachedDocMetadata } from '@/lib/docs-metadata';
import InstallationPageClient from './page-client';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = getCachedDocMetadata('/docs/installation');
  if (!metadata) return {};
  return {
    title: metadata.title,
    description: metadata.description,
  };
}

export default function InstallationPage() {
  const metadata = getCachedDocMetadata('/docs/installation');
  return <InstallationPageClient metadata={metadata || undefined} />;
}
```

---

### 11. Example Page Client: `src/app/docs/installation/page-client.tsx`

```typescript
'use client';

import { TableOfContents } from '@kushagradhawan/kookie-blocks';
import { SiteDocsPage } from '@/components/site-docs-page';
import type { DocMetadata } from '@/lib/docs-metadata';
import ContentMDX from './content.mdx';

interface InstallationPageClientProps {
  metadata?: DocMetadata;
}

export default function InstallationPageClient({
  metadata,
}: InstallationPageClientProps) {
  return (
    <SiteDocsPage
      meta={metadata}
      tableOfContents={
        <TableOfContents renderContainer={(content) => content || null} />
      }
    >
      <ContentMDX />
    </SiteDocsPage>
  );
}
```

---

### 12. Example MDX Content: `src/app/docs/installation/content.mdx`

```mdx
---
title: Installation
description: Get started with Kookie Flow in your React project
---

## Installation

Install Kookie Flow using your preferred package manager:

```bash
pnpm add @kushagradhawan/kookie-flow
```

## Requirements

- React 18 or 19
- A modern browser with ES6+ support

## Basic Setup

Import the styles and components:

```tsx
import { FlowCanvas, useFlowStore } from '@kushagradhawan/kookie-flow';
import '@kushagradhawan/kookie-flow/styles.css';

function App() {
  const store = useFlowStore();

  return (
    <FlowCanvas store={store} />
  );
}
```

## Next Steps

- [Quick Start](/docs/quick-start) - Build your first flow
- [Nodes](/docs/nodes) - Learn about node types
- [Edges](/docs/edges) - Connect nodes with edges
```

---

## Implementation Steps

### Phase 1: Dependencies & Config

1. [ ] Remove Tailwind dependencies from `package.json`
2. [ ] Add Kookie UI, Kookie Blocks, and MDX dependencies
3. [ ] Run `pnpm install`
4. [ ] Rename `next.config.ts` to `next.config.mjs` and update content
5. [ ] Create `mdx-components.tsx` at project root
6. [ ] Update `postcss.config.mjs` (remove Tailwind, keep minimal)
7. [ ] Delete any Tailwind config files

### Phase 2: Core Components

8. [ ] Create `src/components/providers.tsx`
9. [ ] Create `navigation-config.ts`
10. [ ] Create `src/components/docs-layout.tsx`
11. [ ] Create `src/components/site-docs-page.tsx`
12. [ ] Create `src/lib/docs-metadata.ts`

### Phase 3: Layout Updates

13. [ ] Update `src/app/layout.tsx`
14. [ ] Update `src/app/globals.css`
15. [ ] Update `src/app/page.tsx` (redirect to /docs or landing)

### Phase 4: Documentation Pages

16. [ ] Create `src/app/docs/layout.tsx` (passthrough)
17. [ ] Create first doc page: `src/app/docs/installation/`
    - `page.tsx`
    - `page-client.tsx`
    - `content.mdx`
18. [ ] Add more documentation pages as needed

### Phase 5: Assets & Polish

19. [ ] Add logo to `public/kookie-flow-logo.svg`
20. [ ] Update favicon
21. [ ] Test responsive behavior
22. [ ] Verify dark mode works correctly

---

## Key Differences from Current Setup

| Current | New |
|---------|-----|
| Tailwind CSS | Kookie UI design system |
| Basic Next.js layout | DocsShell with sidebar navigation |
| No MDX | Full MDX support with syntax highlighting |
| Custom styling | Theme-aware components |
| No table of contents | Auto-generated ToC |

---

## Reference

- **Kookie Blocks docs**: `/Users/kushagradhawan/Code/kookie-blocks/apps/docs`
- **Kookie UI docs**: `/Users/kushagradhawan/Code/kookie-ui/apps/docs`
- **DocsShell source**: `/Users/kushagradhawan/Code/kookie-blocks/packages/kookie-blocks/src/components/docs/docs-shell.tsx`
- **Types**: `/Users/kushagradhawan/Code/kookie-blocks/packages/kookie-blocks/src/components/docs/types.ts`
