import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * The first gate every request passes.
 *
 * THREE CHECKS, and none covers another.
 *
 * A page on another site can make the browser send a plain POST with a `text/plain` body and no
 * preflight. The route reads it with `request.json()` regardless of the content type, so such a
 * request could overwrite or delete a graph. `Sec-Fetch-Site` is what the browser itself says
 * about where the request came from, and it cannot be forged by page script, so a mutating
 * request that says `cross-site` is refused.
 *
 * DNS rebinding defeats that check entirely: the attacker's page ends up on an origin the
 * browser considers the same, so it sends `same-origin` and reads the replies. What it cannot
 * change is the `Host` header, which still carries the attacker's own name. So the Host must be
 * one we expect. `STUDIO_ALLOWED_HOSTS` is the escape for a real deployment: a comma-separated
 * list of host names, with or without a port.
 *
 * A request with no session cookie goes to sign-in (a page) or gets a 401 (the API). This is only
 * the cheap early answer: a cookie is not a session, and every route checks the session itself
 * (`server/session.ts`). The open paths are sign-in, Better Auth's own routes, and Stripe's
 * webhook, which proves itself with a signature instead of a cookie.
 */

const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'];

const allowedHosts = new Set(
  [...LOCAL, ...(process.env.STUDIO_ALLOWED_HOSTS ?? '').split(',')]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    // A port is the deployment's business, not an identity: compare names only.
    .map((h) => h.replace(/:\d+$/, ''))
);

const OPEN_PATHS = ['/sign-in', '/api/auth', '/api/billing/webhook'];

/** The address the app is configured at (`BETTER_AUTH_URL`), or null when unset or unreadable. */
function canonicalOrigin(): URL | null {
  const stated = process.env.BETTER_AUTH_URL;
  if (!stated) return null;
  try {
    return new URL(stated);
  } catch {
    return null;
  }
}

function isOpen(path: string): boolean {
  return OPEN_PATHS.some((open) => path === open || path.startsWith(`${open}/`));
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!allowedHosts.has(host)) {
    return NextResponse.json({ error: 'unrecognised host' }, { status: 403 });
  }

  const path = request.nextUrl.pathname;
  const api = path.startsWith('/api/');

  // ONE ADDRESS. `localhost` and `127.0.0.1` are the same server and different sites to a browser:
  // a session made on one is invisible on the other. A page asked for under the other name is sent
  // to the one the app is configured at, before anyone signs in there.
  // Judged by the Host header the browser sent, not `request.nextUrl`: the dev server can report
  // `localhost` there whatever was asked for.
  //
  // NOT A 307. Next rewrites a redirect's Location to a bare path when it thinks the target is its
  // own origin, and `localhost` and `127.0.0.1` are the same server to it: the browser was sent back
  // to the address it asked for, forever. A page that moves itself is not rewritten.
  const canonical = canonicalOrigin();
  if (!api && canonical && request.method === 'GET') {
    const sent = (request.headers.get('host') ?? '').toLowerCase();
    if (sent && sent !== canonical.host) {
      const here = request.nextUrl;
      // `href` percent-encodes quotes and angle brackets; `&` is the only character left to escape.
      const target = new URL(here.pathname + here.search, canonical).href;
      const attribute = target.replace(/&/g, '&amp;');
      const html = `<!doctype html><meta http-equiv="refresh" content="0;url=${attribute}"><script>location.replace(${JSON.stringify(target)})</script><a href="${attribute}">Continue</a>`;
      return new NextResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  }

  const method = request.method.toUpperCase();
  const site = request.headers.get('sec-fetch-site');
  // `none` is a typed URL or a bookmark; older browsers send nothing at all, and those fall
  // through to the Host check above rather than being refused outright.
  if (api && method !== 'GET' && method !== 'HEAD' && site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
  }

  if (!isOpen(path) && !getSessionCookie(request)) {
    if (api) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = path === '/' ? '' : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Everything but Next's own assets and the public files the sign-in page itself needs (the icon,
// the brand fonts): pages need the redirect as much as the API needs the refusal.
export const config = { matcher: ['/((?!_next/|fonts/|favicon.ico|icon.svg).*)'] };
