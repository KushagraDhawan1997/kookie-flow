/**
 * Syntax highlighting, in the system's own colours, with the author's annotations.
 *
 * Shiki is the Base UI relationship one layer over: TextMate grammars are decades of
 * accumulated correctness nobody should rewrite, they are behaviour rather than appearance,
 * and they are invisible until someone paints them. So the grammars are theirs and every
 * colour is ours.
 *
 * The mechanism is Shiki's CSS-variables theme: instead of baking hexes, the tokenizer emits
 * `var(--code-token-*)` and the package's `CodeBlock` resolves those names against the ten
 * tones' SOLVED ink ladder (§15). That is the load-bearing part. A stock highlight theme is
 * a second colour system living inside the first — the one place on a site made of KookieUI
 * where the pixels would not be KookieUI's — and it would also be the only text on the page
 * held to no contrast target at all.
 *
 * THE PIPELINE IS `codeToHast`, NOT `codeToTokens`, and the reason is a fact about Shiki:
 * notation transformers only annotate the HAST — they never run in the token
 * pipeline. So the author's annotations (`// [!code highlight]`, `[!code ++]`, `[!code
 * focus]`, fence meta `{1,3}` and `/word/`) require walking the tree Shiki built. The walk
 * reduces it straight back to lines of tokens: nothing is trusted as markup, nothing is
 * `dangerouslySetInnerHTML`, and the renderer stays a map over plain data. The walk is LOUD:
 * a shape this file does not recognise throws rather than
 * degrading, because a silent one-char slice is how a negative assertion goes green.
 *
 * BOLD IS DROPPED, ITALIC IS KEPT, and the asymmetry is the type system's (§15: `bold` is
 * refused package-wide, and a value left reachable is one every call site can re-introduce).
 * Italic is not a weight and stays — it is the one signal separating a comment
 * from the code around it that does not spend a colour.
 */
import { createCssVariablesTheme, createHighlighter } from "shiki";
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";

/**
 * The languages the docs actually contain. Listed rather than bundled: Shiki loads grammars
 * on demand, and a docs build that pulls every grammar it ships pays for languages this
 * system has no samples in. `CodeSample` checks every fence against this list, so an unlisted
 * language fails the render instead of silently rendering as plain text (which is Shiki's
 * fallback, and reads exactly like a fence nobody got round to labelling).
 */
export const LANGS = ["tsx", "ts", "jsx", "js", "css", "json", "bash", "html", "mdx"] as const;

export type Lang = (typeof LANGS)[number];

export const isLang = (value: string): value is Lang => (LANGS as readonly string[]).includes(value);

/** Named once. `createCssVariablesTheme` types its result's `name` as optional, so reading it
    back at the call site is a nullable string the highlighter will not accept — the constant
    is what makes registering the theme and selecting it the same fact. */
const THEME_NAME = "kookie";

const theme = createCssVariablesTheme({
  name: THEME_NAME,
  variablePrefix: "--code-",
  // No defaults. A `var()` with a fallback would paint SOMETHING when a name is unresolved,
  // which is how a token that code.css forgot ends up looking deliberate — the material
  // edge's `initial` argument (§10), one system over. Unresolved here means invalid at
  // computed-value time, so the token falls back to the block's own foreground and the miss
  // is visible rather than plausible.
  variableDefaults: {},
  fontStyle: true,
});

/**
 * One highlighter for the whole build. Shiki's setup cost is grammar parsing, which is
 * per-process rather than per-call, so a module-level promise is the difference between
 * paying it once and paying it per code fence on a site that is mostly code fences.
 */
let highlighterPromise: ReturnType<typeof createHighlighter> | undefined;

const getHighlighter = () => {
  highlighterPromise ??= createHighlighter({ themes: [theme], langs: [...LANGS] });
  return highlighterPromise;
};

/** One token as the renderer needs it: the text, the colour to paint it, whether it is the
    italic kind, and whether the author pointed at this word. Shiki's richer shapes stop here
    on purpose — everything past these four fields is a decision this file has already made. */
export type CodeToken = {
  text: string;
  color?: string | undefined;
  italic: boolean;
  /** `[!code word:x]` or fence meta `/x/` — the author highlighting a word. */
  word: boolean;
};

/** One line, with every way an author can point at it. The flags are booleans rather than a
    class string because the renderer owns the class names — this file owns the FACTS. */
export type CodeLine = {
  tokens: CodeToken[];
  /** `// [!code highlight]` or fence meta `{1,3-5}`. */
  highlight: boolean;
  /** `// [!code ++]` / `// [!code --]` — a diff's added and removed lines. */
  add: boolean;
  remove: boolean;
  /** `// [!code focus]` — this line is the point; the rest stand down. */
  focus: boolean;
  /** `// [!code error]` / `// [!code warning]` — the line a message is about. */
  level?: "error" | "warning" | undefined;
};

