import nextMDX from '@next/mdx';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../packages/kookie-flow/package.json');

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

/**
 * MDX as a LOADER, not a framework.
 *
 * The compiler is the hard, settled, appearance-free thing. What a docs framework adds around
 * it (a nav tree from a directory, a table of contents, prev/next, a content watcher) is a
 * bundle of easy things we would be trading a shape for, so the glue is ours and the compiler
 * is theirs.
 *
 * TWO PLUGINS, and both are syntax plugins rather than appearance ones. GitHub-Flavoured
 * Markdown is what makes `| a | b |` a table; without it a pipe table compiles to literal
 * text. `mdx-components.tsx` still decides what a table LOOKS like — remark only decides that
 * one exists. The second is ours (`mdx-plugins/remark-fence-meta.mjs`): MDX drops a fence's
 * meta string, and the fence renderer needs it for `title=` / `lineNumbers` / `{1,3}`.
 *
 * HIGHLIGHTING DELIBERATELY DOES NOT RIDE A PLUGIN HERE. `mdx-components.tsx` maps `pre` to the
 * same CodeSample the examples use instead, so prose fences and example sources highlight
 * through one function rather than drifting apart.
 *
 * PATH STRINGS, NOT FUNCTIONS. Turbopack compiles this app, and it hands plugin options to Rust,
 * which cannot receive a JavaScript function — so each plugin is named by a string it resolves
 * itself. The local plugin is an ABSOLUTE path: a relative string is resolved as a module
 * specifier from the loader's own context, where it finds nothing.
 */
const withMDX = nextMDX({
  options: {
    remarkPlugins: [
      ['remark-gfm', {}],
      new URL('./mdx-plugins/remark-fence-meta.mjs', import.meta.url).pathname,
    ],
  },
});

/**
 * Every chapter URL that no longer exists, and the chapter that took its place.
 *
 * Each old URL points STRAIGHT at its final chapter, never at another old URL: a chain of
 * redirects costs a round trip per hop, and a crawler may stop following before the last one.
 * The `/docs/<name>` spellings are the oldest; the `/concepts`, `/plugins` and older `/api`
 * spellings came after them and went when the chapters were regrouped.
 */
const MOVED_CHAPTERS = [
  ['/docs/installation', '/start/installation'],
  ['/docs/quick-start', '/start/quick-start'],
  ['/docs/nodes', '/entities/model'],
  ['/docs/edges', '/edges/edges'],
  ['/docs/grouping', '/entities/frames'],
  ['/docs/plugins/clipboard', '/data/clipboard'],
  ['/docs/plugins/keyboard-shortcuts', '/interaction/keyboard'],
  ['/docs/plugins/undo-redo', '/data/history'],
  ['/docs/plugins/context-menu', '/interaction/context-menu'],
  ['/docs/api/kookie-flow', '/api/kookie-flow'],
  ['/docs/api/use-graph', '/start/state'],
  ['/docs/api/use-flow-store-api', '/data/store'],
  ['/concepts/nodes', '/entities/model'],
  ['/concepts/edges', '/edges/edges'],
  ['/concepts/grouping', '/entities/frames'],
  ['/plugins/clipboard', '/data/clipboard'],
  ['/plugins/keyboard-shortcuts', '/interaction/keyboard'],
  ['/plugins/undo-redo', '/data/history'],
  ['/plugins/context-menu', '/interaction/context-menu'],
  ['/api/use-graph', '/start/state'],
  ['/api/use-flow-store-api', '/data/store'],
];

/**
 * The markdown twins of the regrouped chapters. Only the `/<section>/<name>` spellings had a
 * twin; the `/docs` pages never did.
 */
const MOVED_TWINS = MOVED_CHAPTERS.filter(([source]) => !source.startsWith('/docs/')).map(
  ([source, destination]) => [`${source}.md`, `${destination}.md`],
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* `next dev` otherwise writes an AGENTS.md and a CLAUDE.md into the app on every run. This repo
     keeps its agent instructions in the root CLAUDE.md, and a second copy the framework rewrites
     is an uninvited voice in the place the rules live — the same call the KookieUI docs make. */
  agentRules: false,
  reactStrictMode: true,
  /* THE DEV SERVER SERVES A PHONE ON THE LAN. The dev server refuses `/_next/*` for any
     browser origin it was not told about: the HTML arrives, every chunk is refused, nothing
     hydrates, and the page reads as a site whose JavaScript never loaded. Private-network
     ranges and mDNS names cover a phone on the same Wi-Fi whatever address it gets. Dev only;
     production has no such guard. */
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],
  pageExtensions: ['ts', 'tsx', 'mdx'],
  env: {
    KOOKIE_FLOW_VERSION: packageJson.version,
  },
  /* THE LIBRARY FROM SOURCE, NOT FROM DIST, as the studio does. The two entry points are mapped to
     `src` by `paths` in tsconfig.json, which Next applies to bundling as well as to tsc, so the
     app's own compiler is the only step. Through `dist` a stalled `tsup --watch` left the docs
     showing a ten-hour-old library while the studio showed the current one. The built package is
     still exercised as a consumer gets it by the harness, which builds it. */
  transpilePackages: ['@kushagradhawan/kookie-flow'],
  trailingSlash: false,
  /* Old chapter URLs live in issues, READMEs and search indexes, and a moved page that 404s
     punishes exactly the person who shared it. Permanent, because the old names are not coming
     back. Redirects run before rewrites, so a moved twin is redirected before the `.md` rewrite
     below can send it to a handler that no longer knows it. */
  async redirects() {
    return [
      { source: '/docs', destination: '/start/installation', permanent: true },
      ...[...MOVED_CHAPTERS, ...MOVED_TWINS].map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),
    ];
  },
  /**
   * THE MARKDOWN TWIN'S URL. Every page is served a second time as plain markdown at its own
   * path with `.md` on the end — the convention Next's own docs, Adobe's React Spectrum and
   * Chakra all follow, and the one llmstxt.org names.
   *
   * A REWRITE RATHER THAN A ROUTE, because a file extension is not something the App Router
   * can express: a path segment either is a dynamic parameter or is not, and `[...slug].md`
   * is neither. The handler underneath is an ordinary catch-all at `/md/*`.
   *
   * The negative lookahead is load-bearing in one direction only — nothing under `_next`
   * ends in `.md` today — but a build artifact routed into a markdown handler would 404 with
   * no explanation, and this is one character of defence against a class of bug that is very
   * hard to see.
   */
  async rewrites() {
    return [{ source: '/:slug((?!_next/).*)\\.md', destination: '/md/:slug' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

export default withMDX(nextConfig);
