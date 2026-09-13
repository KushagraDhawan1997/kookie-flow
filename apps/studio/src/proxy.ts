import { NextResponse, type NextRequest } from 'next/server';

/**
 * The only guard the API has while there is no sign-in.
 *
 * TWO ATTACKS, TWO CHECKS, and neither is covered by the other.
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
 * one we expect. That is the check the loopback bind cannot make on its own, and it is why this
 * runs in production too, where nothing else guards these routes.
 *
 * `STUDIO_ALLOWED_HOSTS` is the escape for a real deployment: a comma-separated list of host
 * names, with or without a port.
 */

const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'];

const allowedHosts = new Set(
  [...LOCAL, ...(process.env.STUDIO_ALLOWED_HOSTS ?? '').split(',')]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    // A port is the deployment's business, not an identity: compare names only.
    .map((h) => h.replace(/:\d+$/, ''))
);

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!allowedHosts.has(host)) {
    return NextResponse.json({ error: 'unrecognised host' }, { status: 403 });
  }

  const method = request.method.toUpperCase();
  const site = request.headers.get('sec-fetch-site');
  // `none` is a typed URL or a bookmark; older browsers send nothing at all, and those fall
  // through to the Host check above rather than being refused outright.
  if (method !== 'GET' && method !== 'HEAD' && site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