export type HighlightedCode = {
  lines: CodeLine[];
  /** Any line focused — the renderer keys the stand-down of the others on it. */
  focused: boolean;
  /** Any line added or removed — the renderer gives EVERY line a marker gutter, because a
      diff's context lines must stay aligned with its marked ones. */
  diff: boolean;
};

/** The code as the reader receives it: annotations stripped, exactly what the copy button
    hands over and what a selection drags. One derivation, so the paint and the clipboard
    cannot disagree about what the code says. */
/**
 * How many columns of whitespace a line begins with.
 *
 * A wrapped row has to continue at the line's OWN indentation, and CSS cannot read that: the
 * leading whitespace is part of the line's text, so the only thing a stylesheet can hang from
 * is the pane's wall. Every renderer that gets this right — an editor, a terminal, a diff view
 * — knows the number because it laid the text out itself. Here the tokenizer already holds it,
 * so it is derived once, at build time, beside `plainText` and for the same reason: a fact
 * about a line, read off the tokens rather than reconstructed from the markup they produce.
 *
 * Columns, not pixels. The well is monospaced, so a column IS a `ch`, and the number crosses
 * into CSS as one — the same argument `code.css` makes for stating its own distances in `ch`.
 * TABS ARE COUNTED AS ONE COLUMN and no source shipped here should have any, because a tab's width is a rendering choice and honouring it would mean this file agreeing
 * with `tab-size` in two homes.
 */
export const leadingColumns = (line: CodeLine): number => {
  const text = line.tokens.map((token) => token.text).join("");
  return text.length - text.trimStart().length;
};

export const plainText = (lines: readonly CodeLine[]): string =>
  lines.map((line) => line.tokens.map((token) => token.text).join("")).join("\n");

/* ── The fence-meta vocabulary ─────────────────────────────────────────────────────────── */

/** What a fence's meta string can say, parsed by `parseMeta`. The chrome facts are ours;
    `{1,3-5}` and `/word/` stay in `rest` and ride Shiki's own meta transformers. */
export type FenceMeta = {
  title?: string | undefined;
  /**
   * `undefined` when the fence did not say, which is not the same as `false`. A consumer that
   * numbers every fence by default needs something to say NO with, and a two-state flag leaves
   * nothing — while a flag whose default flips makes every authored `lineNumbers` a no-op that
   * still reads as a decision. Three states: `lineNumbers` asks, `lineNumbers=false` refuses,
   * and silence is the consumer's own default.
   */
  lineNumbers?: boolean | undefined;
  maxLines?: number | undefined;
  bare: boolean;
  /** Whatever this file did not claim, handed to Shiki as the raw meta. */
  rest: string;
};

/**
 * Parse a fence's meta string — ```ts title="x.ts" lineNumbers=false maxLines=20 {1,3} — into
 * block's own props plus a remainder for Shiki. Closed vocabulary: an unrecognised WORD is
 * left in `rest` deliberately (Shiki's `{…}` and `/…/` live there), but the four claimed
 * directives are removed so they cannot also match as code words.
 */
export function parseMeta(meta: string | undefined): FenceMeta {
  let rest = meta ?? "";
  const take = (pattern: RegExp): string | undefined => {
    const match = pattern.exec(rest);
    if (!match) return undefined;
    rest = (rest.slice(0, match.index) + rest.slice(match.index + match[0].length)).trim();
    return match[1] ?? match[0];
  };
  const title = take(/title="([^"]*)"/);
  const maxLinesRaw = take(/(?:^|\s)maxLines=(\d+)(?=\s|$)/);
  /* `=true`/`=false` return the captured word; the bare form has no capture, so `take` gives
     back the whole match and anything that is not the literal "false" is an ask. */
  const lineNumbersRaw = take(/(?:^|\s)lineNumbers(?:=(true|false))?(?=\s|$)/);
  const lineNumbers = lineNumbersRaw === undefined ? undefined : lineNumbersRaw !== "false";
  const bare = take(/(?:^|\s)bare(?=\s|$)/) !== undefined;
  return {
    title,
    lineNumbers,
    maxLines: maxLinesRaw === undefined ? undefined : Number(maxLinesRaw),
    bare,
    rest: rest.trim(),
  };
}

/* ── The HAST walk ─────────────────────────────────────────────────────────────────────── */

/** The slice of HAST this file consumes, typed locally so the walk's assumptions are stated
    here rather than imported. Anything outside this shape throws in `tokenize`. */
