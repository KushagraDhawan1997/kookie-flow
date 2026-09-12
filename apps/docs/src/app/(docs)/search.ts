/**
 * The search TYPE and the MATCHER — the half that runs in the browser.
 *
 * Split from `search-index.ts` deliberately (2026-08-21). The index is built on the server by
 * reading chapter sources off disk, so that module imports `node:fs`; the palette is a client
 * component and imports the matcher. With both halves in one file the client bundle pulled
 * `node:fs` in through the type import and Turbopack failed the build outright — which is the
 * bundler doing exactly the right thing, and the reason this file exists.
 *
 * Nothing here touches the filesystem, the DOM or React. It is a pure function over data, so
 * it runs identically wherever it is called.
 */

export type SearchEntry = {
  title: string;
  /** Where it sits, shown under the title so two similarly-named results can be told apart. */
  context: string;
  href: string;
  /** What the matcher looks at, lowercased once at build time rather than per keystroke. */
  haystack: string;
};

/**
 * Rank matches. Deliberately simple and deliberately explained: a title that equals the query
 * beats one that starts with it, which beats one that contains it, which beats a body match.
 *
 * Nothing here is tuned. It is the least ranking that puts an exact chapter or heading name
 * first when you type one, which is what this site's search is mostly used for. If it ever needs to be
 * better than this, the answer is a real index (Pagefind) rather than more clauses.
 */
export function searchEntries(index: readonly SearchEntry[], query: string): SearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of index) {
    const title = entry.title.toLowerCase();
    if (title === needle) scored.push({ entry, score: 0 });
    else if (title.startsWith(needle)) scored.push({ entry, score: 1 });
    else if (title.includes(needle)) scored.push({ entry, score: 2 });
    else if (entry.haystack.includes(needle)) scored.push({ entry, score: 3 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map((row) => row.entry);
}
