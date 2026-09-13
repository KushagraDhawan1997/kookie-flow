import { NextResponse, type NextRequest } from "next/server";

import { alternateLink, markdownRoute, prefersMarkdown } from "./app/(docs)/negotiate";

/**
 * The canonical URL answers in markdown when a client asks for markdown.
 *
 * The twin is served at `<path>.md`, which requires the caller to know our spelling. `Accept`
 * is the platform's own way to ask, and this is the seam where the question gets answered: a
 * rewrite onto the twin's existing route, so there is one body and one `markdownFor()` rather
 * than a second renderer that agrees.
 *
 * TWO HEADERS, AND ONLY ONE OF THEM SURVIVES ON THE HTML BRANCH.
 *
 * Both are set here. The `Link` naming the alternate reaches the wire on every page, so a
 * client that would rather fetch the twin directly can find it without being told the
 * convention — the same job `llms.txt` does for the site as a whole, one page at a time.
 *
 * `Vary: Accept` reaches the wire on the NEGOTIATED branch and not on the other one. Next's App
 * Router writes its own `Vary: rsc, next-router-state-tree, …, Accept-Encoding` over whatever a
 * response carries, and it does so after both this file and `next.config.mjs`'s `headers()`
 * have had their turn. There is no third place to set it short of a custom server.
 *
 * WHAT THAT COSTS, stated rather than glossed: a shared cache can store the HTML for this URL
 * without knowing the response varies, and later hand that HTML to a client that asked for
 * markdown. It cannot do the reverse — the markdown response DOES carry `Vary: Accept` — so the
 * failure is an agent receiving a page it can still read, and the `Link` header on it names the
 * twin. The dangerous direction, a person receiving a markdown file, is the one that is closed.
 *
 * THE MATCHER IS AUTHORED, and it has to be: Next statically analyses this object at build
 * time, so a list derived from `PAGES` would be read as no list at all. It cannot import
 * `PAGES` either — that module reaches the filesystem and every chapter's compiled MDX. So the
 * shape of a page URL is written here, and a new section in `chapters.ts` owes a new name in
 * this alternation or it quietly loses its negotiation.
 *
 * Every path this site serves a twin for is two segments: a chapter carries its section
 * (`start/installation`). The dot exclusion keeps `/entities/model.md` out — the proxy runs
 * BEFORE `next.config.mjs`'s rewrites, so the twin's own URL arrives here first and must be
 * left to the route it already has. Naming the sections rather than matching any two segments
 * is also what keeps `_next`, static files and the full-screen demo routes out of this file.
 */
export const config = {
  matcher: ["/((?:start|entities|edges|data|interaction|styling|api)/[^/.]+)"],
};

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const response = prefersMarkdown(request.headers.get("accept"))
    ? NextResponse.rewrite(new URL(markdownRoute(pathname), request.url))
    : NextResponse.next();
  response.headers.set("Vary", "Accept");
  response.headers.set("Link", alternateLink(pathname));
  return response;
}
