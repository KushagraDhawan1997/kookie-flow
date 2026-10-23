/**
 * What's new: the release notes, read like a chapter.
 *
 * A STATIC SEGMENT, NOT A CHAPTER. It is linked from the footer only, so it has no row in
 * `chapters.ts`, whose entries drive the sidebar and the previous/next chain. The static segment
 * wins over `[...slug]`, which is Next's own specificity rule.
 *
 * The words are `WHATS_NEW.md` at the repo root, minus its `#` line: the title is the page's, as
 * on every chapter, so the heading on the page is not stated twice.
 *
 * THE TIER IS A CHIP. Each item opens with `Major`, `Minor` or `Quiet` as inline code, which
 * reads well in the plain file. On this page those three words are a label, not a literal, so
 * they render as a neutral `Chip`. Any other inline code keeps the chapter's `Code`.
 */
import type { Metadata } from "next";
import type { MDXComponents } from "mdx/types";
import { Box, Chip, Code, Page } from "@kushagradhawan/kookie-ui-react";

import WhatsNew from "../../../content/whats-new.mdx";
import { ProseFlow } from "../../../mdx-components";
import { PageFrame } from "../page-frame";

export const metadata: Metadata = {
  title: "What's new",
  alternates: { canonical: "/whats-new" },
};

const TIERS = new Set(["Major", "Minor", "Quiet"]);

const components: MDXComponents = {
  code: ({ children }) =>
    typeof children === "string" && TIERS.has(children) ? (
      <Chip size="1">{children}</Chip>
    ) : (
      <Code>{children}</Code>
    ),
};

export default function WhatsNewPage() {
  return (
    <Box className="kd-chapter">
      <PageFrame width="var(--kd-measure)">
        <Page title="What's new in Kookie Flow" style={{ minWidth: 0 }}>
          <ProseFlow>
            <WhatsNew components={components} />
          </ProseFlow>
        </Page>
      </PageFrame>
    </Box>
  );
}
