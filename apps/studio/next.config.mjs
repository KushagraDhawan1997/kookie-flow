import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* `next dev` otherwise writes an AGENTS.md and a CLAUDE.md into the app on every run; the
     repo's agent instructions live in the root CLAUDE.md. */
  agentRules: false,
  reactStrictMode: true,
  /* One Docker image for self-hosters: `next build` writes a server that needs only Node. The
     tracing root is the monorepo, or the workspace packages the app links to are left out. */
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '../../'),
  /* The migrations are read at runtime, and nothing imports them, so tracing cannot find them:
     without this a standalone server starts against a database with no tables. */
  outputFileTracingIncludes: { '/**': ['./drizzle/**'] },
  /* Both are TypeScript source in this workspace, compiled here rather than shipped as dist. */
  transpilePackages: ['@kushagradhawan/kookie-flow', 'studio-core'],
  /* PGlite is WASM loaded from its own package directory at runtime; bundling it breaks that. */
  serverExternalPackages: ['@electric-sql/pglite'],
  /* THE DEV SERVER IS LOOPBACK-ONLY, so this list is empty by default. No route checks who is
     asking, so anything that can reach the port can read, overwrite and delete every graph.
     `pnpm dev` binds 127.0.0.1; `pnpm dev:lan` is the deliberate opt-in for testing on a phone,
     and only then do these private-range origins get to load `/_next`. */
  allowedDevOrigins:
    process.env.STUDIO_LAN === '1' ? ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'] : [],
  /* THE LIBRARY FROM SOURCE, NOT FROM DIST. The studio is where the library gets changed for
     its own needs, and a change is only real here once it is on screen. Going through `dist`
     puts a separate watcher between an edit and the page. The two entry points are mapped to
     `src` by `paths` in tsconfig.json, which Next applies to bundling as well as to tsc — so the
     app's own compiler is the only step, and there is no second copy of the mapping here. A
     `paths` key with no `*` is an exact match, so the root entry never swallows `/plugins`. */
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
