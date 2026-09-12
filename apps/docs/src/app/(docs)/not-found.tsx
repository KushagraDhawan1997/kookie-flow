import { NotFoundBody } from "./not-found-body";

/**
 * The 404 for a URL that MATCHED a docs route and found no chapter — `/entities`, say,
 * which `[...slug]` matches and then hands to `notFound()`.
 *
 * It draws no chrome, and the absence is the whole point: every layout above this boundary is
 * kept, so `layout.tsx` has already rendered `DocsChrome` around whatever lands here. The root
 * `app/not-found.tsx` is the other case — nothing matched, no group layout ran — and it wraps
 * the same body in the chrome itself.
 */
export default function DocsNotFound() {
  return <NotFoundBody />;
}
