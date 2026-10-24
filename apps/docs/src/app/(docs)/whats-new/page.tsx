/**
 * What's new: the release notes, read like a chapter.
 *
 * A STATIC SEGMENT, NOT A CHAPTER. It is linked from the footer only, so it has no row in
 * `chapters.ts`, whose entries drive the sidebar and the previous/next chain. The static segment
 * wins over `[...slug]`, which is Next's own specificity rule.
 *
 * The words are `WHATS_NEW.md` at the repo root, minus its `#` line: the title is the page's, as
 * on every chapter, so the heading on the page is not stated twice.
 */
import type { Metadata } from "next";
import { Box, Page } from "@kushagradhawan/kookie-ui-react";

import WhatsNew from "../../../content/whats-new.mdx";
import { ProseFlow } from "../../../mdx-components";
import { PageFrame } from "../page-frame";

export const metadata: Metadata = {
  title: "What's new",
  alternates: { canonical: "/whats-new" },
};

export default function WhatsNewPage() {
  return (
    <Box className="kd-chapter">
      <PageFrame width="var(--kd-measure)">
        <Page title="What's new in Kookie Flow" style={{ minWidth: 0 }}>
          <ProseFlow>
            <WhatsNew />
          </ProseFlow>
        </Page>
      </PageFrame>
    </Box>
  );
}
