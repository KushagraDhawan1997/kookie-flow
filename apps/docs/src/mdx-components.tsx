/**
 * Markdown, resolved into KookieUI.
 *
 * This file is the whole reason the docs can use a compiler without using a framework: MDX
 * hands over an element name, and every answer here is a component from the package. A `##`
 * is a `<Heading>` on the house ladder, a paragraph is `<Text>` at the reading step, a fence
 * is the same `CodeSample` the examples use, a rule is a `<Separator>`. Nothing in a chapter
 * can paint a colour or invent a distance, because a chapter has no vocabulary for either.
 *
 * VERTICAL RHYTHM IS THE CALLER'S, and it has to be: components never own outer spacing. The
 * chapter page puts the whole flow in a `<Stack>`, so the base distance between blocks is that
 * gap; a heading adds to it through `<Box mt>`, the sanctioned escape.
 *
 * THE RHYTHM IS STATED. One distance doing four jobs — paragraph to paragraph, paragraph to
 * code block, heading to its own body — fuses paragraphs into a wall and makes a fence read as
 * another paragraph. Within-group and between-group intervals must differ by at least two
 * layout-space steps.
 *
 * Four intervals, each meaning exactly one thing, and each landing ON a layout-space step
 * rather than between two (`mt` composes with the flow gap, so the sum is what the eye reads):
 *
 *   sibling to sibling      16  (`FLOW_GAP` alone)          — two thirds of the 24px line
 *   heading to its body     16  (`FLOW_GAP` alone)          — a heading belongs to what follows
 *   figure, top and bottom  32  (`FIGURE_MARGIN` + gap)     — a fence is not another paragraph
 *   subsection break (h3)   40  (`mt="6"` + gap)
 *   section break (h2)      48  (`mt="7"` + gap)
 *
 * Heading space is asymmetric by 3:1, which is the reason a section break reads as one instead
 * of as a slightly larger paragraph gap.
 *
 * THE MEASURE IS SPLIT FROM THE FIGURE WIDTH, and that split is what buys both halves.
 * Narrowing the whole column would cramp every code sample, so `prose.css` gives text
 * `--kd-measure` and lets a figure keep the column. They share a left edge, so there is still
 * one axis; only the right edge differs, which is the arrangement HIG and Material both use
 * for the same reason.
 *
 * ONE ELEMENT HAS NO COMPONENT TO RESOLVE TO — the list — and it is handled here in the only
 * honest way: the semantic element, kept for what it announces, with its type coming from
 * `<Text render>` and its remaining details from `prose.css` in tokens.
 */
