import { Box, Stack } from "@kookie-ui/react";

import { SiteFooter } from "./site-footer";

/**
 * The frame every documentation page sits in.
 *
 * Three facts, and they are the same three on every page, which is why they live here rather
 * than being restated on every page and drifting.
 *
 * THE AIR ABOVE THE TITLE IS NOT HERE, and neither is the title. `Page` owns both: the air is
 * its own, and so is the clearance under a floating band, without which every title on the
 * site would start underneath the chrome. What stays here is what is genuinely the FRAME's
 * rather than the page's.
 *
 * AIR BELOW THE LAST BLOCK, for the opposite reason: a document that ends flush with the
 * viewport's edge cannot be scrolled to a comfortable resting position, so the last section is
 * always read jammed against the bottom of the window.
 *
 * ONE COLUMN, CENTRED IN THE PANE. The width is the caller's — a chapter is a reading column
 * with a table of contents beside it, the front door is not, and one number here would be
 * wrong for one of the two. What is NOT the caller's is the centring: a flush-left
 * arrangement leaves dead pane on one side and no air between a vertical rule and the first
 * character of every line on the other. The measure does not change; the leftovers are split.
 */
export function PageFrame({
  width,
  children,
}: {
  /** The page's own maximum, as a CSS length. It bounds the whole frame, so a page with a
      gutter column states the total rather than the reading column's share of it. */
  width: string;
  children: React.ReactNode;
}) {
  return (
    <Box pb="9" style={{ maxInlineSize: width, marginInline: "auto" }}>
      {/* THE FOOTER IS THE FRAME'S, NOT THE CHROME'S. Hung in the content pane, it would put
          one full-window block under a 40rem reading column. Here it takes whatever measure the
          page states, so every page's floor is that page's own width and nothing in
          `site-footer.tsx` knows any of the numbers.

          `10` under it, against the `9` the pages use between their own sections: the footer is
          not another section, it is what the page ends at, and the outer interval should be the
          larger one. */}
      <Stack gap="10">
        {children}
        <SiteFooter />
      </Stack>
    </Box>
  );
}
