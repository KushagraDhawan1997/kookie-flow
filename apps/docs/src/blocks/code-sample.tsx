/**
 * The code-sample BLOCK: a labelled, copyable, annotatable code figure, and the one the docs
 * themselves consume — every MDX fence and every example's source renders through this file,
 * so the block ships with a real consumer rather than a demo.
 *
 * WHAT A BLOCK IS HERE (THESIS §6): copied source, not published code — and copy-paste is
 * only safe when the copied file makes no design decisions of its own. shadcn's copy-paste is centerless *by construction* because the decisions travel
 * in the copy; here every colour, distance and step resolves through the package, so the
 * center stays in the dependency and the copy carries only arrangement and behaviour.
 * Behaviour is allowed (the copy button's state, the expand control); invented values are not.
 *
 * THE FIVE JOBS: show (the element), name (the header's label or title), take (the copy
 * button), point (the author's annotations — line and word highlight, focus, diff, error
 * marks), and bound (`maxLines`, scroll-not-clip, expand as convenience).
 * Everything else the ecosystem ships is another component wearing this one's name (code
 * groups are Tabs; preview is the Example frame) or decoration (window chrome, icons).
 *
 * THE CHROME'S SHAPE: the NAME sits outside, a sibling row aligned to the code with the
 * pane's own inset token (`--surface-p-N`); the ACTIONS float over the pane — copy top-right,
 * expand bottom-centre — as
 * GLASS (`backdrop`, the theme's material: the docs Theme runs `material="regular"`), at
 * Button's own medium default, because a floating control over content is exactly what the
 * material defends. No gradient — a scrollable well with a scrollbar already says "more".
 * SIZE PRICES EVERYTHING — pane, code step, label, copy and expand buttons all ride one
 * index — the ownership rule (§25, §30).
 *
 * WHAT THE COPY BUTTON HANDS OVER IS THE STRIPPED SOURCE — `plainText(lines)`, the code with
 * every `[!code …]` annotation removed, derived from the same tokens the paint renders, so
 * the clipboard and the pixels cannot disagree. Diff markers are real spans (a pseudo cannot
 * coexist with the line-number counter) but `aria-hidden` and `user-select: none`, so neither
 * assistive technology nor a drag-selection ever meets them.
 *
 * Async, and therefore server-only: tokenizing is build-time work, so a code fence costs the
 * reader nothing but the markup it produces. The client components are the copy button and,
 * only when the bound binds, the expand control.
 */
/* THE STYLESHEET IS IMPORTED BY THE FILE THAT EMITS ITS CLASSES. Import it anywhere else and
   deleting that file stops pulling `code.css` in — `.kd-line` stops being a block, every line
   of every fence runs together onto one line, and a type checker sees nothing wrong. The
   classes below are this file's, so the import is this file's. */
import "./code.css";

import * as React from "react";
import {
  Box,
  Code,
  CodeBlock,
  type Size,
  Stack,
  Surface,
  Toolbar,
  ToolbarGroup,
} from "@kookie-ui/react";

import { CopyButton } from "./copy-button";
import { Expandable } from "./expandable";
import {
  isLang,
  leadingColumns,
  plainText,
  tokenize,
  type CodeLine,
  type Lang,
} from "./highlight";

/** What the header row calls each language. The grammar's id is a tool's name for it
    (`tsx`, `bash`); this is the reader's. */
const LANG_LABEL: Record<Lang, string> = {
  tsx: "TSX",
  ts: "TypeScript",
  jsx: "JSX",
  js: "JavaScript",
  css: "CSS",
  json: "JSON",
  bash: "Terminal",
  html: "HTML",
  mdx: "MDX",
};

/**
 * How many lines a well shows before it bounds itself.
 *
 * It is a DEFAULT rather than a per-call-site prop because the fault it fixes is the one
 * nobody remembers to fix: a fence or an example runs long, the page becomes a mile of
 * scrolling code, and the author who wrote it never sees the page it landed on. A bound is
 * not a property of any one route, so the number lives here and no call site states it.
 *
 * NOT SILENT: bounded means SCROLLABLE, and the expand control names what it is holding back
 * ("Show all N lines"), so nothing is hidden without saying how much.
 *
 * An unbounded well is `maxLines={Infinity}` — deliberately awkward, because wanting one is
 * rare and the reason should be visible at the call site.
 */
export const CODE_MAX_LINES = 24;

