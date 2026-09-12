import { CHAPTERS, SECTIONS } from "./chapters";
import { readChapterSource } from "./toc";
import { readExampleSource } from "./example";

/**
 * THE MARKDOWN TWIN: every page on this site, served a second time as plain markdown at the
 * same path with `.md` on the end.
 *
 * The convention is settled and we are late to it rather than early — Next.js, Adobe's React
 * Spectrum and Chakra all serve one, and llmstxt.org names the same spelling. What varies
 * between them is only what the twin CONTAINS, and that is where this file makes its one
 * decision.
 *
 * WHY THE TWIN IS THE FEATURE AND THE MENU IS THE DOORBELL. Every "Open in ChatGPT" link on
 * the web is a query parameter carrying one sentence that names a URL; the model then fetches
 * it. Without a markdown URL to name, the whole pattern is a menu of links to HTML pages,
 * which is the thing it replaced. So this file is the work and `page-actions.tsx` is five buttons.
 *
 * WHAT A TWIN CONTAINS, AND NOTHING ELSE. No attribution line, no "built with", no preamble
 * addressed to the reader's model. Mintlify injects its own name into the markdown people
 * copy and was publicly called out for it as prompt injection, which is the correct name for
 * it: a document that reaches an agent's context may not carry text that is not the document.
 * The page's own words, and the page's own words only.
 *
 * DERIVED, NEVER AUTHORED. Nothing here is a second copy of anything: a chapter's twin IS the
 * `.mdx` file the page compiles, and an example inside it is the same example file the page
 * renders. A twin that was written beside the page it mirrors would be this repo's
 * most-repeated defect wearing a new hat.
 */

/** Everything this site serves a twin for. The ORDER is the site's own reading order. */
export type PageRef = { path: string; title: string; context: string; blurb: string };

/** A section's title by its id, so a page's context is the heading the sidebar already shows
    rather than a capitalised id — `api` is "API reference", not "Api". */
const SECTION_TITLE = new Map(SECTIONS.map((section) => [section.id, section.title]));

export const PAGES: PageRef[] = CHAPTERS.map((chapter) => ({
  path: `/${chapter.slug}`,
  title: chapter.title,
  context: SECTION_TITLE.get(chapter.section) ?? chapter.section,
  blurb: chapter.blurb,
}));

const CHAPTER_BY_SLUG = new Map(CHAPTERS.map((chapter) => [chapter.slug, chapter]));

/**
 * A path to its markdown, or `null` where this site serves no page.
 *
 * ONE ENTRY POINT, because the route handler asking "which page is this" would be a second
 * place that knows the answer. A chapter's own slug carries its section, so the lookup is the
 * whole of it.
 */
export function markdownFor(pagePath: string): string | null {
  const slug = pagePath.replace(/^\/+|\/+$/g, "");
  const chapter = CHAPTER_BY_SLUG.get(slug);
  return chapter ? chapterMarkdown(chapter) : null;
}

/**
 * A fenced block, as ONE string.
 *
 * Paragraphs are joined by blank lines, which is right for prose and wrong inside a fence,
 * where the opening line and the code are one unit. Harmless to a parser, and the sort of
 * thing nobody would ever have seen, since the only readers of this document are machines.
 */
const fence = (code: string, lang = "tsx"): string => `\`\`\`${lang}\n${code.trim()}\n\`\`\``;

/**
 * A chapter's twin: its title, then the file.
 *
 * The heading is prepended because the page's title lives in `chapters.ts` and not in the
 * `.mdx` — the renderer puts it there, so the twin has to as well or every chapter's markdown
 * opens mid-sentence.
 *
 * ONE COMPONENT IS EXPANDED RATHER THAN STRIPPED, because the words a reader needs are not in
 * the file. `<Example />` renders a live specimen, and a plain-text reader cannot see a
 * rendered panel, so the twin carries the specimen's SOURCE: the same file, in a fence, which
 * is what a reader with no pixels can actually use.
 *
 * It is an expansion rather than a compiler. Nothing else in `content/` is JSX, so this list
 * grows only when a chapter genuinely needs a component.
 */
function chapterMarkdown(chapter: { title: string; source: string }): string {
  const source = readChapterSource(chapter.source).replace(
    /^\s*<Example\s+name="([^"]+)"[^>]*\/>\s*$/gm,
    (_match: string, name: string) => fence(readExampleSource(String(name))),
  );
  return `# ${chapter.title}\n\n${source.trim()}\n`;
}
