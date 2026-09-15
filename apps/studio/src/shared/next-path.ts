/**
 * Where to go after signing in, from a `?next=` the address bar carries. Only a path on this site:
 * `//evil.example` and `https://…` are addresses elsewhere, and following them would make the
 * sign-in page an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
