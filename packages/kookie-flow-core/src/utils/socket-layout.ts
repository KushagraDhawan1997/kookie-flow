export interface ResolvedSocketLayout {
  /** Row height in pixels (from --space-7, default 40px) */
  rowHeight: number;
  /** Widget height in pixels (from --space-6, default 32px) */
  widgetHeight: number;
  /** Margin from top of node to first socket row */
  marginTop: number;
  /** Height of the title's band inside the body; 0 when no title is drawn there */
  titleBand: number;
  /** Socket circle radius in pixels */
  socketSize: number;
  /** Padding inside node (from size config) */
  padding: number;
  /**
   * The checkbox's square, from `--mark-N`.
   *
   * v2 makes this byte-identical to `--line-height-N`, which is what lands a mark on its own
   * label's line with no alignment rule at all. It was an 18 in the shader.
   */
  markSize: number;
  /** The slider's rail, from `--slider-track-N`. Also a shader literal before. */
  trackHeight: number;
  /**
   * A list row: v2's `line height + 2 × row inset`, 30px at size 2, never under the 24px target.
   * A select's list is laid out in these, not in control heights.
   */
  listRowHeight: number;
  /**
   * The body's border, which every content inset owes. `.kui-surface` is border-box and declares
   * its border in the same rule as its padding, so the distance from the outer edge to the first
   * glyph is `padding + borderWidth`, not `padding`.
   */
  borderWidth: number;
}