import * as React from "react";
import type { MDXComponents } from "mdx/types";
import NextLink from "next/link";
import {
  Blockquote,
  Box,
  Code,
  Heading,
  Link,
  Separator,
  Stack,
  Text,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kookie-ui/react";

import { CodeSample } from "./blocks/code-sample";
import { parseMeta } from "./blocks/highlight";
import { Example } from "./app/(docs)/example";
import { nodeText, slugify } from "./app/(docs)/slug";
import type { TypeSize } from "@kookie-ui/react";

/** The distance between two ordinary siblings, and the only one this file states twice — it
    is also the distance under a heading, because those are the same relationship seen from
    two sides: a block and the block it belongs with. */
const FLOW_GAP = "5";

/** What a figure adds on EACH side, on top of the flow gap. A fence, an example and a table
    are not paragraphs, and the eye needs to be told that before it reads the contents. */
const FIGURE_MARGIN = "5";

/** A heading that carries its own anchor. The id is what the table of contents links to and
    what a URL fragment lands on, so it is computed from the rendered words through the one
    slug function both sides share (`slug.ts`).

    `marginTop` is what the level MEANS, not a decoration on it: composed with `FLOW_GAP` it
    is the break the reader is being asked to take, and the ladder above states each sum. */
function anchored(level: 2 | 3 | 4, size: TypeSize, marginTop: "3" | "6" | "7") {
  const Component = ({ children }: { children?: React.ReactNode }) => {
    const id = slugify(nodeText(children));
    const element =
      level === 2 ? <h2 id={id} /> : level === 3 ? <h3 id={id} /> : <h4 id={id} />;
    return (
      <Box mt={marginTop}>
        <Heading size={size} render={element}>
          {children}
        </Heading>
      </Box>
    );
  };
  Component.displayName = `MdxH${level}`;
  return Component;
}

/** A block that is not prose. It takes air on both sides and it keeps the column rather than
    the reading measure — `prose.css` narrows everything else. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <Box my={FIGURE_MARGIN} className="kd-figure">
      {children}
    </Box>
  );
}

/**
 * Pull the fence apart. MDX gives `<pre>` exactly one child — a `<code>` carrying the source
 * as text and the language as `language-*` — so this reads both off that child and renders
 * `CodeSample` instead of either element. The `code` mapping below therefore never sees a
 * fenced block: it is the INLINE case only, which is why it can be `<Code>` unconditionally.
 */
function fence(props: { children?: React.ReactNode }): React.ReactElement {
  const child = React.Children.only(props.children) as React.ReactElement<{
    className?: string;
    children?: string;
    metastring?: string;
  }>;
  const className = child.props.className ?? "";
  const lang = className.replace(/^language-/, "") || "tsx";
  const code = typeof child.props.children === "string" ? child.props.children : "";
  // The fence's meta string — ```ts title="x.ts" lineNumbers maxLines=20 {1,3} /word/ —
  // put on the element by our remark plugin (MDX drops it otherwise). The chrome facts
  // become props; what parseMeta does not claim rides through to Shiki's own directives.
  const meta = parseMeta(child.props.metastring);
  /* NUMBERED UNLESS THE FENCE REFUSES. The chapters and the figures agree — a reader pointing
     at a line has somewhere to point in both — and `lineNumbers=false` is what a fence says
     when it is one command with nothing to count.

     The default lives HERE and not in the block: numbering every sample is this site's house
     rule, and `code-sample.tsx` is copied source that must not arrive carrying it. */
  return (
    <Figure>
      <CodeSample
        code={code}
        lang={lang}
        {...(meta.title !== undefined ? { title: meta.title } : {})}
        {...(meta.bare ? { bare: true } : {})}
        {...((meta.lineNumbers ?? true) ? { lineNumbers: true } : {})}
        {...(meta.maxLines !== undefined ? { maxLines: meta.maxLines } : {})}
        {...(meta.rest ? { meta: meta.rest } : {})}
      />
    </Figure>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // A chapter never renders its own `h1` — the page does, from the registry, so the title
    // in the navigation and the title on the page are one fact. An `h1` inside a chapter is
    // a second one.
    // THE LADDER, and the jump between rungs is the point. Adjacent levels should differ by at
    // least 1.33x, or the hierarchy is a rounding error wearing a hierarchy's name.
    //
    // 40 / 24 / 18: 1.67 then 1.33, both real. The section heading is CALM rather than loud,
    // because the 48px break above it is what says "new section" — space ranks more cheaply
    // than size, and it does not have to shout over the title to do it.
    h2: anchored(2, "6", "7"),
    h3: anchored(3, "4", "6"),
    // Chapters do not go deeper than `h3`. Mapped anyway, so a stray heading degrades to a
    // small one rather than to an unstyled UA `<h4>`.
    h4: anchored(4, "3", "3"),

    p: ({ children }) => (
      <Text size="3" render={<p />}>
        {children}
      </Text>
    ),

    // Reading-length prose rests LOUD (full contrast is the accessible resting state for
    // reading), so emphasis appears nowhere in this file's paragraphs. `strong` is a weight
    // step, never a colour or a rung.
    strong: ({ children }) => (
      <Text weight="medium" render={<strong />}>
        {children}
      </Text>
    ),
    em: ({ children }) => <em>{children}</em>,

    // `<Text render>` gives the list the ramp step and the ink; every `li` inherits both,
    // and a nested list re-wraps and inherits again. Indent and marker colour are the two
    // things left over, and they live in prose.css because the system has no list to ask.
    ul: ({ children }) => (
      <Text size="3" render={<ul className="kd-list" />}>
        {children}
      </Text>
    ),
    ol: ({ children }) => (
      <Text size="3" render={<ol className="kd-list" />}>
        {children}
      </Text>
    ),
    li: ({ children }) => <li>{children}</li>,

    blockquote: ({ children }) => <Blockquote>{children}</Blockquote>,
    // A thematic break outranks a figure, so it takes more air than one: 40px a side.
    hr: () => (
      <Box my="6">
        <Separator />
      </Box>
    ),
    code: ({ children }) => <Code>{children}</Code>,
    pre: fence,

    /**
     * An internal link is `next/link`; an external one is a plain anchor that says where it
     * goes. Both are the package's `Link`, which carries the ink, the underline and the states.
     */
    a: ({ href, children }) => {
      const target = href ?? "";
      const external = /^https?:/.test(target);
      return (
        <Link
          render={
            external ? (
              <a href={target} rel="noreferrer noopener" target="_blank" />
            ) : (
              <NextLink href={target} />
            )
          }
        >
          {children}
        </Link>
      );
    },

    // Tables: the package's own static `Table`. Markdown's `align` attribute is dropped: the
    // package's word is `align` on the head and the cell, and a chapter that needs a numeric
    // column writes the JSX.
    table: ({ children }) => (
      <Figure>
        <Table size="3">{children}</Table>
      </Figure>
    ),
    thead: ({ children }) => <TableHeader>{children}</TableHeader>,
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow>{children}</TableRow>,
    th: ({ children }) => <TableHead>{children}</TableHead>,
    td: ({ children }) => <TableCell>{children}</TableCell>,

    /**
     * Components a chapter may use by name, with no import line of its own.
     *
     * Deliberately a SHORT list. Every entry here is something a chapter cannot express in
     * markdown — `Example` renders a real file from the example registry. The moment this list
     * grows a decorative member (a callout, a tip box, a coloured aside) the chapters stop
     * being prose and start being a second component library. Set-apart prose is a
     * blockquote; the system ships one.
     */
    /* WRAPPED IN A FIGURE, like a fence. `Example` renders a live specimen, which is a block
       that is not prose by exactly the same test a code sample is — so it takes the same air
       on both sides and the same escape from the reading measure. Unwrapped it would land on
       the flow gap alone: 16px above and below against a fence's 32.

       The margin belongs here rather than on the specimen, because a component never owns its
       outer spacing and this file is the caller — which is what the note at the head of this
       file already says about every other distance in a chapter. */
    Example: (props: React.ComponentProps<typeof Example>) => (
      <Figure>
        <Example {...props} />
      </Figure>
    ),

    // Anything a chapter passes in at the call site wins over the defaults above.
    ...components,
  };
}

/** The wrapper a chapter's flow is rendered into. Exported so the chapter page and anything
    else that mounts a chapter agree on the rhythm rather than each choosing one.

    `kd-prose` is what carries the reading measure onto the text blocks and lets a figure keep
    the column — see `prose.css`. The class rather than a `style` because the rule it turns on
    is a child selector, which no inline value can express. */
export function ProseFlow({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap={FLOW_GAP} className="kd-prose">
      {children}
    </Stack>
  );
}
