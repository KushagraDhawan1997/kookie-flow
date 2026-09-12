import { readFileSync } from "node:fs";
import path from "node:path";

import { slugify } from "./slug";

/**
 * A chapter's table of contents, read from its SOURCE rather than from the rendered tree.
 *
 * Reading the source is the honest direction: the tree is a compiled artifact, and walking it
 * would mean rendering a chapter twice, once to find out what is in it. Reading the file
 * costs one `readFileSync` at build time and the result is static.
 *
 * The anchors come from `slugify` — the same function the heading mapping calls — so the
 * links and their targets cannot disagree. Two spellings of one identity is exactly how a
 * table of contents comes to scroll nowhere.
 */

export type TocEntry = { id: string; title: string; level: 2 | 3 };

/**
 * Where chapters live on disk. `process.cwd()` is apps/docs under `next dev` and `next build`
 * alike.
 *
 * The `src/content` segment is part of the constant rather than part of the caller's string,
 * and that is load-bearing: a bundler that cannot scope a filesystem read to a subfolder
 * traces the WHOLE project into the server bundle — the public folder and every source file
 * with it. Registry entries therefore name a path inside `src/content/`, never a path from the
 * app root.
 */
const CONTENT_ROOT = path.join(process.cwd(), "src", "content");

export function readChapterSource(source: string): string {
  return readFileSync(path.join(CONTENT_ROOT, source), "utf8");
}

/**
 * Extract `##` and `###` headings.
 *
 * FENCES ARE TRACKED, and that is not defensive coding — a fenced block containing a comment
 * line that begins with `##` is an ordinary thing to write, and a naive scan would put it in
 * the navigation. `####` and deeper are left out: a table of contents that mirrors every
 * heading stops being a summary.
 */
export function tableOfContents(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.*\S)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const title = match[2]
      // Strip the inline marks a heading can carry, so the navigation shows words rather
      // than syntax. The rendered heading resolves these to components; here they are noise.
      .replace(/[*_`]/g, "")
      .trim();
    entries.push({ id: slugify(title), title, level: match[1].length === 2 ? 2 : 3 });
  }
  return entries;
}

export const chapterToc = (source: string): TocEntry[] =>
  tableOfContents(readChapterSource(source));