/**
 * How much a bound has to be holding back before it is worth a control.
 *
 * Binding at ONE line over puts a button on the page, a scroll region under it and a press
 * between the reader and one line of code. The chrome cost is fixed and the saving is not, so
 * below some overflow the bound spends more than it buys — and what it spends is not pixels,
 * it is a press.
 *
 * A SHARE OF THE BOUND, not a second stated number, and the share is what makes it right at
 * both ends. An absolute slack would override an explicit small bound: a call site asking for
 * `maxLines={2}` has said something deliberate, and hiding three lines there DOUBLES what is
 * on screen — worth pressing for — while hiding three against 24 is noise. One third: six at
 * the default, so 25 to 32 lines show whole and 33 bounds to 24.
 *
 * `Infinity` stays unbounded by arithmetic rather than by a branch: no count exceeds it.
 */
export const CODE_BOUND_SLACK = (maxLines: number) => Math.ceil(maxLines / 3);

export type CodeSampleProps = {
  code: string;
  lang: string;
  /** One index for the whole figure: the pane, the code step, the label and both buttons. */
  size?: Size;
  /** A file path, when the sample IS a file. Replaces the language label, because where the
      code lives is more use than what it is written in once you can see it. */
  title?: string;
  /** Suppress the header row. For the rare fence that is one word long, where a label and a
      copy button are more chrome than content. */
  bare?: boolean;
  /** Fence meta for Shiki's own directives — `{1,3-5}` highlights lines, `/word/` highlights
      a word. The chrome facts (`title`, `lineNumbers`, `maxLines`, `bare`) are real props;
      the MDX fence adapter parses them out of the meta string with `parseMeta`. */
  meta?: string;
  /** Number the lines. CSS counters — never markup, so never in a selection or the copy. */
  lineNumbers?: boolean;
  /** Bound the well to this many lines. Bounded means scrollable (see the element); an
      expand button appears only when the code actually exceeds the bound. Defaults to
      `CODE_MAX_LINES`; `Infinity` opts out. */
  maxLines?: number;
  /** The sample is already inside a pane, so the well draws none of its own — see the element.
      A well inside a ground is the same ground twice. */
  hosted?: boolean;
};

/** One rendered line: a block-level span carrying the author's flags as classes, so the
    theme (`code.css`) owns every colour and this file owns none. */
