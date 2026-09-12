import { CHAPTERS, SECTIONS } from "./chapters";
import { chapterToc } from "./toc";
import type { SearchEntry } from "./search";

/**
 * The search index, built at build time out of our own data.
 *
 * NOT Pagefind, which is the better tool for a big site: it builds a real BM25 index over
 * rendered HTML and loads it in chunks. It wants an HTML directory to crawl AFTER the build and
 * a place to serve the index from, which in this app means a post-build step writing into a
 * directory the build has already finished with. That is a real amount of machinery for a site
 * of a dozen chapters whose content we already hold as structured data — the chapters, their
 * summaries and their headings.
 *
 * So this is a substring match over titles, headings and blurbs, built here and shipped as
 * JSON. It is honest about what it is: it will not find a word that appears only in the body
 * of a paragraph. When the site outgrows that, Pagefind is the upgrade and this file is what
 * it replaces — the search UI reads a list of results and does not care where they came from.
 */

export function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const chapter of CHAPTERS) {
    const headings = chapterToc(chapter.source);
    entries.push({
      title: chapter.title,
      // The section's own title rather than its id capitalised: "api" would read as "Api".
      context: SECTIONS.find((section) => section.id === chapter.section)?.title ?? chapter.section,
      href: `/${chapter.slug}`,
      haystack: `${chapter.title} ${chapter.blurb} ${headings.map((h) => h.title).join(" ")}`.toLowerCase(),
    });
    // Headings are indexed as their own results, because a reader searching "socket types"
    // wants the section, not the chapter that contains it eight screens down.
    for (const heading of headings) {
      entries.push({
        title: heading.title,
        context: chapter.title,
        href: `/${chapter.slug}#${heading.id}`,
        haystack: `${heading.title} ${chapter.title}`.toLowerCase(),
      });
    }
  }

  return entries;
}
