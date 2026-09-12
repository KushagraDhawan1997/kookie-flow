"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  Flex,
  ToolbarButton,
  ToolbarGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToolbarOverflow,
} from "@kookie-ui/react";

import { CopyIcon, LinkIcon } from "../icons";
import { ClaudeMark, MarkdownMark, OpenAIMark } from "../marks";

/**
 * WHAT YOU CAN DO WITH THIS PAGE (2026-09-06, §47; Kushagra: "I see this in every docs site
 * now, especially via mintlify, can you do a bit of research about it, and add them to our
 * toolbar").
 *
 * It was `CopyPage` for the few hours it only copied. The name went when the row did: five
 * controls, of which two copy — a component whose name describes two fifths of it is §26's
 * `TabsTrigger` refusal in a file rather than in an API, and the ecosystem already calls this
 * cluster page actions.
 *
 * The research is in `markdown.ts`, because the twin is where the work is: every destination
 * here is a link carrying one sentence that names a markdown URL, and without that URL the
 * whole pattern is a menu pointing at pages of markup. This file is the doorbell.
 *
 * WHAT IT REFUSES. Two things, both from the same conversation. `Open in v0` is out because v0
 * writes React from a prompt: pointed at a design system's docs it will produce code using our
 * components against a package it has not installed, which is a plausible-looking wrong answer
 * with our name on it. And the copied markdown carries no attribution line — Mintlify injects
 * its own name into what people copy and was called out publicly for it as prompt injection,
 * which is the right name for text that is not the document arriving in an agent's context.
 *
 * NO DROPDOWN, AND THE MARKS ARE THE LABELS (2026-09-06, Kushagra: "Copy age as separate
 * button, and AI logos in a toolbar group, icon button, we dont need dropdown, everyone knows
 * these logos by now").
 *
 * It shipped as the shape every other docs site draws — one attached pill, `Copy Page` beside a
 * chevron, three rows behind it — and that shape is a menu holding three items that never
 * change, on a row with room for three buttons. A disclosure that hides a fixed, tiny, fully
 * legible set is a press spent on nothing. So the destinations stand out on the row, and the
 * argument for it is the same one that lets a control be icon-only anywhere: the mark carries
 * the meaning without the word.
 *
 * TWO CLUSTERS, AND THE SPLIT IS BY WHAT THE CONTROL DOES. Copying puts this page on your
 * clipboard; the marks send it somewhere else. Two `ToolbarGroup`s say that — each track means
 * *these are a set of the same kind* (§45: the segmented control's track with nothing chosen,
 * so the quiet rung arrives with the part) and the gap between them is where the kinds change.
 *
 * NOBODY NEEDS THE WORD (2026-09-06, Kushagra: "Who needs the enite label for copy page, lets
 * just use icon button for it too, in a separate group as it is, but also add a copy link icon
 * button"). `Copy Page` carried the only label on the row, and a label on one control out of
 * five reads as a rank rather than as a name. Every control is a mark now, and each one owes an
 * accessible name and a tooltip in exchange for the word it dropped.
 *
 * The consequence is real and is his call: the row no longer says in words that this feature
 * exists. What answers that is `llms.txt` and the `.md` URLs, which is where the readers this
 * is built for arrive anyway.
 *
 * TWO KINDS OF COPY, and the difference is who the thing is for. The page goes to your
 * clipboard as MARKDOWN, for an agent; the link goes as the ordinary URL, for a person. Same
 * gesture, different artefact, so they sit together and say which is which by their glyph.
 *
 * NO NEW COMPONENT, AND NO `backdrop` HERE EITHER: the band states it once for the whole row,
 * and a region mark reaches every control inside it (§10).
 *
 * THE TOOLTIPS ARE LEGAL NOW. They were refused while the chevron was a `MenuTrigger` — a
 * `TooltipTrigger` around one leaves the menu unanchored (open since 2026-09-06, in the
 * appearance toggle). These are plain links, so the composition that breaks does not exist, and
 * every other icon-only control on this site carries one.
 */

/**
 * The one sentence each destination is handed. It names the twin and says nothing else.
 *
 * EXPORTED FOR ITS LAW, and the reason is a platform fact rather than convenience: the menu is
 * a closed portal, so nothing it holds appears in server markup and a rendering law cannot see
 * a single destination. The claim — what each one is handed — is a pure function of a path, so
 * it is checked as one.
 */
