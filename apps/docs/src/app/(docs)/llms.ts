import { PAGES, markdownFor } from "./markdown";

/**
 * `llms.txt` and `llms-full.txt` (llmstxt.org, Answer.AI 2024).
 *
 * The half of this work that needs nobody to press anything: an index of the site at a
 * conventional path, so an agent handed only the domain can find every page without guessing a
 * URL or crawling markup. `llms.txt` is the contents; `llms-full.txt` is the whole site in one
 * fetch, which is what an agent asked to "use Kookie Flow" actually wants.
 *
 * THE ORIGIN IS AN ARGUMENT, not a constant and not a lookup. Inventing a site URL here would
 * be a fact that is wrong on every deploy but one, including the localhost the author reads it
 * on. The request already carries the answer, so the ROUTE reads the header and these two
 * functions take a string: everything that touches the framework is at the edge, and
 * everything worth checking is a pure function of one input.
 */
export function originFrom(head: Headers): string {
  const host = head.get("host") ?? "localhost:3000";
  const proto =
    head.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** The one sentence at the top of both files. What this site is, before any list of it. */
const SUMMARY =
  "A WebGL-native node graph library for React: entities are instanced meshes, edges are batched GPU geometry and text is drawn through MSDF shaders. Every page below is available as markdown by adding `.md` to its path.";

export function llmsIndex(base: string): string {
  const out = [`# Kookie Flow`, ``, `> ${SUMMARY}`, ``];
  // GROUPED BY THE SITE'S OWN CONTEXT, in the site's own order. The spec asks for sections and
  // the sections it wants are the ones a reader already navigates by, so nothing here invents a
  // taxonomy: `PAGES` carries the context each page states about itself.
  let heading = "";
  for (const page of PAGES) {
    if (page.context !== heading) {
      // A blank line BEFORE each heading but the first: the preamble already ends with one,
      // and a stray second blank is the sort of thing nothing on this site would ever show.
      if (heading) out.push(``);
      heading = page.context;
      out.push(`## ${heading}`, ``);
    }
    out.push(`- [${page.title}](${base}${page.path}.md): ${page.blurb}`);
  }
  return `${out.join("\n")}\n`;
}

export function llmsFull(base: string): string {
  const parts = [`# Kookie Flow`, ``, `> ${SUMMARY}`, ``];
  for (const page of PAGES) {
    const body = markdownFor(page.path);
    if (!body) continue;
    // A RULE AND A SOURCE LINE between documents, because concatenation loses the boundary: a
    // heading is the only thing separating one page's last table from the next page's opening,
    // and every page here opens at `#`. The URL is a fact about where the document came from,
    // which is the one thing a reader of the concatenation cannot otherwise recover.
    parts.push(`---`, ``, `Source: ${base}${page.path}`, ``, body.trim(), ``);
  }
  return `${parts.join("\n")}\n`;
}

/** One response shape for both, so a header cannot drift between two files. */
export const asText = (body: string): Response =>
  new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
