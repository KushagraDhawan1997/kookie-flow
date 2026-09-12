/**
 * CONTENT NEGOTIATION for the markdown twin.
 *
 * Every page on this site is already served twice — once as HTML and once as markdown at the
 * same path with `.md` on the end. What was missing is the half the web has had a mechanism
 * for since 1996: a client that says it wants markdown should get markdown from the CANONICAL
 * url, without knowing our spelling of the alternate. An agent handed a link in a message has
 * no reason to guess that `.md` is the suffix we chose, and `Accept` is how it asks.
 *
 * NOTHING ABOUT THE CONTENT CHANGES. The negotiated response is the twin's own route, reached
 * by a rewrite — one body, one `markdownFor()`, no second renderer. This file decides only
 * WHETHER, never WHAT.
 *
 * BY POSITION AND BY q, NEVER BY PRESENCE. Every browser's navigation header ends in a
 * wildcard range at q=0.8, so "does the header mention markdown" would serve a markdown
 * document to everyone. A real Chromium navigation ranks `text/html` first at q=1 and reaches
 * markdown only through that wildcard, and the ordering is what tells the two apart. A plain
 * `fetch()` sends the wildcard alone, which prefers NEITHER, and a tie goes to HTML: markdown
 * is served when it is asked for, not when nothing was.
 */

const HTML = "text/html";
const MARKDOWN = "text/markdown";

/** Where the twin lives, as a path this site actually routes. The `.md` URL is a rewrite onto
    the same handler (`next.config.mjs`), so a negotiated request and a `.md` request meet in one
    place rather than in two that agree. */
export const markdownRoute = (pathname: string): string => `/md${pathname}`;

/**
 * The `Link` header pointing a client at the twin.
 *
 * A RELATIVE URI-REFERENCE, which RFC 8288 permits and which is the only honest spelling here:
 * this repo states no site origin for the twin — `llms.ts` refuses to invent one and reads the
 * request's own `Host` instead — and a header is not a place to start. A client resolves it
 * against the request URL, which is the same answer with nothing made up.
 */
export const alternateLink = (pathname: string): string =>
  `<${pathname}.md>; rel="alternate"; type="text/markdown"`;

// How well one media range answers one type: an exact match beats `text/*` beats `*/*`, and a
// range that does not match at all scores nothing. RFC 9110's precedence rule, which is why
// `Accept: text/markdown;q=0, */*` means "not markdown" rather than "anything".
function specificity(range: string, type: string): number {
  const [wantType = "", wantSub = ""] = type.split("/");
  const [rangeType = "", rangeSub = ""] = range.split("/");
  if (rangeType === wantType && rangeSub === wantSub) return 3;
  if (rangeType === wantType && rangeSub === "*") return 2;
  if (rangeType === "*" && rangeSub === "*") return 1;
  return 0;
}

type Preference = { q: number; specificity: number; position: number };

/** What the header says about one type: the q-value of the most specific range that covers it,
    how specific that range was, and where it sits in the list. `null` when nothing covers it. */
function preferenceFor(accept: string, type: string): Preference | null {
  let best: Preference | null = null;
  const ranges = accept.split(",");
  for (let position = 0; position < ranges.length; position++) {
    const parts = (ranges[position] ?? "").trim().split(";");
    const range = (parts.shift() ?? "").trim().toLowerCase();
    const found = specificity(range, type);
    if (!found) continue;
    const quality = parts
      .map((part) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(part))
      .find((match) => match !== null);
    const q = quality ? Number(quality[1]) : 1;
    if (Number.isNaN(q)) continue;
    if (!best || found > best.specificity) best = { q, position, specificity: found };
  }
  return best;
}

/**
 * Does this request want the twin rather than the page?
 *
 * Only when markdown is ranked ABOVE html, and the ranking is read in three steps: q first,
 * then how specifically the header names each type, then position. A missing header, a header
 * that mentions neither, a bare wildcard, and every browser's navigation string all come back
 * false — each of them a tie, and a tie is not a request.
 *
 * SPECIFICITY OUTRANKS POSITION, and the case that forced it is `Accept: text/*, text/html`.
 * On q and position alone markdown wins that, because the wildcard covering it is written
 * first — so a client that named html exactly and markdown only by accident would be handed
 * markdown. Naming a type is a stronger statement than covering it, so markdown wins a tie
 * only where it was named as directly as html was.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const markdown = preferenceFor(accept, MARKDOWN);
  if (!markdown || markdown.q <= 0) return false;
  const html = preferenceFor(accept, HTML);
  if (!html || html.q <= 0) return true;
  if (markdown.q !== html.q) return markdown.q > html.q;
  if (markdown.specificity !== html.specificity) return markdown.specificity > html.specificity;
  return markdown.position < html.position;
}
