import { Heading } from "@kookie-ui/react";

/**
 * The mark. `layout.tsx` is the one file that knows which face is loaded (`--kd-font-wordmark`,
 * which here points at the body face); this one knows the word, the weight and the trimmed box.
 *
 * It is a component because it is in two places — the sidebar's masthead and the footer — and
 * three facts travel together (the face, the weight, the collapsed line box). Two of them are
 * stated where a reader of the markup sees them rather than in the stylesheet, so a second
 * hand-written copy is not a second chance to say `bold` or forget the class. `prose.css`
 * carries why each one is what it is.
 *
 * IT SAYS THE NAME, NOT A LETTER. `size` names the step, so both call sites state theirs.
 *
 * `weight="medium"` IS LOAD-BEARING. Heading rests at semibold, and a request bolder than
 * anything the loaded face offers is the case a browser synthesizes — it strokes the outline.
 * Stating the weight keeps the request inside what the face was drawn at.
 *
 * ALWAYS `aria-hidden`, and the word does not change that. It is a picture of the name rather
 * than a second copy of it: in the sidebar the anchor around it carries `aria-label="Kookie
 * Flow"` and in the footer the link does the same, so announcing it here would say the name
 * twice in both placements. `render={<span/>}` for the same reason it is a span in the chrome —
 * this is a mark, not a heading, so it must not put an entry in the document outline.
 */
/**
 * TWO FORMS OF ONE NAME. A masthead is glanced at and a footer is arrived at, so the short form
 * is what sits above the navigation all day and the long form is what signs the page off —
 * which is the arrangement every foundry and every newspaper uses.
 *
 * A CLOSED PROP RATHER THAN `children`, because a mark is not a text component: taking children
 * would let any call site set any words in this face, and then the brand is whatever somebody
 * typed. Two forms, both stated here, and this is the only file that knows either string.
 *
 * THE `©` IS ON THE LONG FORM ONLY. It is part of the name as the name is SIGNED — which is the
 * long form's whole job, and why every foundry and newspaper carries its mark in the footer and
 * not in the masthead they look at all day.
 */
type Form = "short" | "full";

export function Wordmark({
  size = "8",
  form = "short",
}: {
  size?: "6" | "7" | "8" | "9";
  form?: Form;
}) {
  return (
    <Heading
      size={size}
      weight="medium"
      className="kd-wordmark"
      render={<span aria-hidden="true" />}
    >
      {form === "full" ? "Kookie© Flow" : "Kookie Flow"}
    </Heading>
  );
}