export const askAbout = (markdownUrl: string) =>
  encodeURIComponent(
    `Read ${markdownUrl} so I can ask you questions about it. It is a page of the Kookie Flow documentation.`,
  );

/**
 * Where a page can be opened.
 *
 * A LIST, so adding one is a row. The two here are the two every peer ships; the shape of the
 * row is what makes a third — Perplexity, Grok, Scira — one line rather than an edit to the
 * markup below. Each takes the same encoded sentence, because a destination that needed a
 * different sentence would be saying something about the page, and only the page says that.
 */
export const DESTINATIONS: {
  label: string;
  Mark: React.ComponentType;
  /** The twin's own URL for the plain reader; the encoded sentence for the two that chat. */
  href: (markdownUrl: string) => string;
}[] = [
  // THE TWIN ITSELF IS FIRST, because it is the thing the two beside it point at — and because
  // a reader who wants the markdown for their own purpose should not have to send it somewhere
  // to get it.
  { label: "View as Markdown", Mark: MarkdownMark, href: (url) => url },
  {
    label: "Open in ChatGPT",
    Mark: OpenAIMark,
    // `hints=search` asks for the browsing tool up front. Without it the model may answer
    // about a URL it never opened, which is the failure this whole feature exists to remove.
    href: (url) => `https://chatgpt.com/?hints=search&q=${askAbout(url)}`,
  },
  {
    label: "Open in Claude",
    Mark: ClaudeMark,
    href: (url) => `https://claude.ai/new?q=${askAbout(url)}`,
  },
];

/** A page's twin. One expression, so the control and its laws cannot spell it differently. */
export const twinOf = (pagePath: string) => `${pagePath}.md`;

/**
 * What the two copy controls put on the clipboard.
 *
 * A list for the same reason `DESTINATIONS` is one: the row is the same three lines whichever
 * of them is being drawn, so the difference between them is data. `done` is the word each says
 * once it has happened — not "Copied" for both, because the confirmation should say WHAT was
 * copied when there are two things it could have been.
 */
export const COPIES: {
  id: "page" | "link";
  label: string;
  done: string;
  Glyph: React.ComponentType;
}[] = [
  { id: "page", label: "Copy page as Markdown", done: "Page copied", Glyph: CopyIcon },
  { id: "link", label: "Copy link to this page", done: "Link copied", Glyph: LinkIcon },
];