function Line({ line, marker }: { line: CodeLine; marker: boolean }) {
  const classes = ["kd-line"];
  if (line.highlight) classes.push("kd-line-highlight");
  if (line.add) classes.push("kd-line-add");
  if (line.remove) classes.push("kd-line-remove");
  if (line.focus) classes.push("kd-line-focus");
  if (line.level) classes.push(`kd-line-${line.level}`);

  /* THE LINE'S OWN INDENT, handed to the stylesheet as a column count.

     This is the one thing about a wrap that CSS cannot work out for itself: a continuation
     belongs under the line it continues, and where that line STARTS is inside its own text.
     A stylesheet can only hang from the pane's wall, which puts every continuation at column
     zero — reading as a shallower nesting level than the line it belongs to, which is worse
     than not hanging at all.

     Written only where there is one, so an unindented line grows no attribute and the
     stylesheet's own default answers for it. */
  const indent = leadingColumns(line);

  return (
    <span
      className={classes.join(" ")}
      {...(indent
        ? { style: { "--kd-indent": `${indent}ch` } as React.CSSProperties }
        : {})}
    >
      {marker ? (
        // A real span rather than a pseudo — the ::before slot belongs to the line-number
        // counter. Hidden from AT and from selection; the copy path never sees it because
        // copy text is derived from tokens, and this is not one.
        <span className="kd-line-marker" aria-hidden>
          {line.add ? "+" : line.remove ? "−" : ""}
        </span>
      ) : null}
      {line.tokens.map((token, index) => (
        <span
          key={index}
          className={token.word ? "kd-word" : undefined}
          style={{
            color: token.color,
            ...(token.italic ? { fontStyle: "italic" } : null),
          }}
        >
          {token.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Tokenize, then render. The split exists because tokenizing is SERVER work and rendering is
 * not: the multi-file figure's tab bar is a client component, and it cannot call Shiki — so
 * the view below takes lines that are already tokenized and is an ordinary synchronous
 * component that a client component may render.
 *
 * One renderer, not two. The alternative is a second component painting `.kd-line` markup for
 * the live case, which is the shape this repo's own rule forbids: a mechanism with two
 * implementations owes a law that they agree, and the cheaper answer is to have one.
 */
export async function CodeSample({ code, lang, meta, ...view }: CodeSampleProps) {
  // An unlisted language would tokenize as plain text, which renders exactly like a fence
  // nobody got round to labelling — a silent downgrade. So an unlisted language throws, and
  // says which fence and which language.
  if (!isLang(lang)) {
    throw new Error(
      `Unknown code language "${lang}". Add it to LANGS in highlight.ts, or fix the fence.\n${code.slice(0, 80)}`,
    );
  }
  const { lines, focused, diff } = await tokenize(code, lang, meta);
  return <CodeSampleView lines={lines} focused={focused} diff={diff} lang={lang} {...view} />;
}

export type CodeSampleViewProps = Omit<CodeSampleProps, "code" | "meta"> & {
  /** Already tokenized. The one thing the view cannot do for itself. */
  lines: readonly CodeLine[];
  /** Some line said `[!code focus]`, so the rest stand down. */
  focused: boolean;
  /** Some line is an add or a remove, so every line gets a marker gutter. */
  diff: boolean;
};

export function CodeSampleView({
  lines,
  focused,
  diff,
  lang,
  size = "2",
  title,
  bare,
  lineNumbers,
  maxLines = CODE_MAX_LINES,
  hosted,
}: CodeSampleViewProps) {
  const copyText = plainText(lines);

  const paneClasses = [
    lineNumbers ? "kd-numbered" : null,
    focused ? "kd-focused" : null,
  ].filter(Boolean);
  const className = paneClasses.length ? paneClasses.join(" ") : undefined;

  const content = lines.map((line, index) => (
    <Line key={index} line={line} marker={diff} />
  ));

  // The bound binds only when the code exceeds it BY ENOUGH TO BE WORTH A PRESS — decided
  // here, from the line count the renderer already holds, never by measuring the DOM (v1's
  // defect class). Under the slack the well simply shows everything: the alternative, bounding
  // without the button, would hide lines while saying nothing, which is the one thing the
  // bound's own sentence forbids.
  const bounded = lines.length > maxLines + CODE_BOUND_SLACK(maxLines);

  // The copy button FLOATS top-right over the pane, as glass: a floating control over content
  // takes `backdrop`. It hangs from a positioned wrapper OUTSIDE the pane (inside, it breaks
  // the scroller's bleed — see the element), offset by the same inset token the pane pads with,
  // so it rests exactly one inset off the corner.
  /* The NAME FLOATS OVER THE PANE TOO, as the mirror of the copy button: same corner, same
     inset, opposite side, same material.

     A PATH IS COPIABLE AND A LANGUAGE IS NOT, so the two are not one component. `examples/
     dialog.tsx` is a thing you want in your clipboard — it is how you find the file — so it is
     the same `CopyButton` the code uses, with the path as both its label and its payload. A
     language name is a caption: there is nothing to copy and nothing to press, so it stays an
     inert `Chip`. They look different because they DO different things, which is this
     system's own rule rather than an inconsistency to tidy away.

     The chip keeps `backdrop` and the button takes it by construction, so both resolve the
     theme's material — and the atom family paints the same ring and rim the button does,
     which is what makes the two read as one kind of chrome. */
  /* A LANGUAGE IS LABELLED ONLY WHERE THE LABEL CHANGES WHAT YOU DO.

     Every fence on this site that is not a shell command is source you paste into a file, and
     `TSX` on a React library's docs is a label that is always true — it says nothing, on every
     fence. `Terminal` is the one that survives: it tells a reader the lines go
     in a shell rather than in their editor, which is the only thing here a reader could get
     wrong. CSS, JSON and HTML are unlabelled for the same reason as TSX — a stylesheet looks
     like a stylesheet, and knowing which file it belongs in is a question the prose around it
     answers, not a chip.

     Keyed on `bash` rather than on a list, so adding a language does not silently add a label:
     a new one has to argue its way in here. */
  const name = title ?? (lang === "bash" ? LANG_LABEL[lang] : null);

  /* ONE ROW, FLOATING OVER THE CODE.

     Moving it into FLOW is the wrong repair for the overlap it causes: a translucent control
     exists to be legible with content passing behind it, so a glass row with nothing behind it
     is decoration wearing a material's name. What is actually wrong is that the first line has
     nowhere to rest, and the answer to that is an inset, not flow — the platform pattern, where
     a scroll view holds a top contentInset and its content passes under a translucent toolbar.
     The band is a safe area, not an apology.

     IT SPANS THE PANE AND PADS ITSELF. The pane's inset is a READING measure — the distance
     a line of code needs from a wall — and chrome is not reading matter, so `inset-inline`
     reaches both walls and `p` puts a smaller number back.
     The buttons sit closer to the edge than the code does, which is what says they belong to
     the pane rather than to the text.

     A HOSTED SAMPLE IS THE OTHER CASE and does not disagree with it. Its own box IS the code
     column, so `inset-inline: 0` starts at the host's inset and any padding adds to it; the
     chrome REACHES the host's wall, which is the line below. Aligning both arrangements to the
     code is the wrong repair — one of them is already right.

     `z-index` is deliberately absent, and the row is rendered AFTER the scroller instead.
     Paint order alone does not settle it — `.kui-scroll-area` is positioned too, so the two
     settle on DOM order — and order is the whole fix: a z-index would be the number ladder
     §20 exists to avoid. */
  /* AND THE BAND IS ALWAYS RESERVED, name or no name.

     It was conditional: with a name at one wall and the copy button at the other the row covers
     the whole of line 1, so line 1 needed somewhere else to be — and with only the button, the
     argument ran, reserving a pane's width of clearance for a control in one corner puts a
     hand's width of nothing in the top-left.

     That argument is about the pixels the chrome COVERS, and a safe area is not about coverage.
     It is the band the pane says its chrome lives in, and a reader scanning a page of fences
     should not have to work out per fence whether the code begins under the buttons or beside
     them. The conditional bought a little of the top-left back and paid for it with two
     different code blocks on one page, which is the more expensive thing by a distance.

     So one rule: a fence that draws chrome reserves the band for it. `bare` still reserves
     nothing, because a bare fence draws no chrome at all — that is not the same fact wearing a
     condition, it is the absence of the row.

     `space-between` with ONE child pushes it to the START, so the empty wall has to be stated:
     the row means "name at one wall, action at the other", and with no name there is only the
     action, which takes the end.

A TOOLBAR, NOT A `Flex`. The row was stating the alignment, the split and the air itself —
     the three facts a Toolbar says once — and it earns the keyboard too whenever there is a
     name, because a path here is a `CopyButton` and not a label, so this row is usually TWO
     controls that were two separate tab stops.

     The justification conditional went with it, and that is the trade rather than a win: a
     toolbar is always `space-between`, so the empty wall is an empty child instead of a
     different value. It is honest in the same way the old spelling was — both say "there is
     nothing on that side" — and the toolbar cannot guess which side that is, because which
     controls sit where is what those controls mean. */
  const topbar = (
    <Toolbar size="3">
      <span />
      <CopyButton code={copyText} size="3" iconOnly />
    </Toolbar>
  );

  const named = name !== null;
  /* HOSTED AND BARE WHEN THE FIGURE DRAWS THE BOX. A well inside a ground is the same ground
     twice with a hairline between saying nothing, and the row over it would be a second copy
     button under the one the figure already floats. */
  const wellHosted = hosted || named;
  const wellBare = bare || named;

  const well = (
    <>
      {bounded ? (
        <Expandable
          size={size}
          maxLines={maxLines}
          lineCount={lines.length}
          topbar={wellBare ? undefined : topbar}
          {...(wellHosted ? { hosted: true } : {})}
          className={className}
        >
          {content}
        </Expandable>
      ) : (
        <CodeBlock
          size={size}
          {...(wellBare ? {} : { topbar })}
          {...(wellHosted ? { hosted: true } : {})}
          {...(className ? { className } : {})}
        >
          {content}
        </CodeBlock>
      )}
    </>
  );

  /* THE NAME IS A `Code`, IN FLOW, INSIDE THE PANE.

     A file's name is not a control and not a state: it is a literal, in the same face as the
     code under it, said once at the top of the thing it names. `Code` is the atom for exactly
     that — mono, sized off the line it sits in, no box of its own to disagree with the row's.

     WHAT IT IS NOT, and each was tried: a `Chip`, which is an atom priced for a sentence and
     lands at neither a chrome row's height nor its step; a `CopyButton`, which makes a name
     pressable; a TAB, which announces a list of places when there is one; and anything in the
     TOOLBAR, which is where controls live — the name is not one, and putting it there was what
     made it float over the first line it was naming.

     IT SITS IN THE PANE WITH THE CODE, which is what the figure already does one file over
     (`file-tabs.tsx`): the label names the code, so it belongs in the box the code is in. So a
     named sample takes the figure's arrangement — a Surface holding the label and a HOSTED
     well — rather than a caption stacked above a pane that draws itself. One pane either way.

     The copy button floats from the FIGURE, for the reason it does with several files: a hosted
     well has no pane of its own to float over, so the chrome hangs off the box that does. */
  if (name === null) return well;

  return (
    <Surface size={size} className="kd-figure">
      <Box className="kd-figure-chrome">
        <Toolbar size="3">
          <span />
          <ToolbarGroup backdrop>
            <CopyButton code={copyText} size="3" iconOnly />
          </ToolbarGroup>
        </Toolbar>
      </Box>
      {/* Close to what it names (§15): the label and its code are one group, so the interval
          is the tight one rather than the step that separates parts of a figure. */}
      <Stack gap="3">
        {/* THE ATOM HUGS ITS WORD. A `Stack` is a flex column, so it stretches what it holds —
            and an atom with a fill stretched to the pane's width is a band, not a label. */}
        <Box>
          <Code size={size}>{name}</Code>
        </Box>
        {well}
      </Stack>
    </Surface>
  );
}
