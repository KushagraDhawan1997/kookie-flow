/**
 * MDX drops a fence's meta string — ```ts title="x.ts" {1} compiles to a `code` element
 * carrying only `className` and `children` (verified against @mdx-js/mdx 3.1.1 before this
 * existed). This plugin copies `node.meta` onto the element as `metastring`, which is the
 * name the ecosystem settled on, so the fence renderer in `mdx-components.tsx` can parse it.
 *
 * A LOCAL FILE, imported by `next.config.mjs`. This app compiles with webpack, whose MDX
 * loader takes plugin functions directly, so there is no path string to keep in step.
 *
 * Hand-walked rather than `unist-util-visit` — one recursive function is smaller than a
 * dependency, and the walk has exactly one job.
 */
export default function remarkFenceMeta() {
  const walk = (node) => {
    if (node.type === "code" && node.meta) {
      node.data ??= {};
      node.data.hProperties = { ...node.data.hProperties, metastring: node.meta };
    }
    if (node.children) for (const child of node.children) walk(child);
  };
  return walk;
}
