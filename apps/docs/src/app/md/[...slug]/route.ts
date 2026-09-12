import { PAGES, markdownFor } from "../../(docs)/markdown";

/**
 * THE MARKDOWN TWIN'S ROUTE.
 *
 * `/entities/model.md` reaches here. The `.md` suffix is a REWRITE in `next.config.mjs`,
 * because a file extension is not something the router can express: a segment either is a
 * dynamic parameter or is not, and `[...slug].md` is neither. So the URL a reader sees carries
 * the extension the convention asks for, and the route underneath it is an ordinary catch-all.
 *
 * The handler is one lookup and one response. Everything it knows about what a page contains
 * is in `markdown.ts` — this file must never grow a branch about a KIND of page, or the site
 * gains a second place that knows what a page is made of.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return PAGES.map((page) => ({ slug: page.path.replace(/^\//, "").split("/") }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  const body = markdownFor(slug.join("/"));
  // A 404 rather than a redirect to the HTML: a client that asked for markdown and is handed a
  // page of markup gets no error and a document it cannot read, which is the failure mode this
  // whole route exists to remove.
  if (!body) return new Response("Not found\n", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // The twin is generated from files in this repo, so it is exactly as fresh as a deploy.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
