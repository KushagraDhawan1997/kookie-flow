"use client";

/**
 * A conversation with an agent: the transcript that holds it, and the parts of it that are not
 * words — the person's own message, the run of steps an agent takes between replies, and the
 * pictures a turn made. A question the agent stops to ask is not here: it waits at the composer,
 * as a `Confirmation` in its `notices`, and only the answer is recorded in the transcript.
 *
 * WHY A BLOCK. Every part here is an arrangement of package components with the words and the
 * pictures supplied by the app, and one piece of state (whether a run is open). That is the
 * definition of a source block. Following the live edge is the package's `MessageScroller`, and
 * `Conversation` is only where it is put together with the pane's own scroller.
 *
 * WHAT THE BEST CHATS AGREED ON, and so what this draws:
 *
 *  - **The person's words sit right, on a tint, with no edge**, and the reply has no bubble at
 *    all and takes the full measure (ChatGPT, Claude). Attachments sit above the bubble they
 *    came with, as thumbnails.
 *  - **A run of tool calls folds to one row.** Live, the row says what is happening now; done, it
 *    says how much happened, and opens to the list (ChatGPT's "Thought for", Perplexity's
 *    "Completed N steps", Cursor's grouped tool calls, Flora's "View steps"). A step that failed
 *    and was put right stays inside with the others; only a failure that stops the turn belongs
 *    in the conversation.
 *  - **Pictures are the result, so they stay out of the fold**: one at its own shape, several in a
 *    grid of squares (Midjourney's four, ChatGPT's sets). No captions; what they are called is the
 *    app's to show where the pictures live.
 *
 * REFUSED:
 *
 *  - **English.** The summary ("6 steps"), each step's words and every label are the caller's,
 *    because a copied file cannot localise and the counts are the app's grammar.
 *  - **A reply bubble.** `Reply` is text that keeps its line breaks and nothing more; a reply is
 *    read at the full measure with no box around it.
 *  - **Timing.** "Worked for 42 seconds" needs the app's clock, so it is a summary the app writes.
 *  - **A lightbox.** What opening a picture does (a dialog, the canvas, a download) is the app's.
 *
 * SIZE 3 IS THE DEFAULT, against the package's 2 (Kushagra, 2026-09-18): a conversation is the
 * thing being read, and it was one step under the composer and the toolbar around it. The index
 * rides the part's own text and the lengths derived from it — the thumbnail's height, the
 * timeline's half-row, the corners — through `data-kb-size` in the stylesheet.
 */
import * as React from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  ScrollArea,
  ShellScroll,
  Stack,
  Text,
  iconStroke,
  type Size,
} from "@kookie-ui/react";

import "./conversation.css";

export type ConversationProps = {
  /** The transcript's name, for the region a screen reader lands in: "Conversation". */
  "aria-label": string;
  /** The jump button's name, in your words: "Jump to the latest". */
  jumpLabel: string;
  /** The jump button's glyph. The package ships no icon set. */
  jumpIcon: React.ReactNode;
  /**
   * The pane the transcript fills is a Shell pane, so it scrolls with `ShellScroll` and spends the
   * reach the pane's floating bands publish. Otherwise it is a `ScrollArea`, for a card or a box
   * you have sized.
   */
  pane?: boolean;
  /** Shown in the middle of the transcript while it has no rows: usually an empty state. */
  empty?: React.ReactNode;
  /** One `Turn` per row, oldest first. */
  children?: React.ReactNode;
};

/**
 * The transcript: it opens at its end, follows what arrives while you are there, leaves you alone
 * once you scroll up, anchors each of your messages near the top so the reply is read from its
 * start, and offers a button back to the latest.
 */
export function Conversation({
  "aria-label": label,
  jumpLabel,
  jumpIcon,
  pane = false,
  empty,
  children,
}: ConversationProps) {
  const rows = React.Children.toArray(children);
  const Scroll = pane ? ShellScroll : ScrollArea;
  return (
    <MessageScroller>
      <Scroll fade aria-label={label} className="kb-conversation" data-kb-pane={pane || undefined}>
        <MessageScrollerContent className="kb-transcript" data-empty={rows.length === 0 || undefined}>
          {rows.length === 0 && empty ? <MessageScrollerItem>{empty}</MessageScrollerItem> : rows}
        </MessageScrollerContent>
        <MessageScrollerButton aria-label={jumpLabel}>{jumpIcon}</MessageScrollerButton>
      </Scroll>
    </MessageScroller>
  );
}

