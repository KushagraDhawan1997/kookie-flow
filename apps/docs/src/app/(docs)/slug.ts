/**
 * One slug function, and the reason it is a module rather than two lines inlined twice.
 *
 * Heading anchors are written in the MDX component mapping (from a React node) and the table
 * of contents is built by reading the same file's SOURCE (from a markdown line). Two
 * implementations of one identity is how a link comes to scroll nowhere, so both sides call
 * this, and that failure becomes impossible rather than unlikely.
 */

/** Flatten a React node to the words it renders. The heading mapping receives children, not
    text, and a heading containing `<Code>` or a link still has to produce a stable anchor. */
export function nodeText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return nodeText(props?.children);
  }
  return "";
}

/**
 * A heading's anchor. Lowercased, punctuation dropped, runs of anything else collapsed to a
 * single hyphen — the conventional shape, so a link written by hand in prose lands where a
 * reader expects.
 *
 * Note what is NOT here: a uniqueness counter. Two identical headings on one page would
 * produce one anchor — a chapter with two sections of the same name is a writing problem, and
 * a generated `-1` suffix hides it while making the link order-dependent.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