type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: (HastElement | HastText | { type: string })[];
};

const isElement = (node: { type: string }): node is HastElement => node.type === "element";
const isText = (node: { type: string }): node is HastText => node.type === "text";

const classesOf = (node: HastElement): string[] => {
  const value = node.properties?.["class"] ?? node.properties?.["className"];
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(/\s+/);
};

/** All text under a node. Recursive because a transformer may nest a span; LOUD about any
    child kind that is neither element nor text, because swallowing one is how a token
    silently vanishes from the copy path. */
const textOf = (node: HastElement | HastText): string => {
  if (isText(node)) return node.value;
  return node.children
    .map((child) => {
      if (isText(child) || isElement(child)) return textOf(child);
      throw new Error(`highlight: unexpected ${child.type} node inside a token`);
    })
    .join("");
};

/** A token span's two styled facts, off its inline style string. The CSS-variables theme
    writes `color:var(--code-…)` and `font-style:italic`; bold (`font-weight`) is dropped
    here, which is the §15 refusal as a filter rather than a regex over emitted HTML. */
const styleOf = (node: HastElement): { color?: string; italic: boolean } => {
  const style = String(node.properties?.["style"] ?? "");
  const color = /(?:^|;)\s*color:([^;]+)/.exec(style)?.[1]?.trim();
  return { ...(color ? { color } : {}), italic: /font-style:\s*italic/.test(style) };
};

/**
 * Tokenize, returning LINES OF FLAGGED TOKENS rather than a string of HTML.
 *
 * `meta` is the fence's leftover meta string (after `parseMeta` took the chrome facts), so
 * `{1,3-5}` and `/word/` reach Shiki's own meta transformers unre-implemented.
 */
export async function tokenize(
  code: string,
  lang: Lang,
  meta?: string,
): Promise<HighlightedCode> {
  const highlighter = await getHighlighter();
  const root = highlighter.codeToHast(code.replace(/\n+$/, ""), {
    lang,
    theme: THEME_NAME,
    ...(meta ? { meta: { __raw: meta } } : {}),
    transformers: [
      transformerNotationDiff({ matchAlgorithm: "v3" }),
      transformerNotationHighlight({ matchAlgorithm: "v3" }),
      transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
      transformerNotationFocus({ matchAlgorithm: "v3" }),
      transformerNotationErrorLevel({ matchAlgorithm: "v3" }),
      transformerMetaHighlight(),
      transformerMetaWordHighlight(),
    ],
  }) as unknown as { children: { type: string }[] };

  const pre = root.children.find(isElement);
  if (!pre || pre.tagName !== "pre") throw new Error("highlight: no <pre> in Shiki's output");
  const codeEl = pre.children.find(isElement);
  if (!codeEl || codeEl.tagName !== "code") throw new Error("highlight: no <code> in <pre>");

  const lines: CodeLine[] = [];
  for (const child of codeEl.children) {
    // The lines are span.line elements separated by "\n" text nodes; the renderer stacks
    // lines as blocks, so the separators are dropped here rather than re-derived there.
    if (isText(child)) {
      if (/^\n+$/.test(child.value)) continue;
      throw new Error(`highlight: stray text between lines: ${JSON.stringify(child.value)}`);
    }
    if (!isElement(child)) throw new Error(`highlight: unexpected ${child.type} between lines`);
    const classes = classesOf(child);
    if (!classes.includes("line")) throw new Error(`highlight: a non-line span between lines`);
    const tokens: CodeToken[] = [];
    for (const span of child.children) {
      if (isText(span)) {
        // Shiki keeps a diff/highlight line's trailing newline inside the line span.
        if (/^\n$/.test(span.value)) continue;
        throw new Error(`highlight: bare text inside a line: ${JSON.stringify(span.value)}`);
      }
      if (!isElement(span)) throw new Error(`highlight: unexpected ${span.type} in a line`);
      const { color, italic } = styleOf(span);
      tokens.push({
        text: textOf(span).replace(/\n$/, ""),
        color,
        italic,
        word: classesOf(span).includes("highlighted-word"),
      });
    }
    lines.push({
      tokens,
      highlight: classes.includes("highlighted") && !classes.includes("error") && !classes.includes("warning"),
      add: classes.includes("diff") && classes.includes("add"),
      remove: classes.includes("diff") && classes.includes("remove"),
      focus: classes.includes("focused"),
      level: classes.includes("error") ? "error" : classes.includes("warning") ? "warning" : undefined,
    });
  }

  return {
    lines,
    focused: lines.some((line) => line.focus),
    diff: lines.some((line) => line.add || line.remove),
  };
}