export type TurnProps = {
  /** A stable id, so the row can be jumped to. The message's own id. */
  id?: string;
  /**
   * Who is speaking. The person's turns anchor near the top when they arrive; the agent's follow
   * the live edge. Leave it out for a row that is neither (a thinking line, a decision).
   */
  from?: "person" | "agent";
  children: React.ReactNode;
};

/** One row of the transcript. */
export function Turn({ id, from, children }: TurnProps) {
  return (
    <MessageScrollerItem
      {...(id ? { messageId: id } : {})}
      scrollAnchor={from === "person"}
      className="kb-turn"
    >
      {children}
    </MessageScrollerItem>
  );
}

/** The agent's words: text in the reading ink, with the line breaks it wrote. */
export function Reply({ children, size = "3" }: { children: React.ReactNode; size?: Size }) {
  return (
    <Text size={size} className="kb-reply">
      {children}
    </Text>
  );
}

export type UserMessageProps = {
  /** The text's index, and the lengths that follow from it. A conversation reads at 3. */
  size?: Size;
  /** The person's words, as they typed them: line breaks are kept. */
  children: React.ReactNode;
  /** Thumbnails of what they attached, usually `img` elements. Sized here, owned by the app. */
  attachments?: React.ReactNode;
};

export function UserMessage({ children, attachments, size = "3" }: UserMessageProps) {
  return (
    <Stack className="kb-user-message" gap="2" align="end" data-kb-size={size}>
      {attachments ? <div className="kb-user-message-attachments">{attachments}</div> : null}
      <div className="kb-user-message-bubble">
        <Text size={size}>{children}</Text>
      </div>
    </Stack>
  );
}

export type StepsProps = {
  /** The text's index, and the lengths that follow from it. A conversation reads at 3. */
  size?: Size;

  /**
   * The row's words. Done, how much happened ("6 steps"); live, what is happening now ("Adding
   * nodes"). One prop for both, because the row is one line either way and only the app knows
   * which it is.
   */
  summary: React.ReactNode;
  /** The run is still going: the row turns its spinner on. */
  live?: boolean;
  /** One `Step` per tool call, oldest first. */
  children: React.ReactNode;
};

export function Steps({ summary, live = false, size = "3", children }: StepsProps) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  return (
    <Stack className="kb-steps" gap="2" data-kb-size={size}>
      <button
        type="button"
        className="kb-steps-toggle"
        {...(live ? { "data-live": "" } : {})}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        <Text size={size} emphasis="medium" className="kb-steps-line">
          {summary}
        </Text>
        {/* The disclosure chevron the accordion and the tree draw: into the reading direction
            closed, turned down open. */}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="kb-steps-chevron" data-open={open || undefined}>
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth={iconStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div id={listId} className="kb-steps-list">
          {children}
        </div>
      ) : null}
    </Stack>
  );
}

export type StepProps = {
  /** The text's index, and the lengths that follow from it. A conversation reads at 3. */
  size?: Size;
  /** What the step did, in a few words. Longer than the line and it is cut; pass `title` too. */
  children: React.ReactNode;
  /** The step has been asked for and has not answered. */
  pending?: boolean;
  /** The whole line, for when the words are cut. */
  title?: string;
};

export function Step({ children, pending = false, title, size = "3" }: StepProps) {
  return (
    <div className="kb-step" data-kb-size={size} {...(pending ? { "data-pending": "" } : {})}>
      <Text size={size} emphasis="medium" className="kb-steps-line" title={title}>
        {children}
      </Text>
    </div>
  );
}

export type ThinkingProps = {
  /** What it is doing, in the app's words: "Thinking", "Reading the graph". */
  children: React.ReactNode;
  /** The text's index. A conversation reads at 3. */
  size?: Size;
};

/**
 * The model is working and has nothing to show yet: a line that sweeps until it does (AI Elements'
 * Reasoning header). A sweep rather than a spinner, because the line IS the news — a spinner beside
 * words says the same thing twice and pins a control's shape into the reading column.
 */
export function Thinking({ children, size = "3" }: ThinkingProps) {
  return (
    <Text size={size} emphasis="medium" className="kb-thinking" aria-live="polite">
      {children}
    </Text>
  );
}

export type PicturesProps = {
  /** The text's index, and the lengths that follow from it. A conversation reads at 3. */
  size?: Size;
  /** The pictures, usually `img` elements. One keeps its own shape; more are cropped square. */
  children: React.ReactNode;
};

export function Pictures({ children, size = "3" }: PicturesProps) {
  const single = React.Children.count(children) === 1;
  return (
    <div className="kb-pictures" data-kb-size={size} data-single={single || undefined}>
      {children}
    </div>
  );
}