export function PageActions({ paths }: { paths: string[] }) {
  const pathname = usePathname();
  // ONE FLAG NAMING WHICH COPY JUST HAPPENED, rather than a boolean each. The two are mutually
  // exclusive by construction — a second press retires the first control's tick — which is what
  // a reader means by "just now", and two independent booleans would let both stand at once.
  const [copied, setCopied] = React.useState<"page" | "link" | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * THE ORIGIN, AFTER MOUNT — and the first spelling read it during render.
   *
   * It said `window.location.origin` inline with a comment claiming the menu panel mounts on
   * open, so `location` would exist by then. It does not: `MenuContent`'s children are
   * ordinary JSX, built while this component renders and handed to a portal that decides later
   * whether to show them. So the reference ran on the SERVER, for every page on the site.
   *
   * An effect, therefore, with `""` as the value both sides render first — which is what keeps
   * hydration honest. A destination link built before it settles carries a relative path; the
   * menu cannot be opened in that window, and a relative path is a worse link rather than a
   * broken page.
   */
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  /**
   * THE LIST COMES FROM THE SERVER, and that is the reason this takes a prop at all.
   *
   * Whether a page has a twin is `markdownFor(path) !== null` — a fact the twin's own module
   * already holds. Reading it here would mean importing that module into the browser, which
   * pulls `node:fs` and every chapter's compiled MDX with it; guessing it from the pathname's
   * shape would mean a second implementation of the same question, and this repo has spent
   * several audits on exactly that. The chrome is a server component, so it hands over the
   * answer as data.
   */
  const hasTwin = pathname !== null && paths.includes(pathname);
  if (!hasTwin) return null;

  const markdownPath = twinOf(pathname);

  const copy = async (what: "page" | "link") => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // The page is fetched as markdown; the link is the ordinary URL, which is already here.
      const text =
        what === "link"
          ? `${origin}${pathname}`
          : await (async () => {
              const response = await fetch(markdownPath);
              if (!response.ok) throw new Error(String(response.status));
              return response.text();
            })();
      await navigator.clipboard.writeText(text);
      setCopied(what);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      // A FAILURE SAYS NOTHING, deliberately. There is no toast in this system (§29: a message
      // important enough to say is too late to act on once the action is over), and the only
      // honest report here is that the button did not become "Copied" — which is exactly what
      // a reader sees. Clipboard access is denied by policy or the fetch failed; neither has a
      // repair the reader can perform.
      setCopied(null);
    }
  };

  /* IN THE OVERFLOW MENU THESE ARE ROWS, and three things about a ROW stop being true there.
     The `Flex` goes, because a menu stacks and two tracks side by side inside a panel is a
     layout nobody asked for — the two `ToolbarGroup`s draw themselves as menu groups and keep
     the split that Flex was drawing. The TOOLTIPS go, because a tooltip may only say what its
     control already says (§32) and a menu row says it in words; a floating layer opening over a
     panel is also the one composition the family has no answer for. What stays is every control
     and everything it does — the same elements, asked where they are. */
  const overflow = useToolbarOverflow();

  const destinations = (
    <ToolbarGroup>
      {DESTINATIONS.map(({ label, Mark, href }) => {
        const control = (
          <ToolbarButton
            iconOnly
            aria-label={label}
            render={
              <a
                // ABSOLUTE: the origin is the one thing a static build cannot know and the
                // browser always does. It arrives from the effect above, never from a constant
                // — this repo has no site URL anywhere, and one invented here would be wrong on
                // every deploy but the one it was written for.
                href={href(`${origin}${markdownPath}`)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <Mark />
          </ToolbarButton>
        );
        return overflow ? (
          React.cloneElement(control, { key: label })
        ) : (
          <Tooltip key={label}>
            <TooltipTrigger render={control} />
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToolbarGroup>
  );

  /* THE DONE STATE IS THE CONFIRMATION (§41), and this is the case it was built for: §29
     refused the toast on the argument that a copy confirmation belongs on the button that
     copied, and recorded the state it owed.

     THE NAME CHANGES WITH THE GLYPH, which `done` states as a requirement rather than a
     suggestion: a tick is a drawing and assistive technology announces a name. On a labelled
     button that means the label; on an icon-only one it means `aria-label`, which is the whole
     of what these controls say — and in the menu it is the row's words. */
  const copies = (
    <ToolbarGroup>
      {COPIES.map(({ id, label, done, Glyph }) => {
        const control = (
          <ToolbarButton
            iconOnly
            done={copied === id}
            aria-label={copied === id ? done : label}
            onClick={() => void copy(id)}
          >
            <Glyph />
          </ToolbarButton>
        );
        return overflow ? (
          React.cloneElement(control, { key: id })
        ) : (
          <Tooltip key={id}>
            <TooltipTrigger render={control} />
            <TooltipContent>{copied === id ? done : label}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToolbarGroup>
  );

  if (overflow) {
    return (
      <>
        {destinations}
        {copies}
      </>
    );
  }

  return (
    /* THE ROW STATES THE AIR AROUND ITS CLUSTERS and a `Flex` groups (§45), so this says only
       that these two things belong together — no alignment, no distance invented here.
       COPYING IS LAST (2026-09-06, Kushagra: "Swap positons, copy page at the end"). It ends
       at the two controls that act on the page you are reading; the ones that send it somewhere
       else are further from the edge, which is the order the row is read in.

       THE GAP IS ONE STEP WIDER THAN THE ROW'S (2026-09-06, Kushagra: "gap between tooltip
       groups seems a bit less"). It was `2`, which resolves to 4px — measured — and 4px between
       two tracks is narrower than the air inside either one, so the five controls read as one
       long capsule that happens to have a seam in it. The gap between two groups has to be
       wider than the gap between two members of a group, or the grouping says nothing. */
    <Flex align="center" gap="3">
      {destinations}
      {copies}
    </Flex>
  );
}
