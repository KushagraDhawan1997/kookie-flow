/**
 * Triage: a quick read of the person's message by a decision model, before the language model sees it.
 *
 * The harness makes three calls on every message that a language model is slow and dear at and a
 * decision model is fast and nearly free at: is the ask clear enough to build, does the work belong on
 * the open canvas or in a new graph, and does a good answer make drafts to choose from or one exact
 * result. Jev (TypeSafe AI's System One model, served by the gateway) answers each with a probability
 * in well under a second for a fraction of a cent. It reads text only and generates nothing.
 *
 * A HINT, NOT A DECISION. The answers are appended to the person's message as one line the language
 * model reads beside the rules in its instructions, and the panel never draws. The model decides as it
 * did before; the line is a second opinion it can weigh. Whether that opinion moves the bench is the
 * measurement (plans/studio/harness-plan.md rules out routers; this is the cheapest test of that rule).
 *
 * BYTE-STABLE. The line is written from stored numbers by one function, so the same message reads the
 * same on every later step and the provider's cache holds. Pure: the browser, the route and the bench
 * read the same questions and write the same line.
 */

/** A question as the AI SDK's evaluate call takes it. Stated here so this package needs no `ai`. */
export type TriageQuestion =
  | { readonly type: 'boolean'; readonly instructions: string }
  | {
      readonly type: 'choice';
      readonly instructions: string;
      readonly criteria: Readonly<Record<string, string>>;
    };

export const TRIAGE_QUESTIONS = {
  clear: {
    type: 'boolean',
    instructions:
      'The message says what the result is for, who will see it, or what style or look it should have; or it is an exact instruction that leaves nothing to decide, such as a precise edit, a tidy-up, a yes or no, or picking one of the drafts. A few words naming only a subject, with no purpose and no style, is not clear.',
  },
  scope: {
    type: 'choice',
    instructions: 'Where the work belongs.',
    criteria: {
      extend:
        'It builds on what is on the canvas, answers something the agent asked, or the canvas is empty.',
      new: 'It asks for something with nothing to do with the work already on the canvas.',
    },
  },
  shape: {
    type: 'choice',
    instructions: 'What a good answer makes.',
    criteria: {
      drafts:
        'A new picture or clip the person will judge by eye, so several cheap drafts, a pick between them, and one final at full quality.',
      single:
        'One exact outcome: a precise edit of a picture, an upscale, a cutout, a tidy-up of the canvas, an answer to a question, a pick between drafts already made, or the person asked for a single result.',
    },
  },
} as const satisfies Record<string, TriageQuestion>;

export type TriageScope = keyof typeof TRIAGE_QUESTIONS.scope.criteria;
export type TriageShape = keyof typeof TRIAGE_QUESTIONS.shape.criteria;

/** What triage keeps of the model's answers, on the message's metadata. Small, since it is stored. */
export interface TriageAnswers {
  v: 1;
  /** P(the ask is clear enough to build). */
  clear: number;
  scope: TriageScope;
  /** P(scope). */
  scopeP: number;
  shape: TriageShape;
  /** P(shape). */
  shapeP: number;
}

/**
 * The canvas text is bounded: the model reads 64k tokens, and a triage should never wait on a big
 * graph. Exported because the browser slices to it before sending, so a graph larger than the
 * route's own body limit still gets a triage rather than a refused request.
 */
export const CANVAS_CHARS = 6_000;

/** The state the questions are asked of: the message and what is on the canvas. */
export function triageState(message: string, canvas: string): { message: string; canvas: string } {
  const trimmed = canvas.trim();
  return {
    message,
    canvas: trimmed
      ? trimmed.length > CANVAS_CHARS
        ? `${trimmed.slice(0, CANVAS_CHARS)}\n…`
        : trimmed
      : 'The canvas is empty.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function probability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** Two places: enough to read, and stable across the model's own rounding. */
function round(p: number): number {
  return Math.round(p * 100) / 100;
}

function choiceOf<K extends string>(
  answer: unknown,
  options: readonly K[]
): { choice: K; p: number } | null {
  if (!isRecord(answer) || typeof answer.choice !== 'string') return null;
  const choice = options.find((o) => o === answer.choice);
  if (!choice) return null;
  const distribution = isRecord(answer.probabilities) ? answer.probabilities : {};
  // A model that gives no distribution has still chosen; read that as certain rather than refuse it.
  const p = probability(distribution[choice]) ?? 1;
  return { choice, p };
}

const SCOPES = Object.keys(TRIAGE_QUESTIONS.scope.criteria) as TriageScope[];
const SHAPES = Object.keys(TRIAGE_QUESTIONS.shape.criteria) as TriageShape[];

/** The evaluate call's answers, reduced to what is kept. Null when any answer is not what was asked. */
export function readTriage(answers: unknown): TriageAnswers | null {
  if (!isRecord(answers)) return null;
  const clear = isRecord(answers.clear) ? probability(answers.clear.probability) : null;
  const scope = choiceOf(answers.scope, SCOPES);
  const shape = choiceOf(answers.shape, SHAPES);
  if (clear === null || !scope || !shape) return null;
  return {
    v: 1,
    clear: round(clear),
    scope: scope.choice,
    scopeP: round(scope.p),
    shape: shape.choice,
    shapeP: round(shape.p),
  };
}

/** Stored answers, as they come back off a message's metadata. */
export function isTriageAnswers(value: unknown): value is TriageAnswers {
  if (!isRecord(value) || value.v !== 1) return false;
  return (
    probability(value.clear) !== null &&
    SCOPES.some((s) => s === value.scope) &&
    probability(value.scopeP) !== null &&
    SHAPES.some((s) => s === value.shape) &&
    probability(value.shapeP) !== null
  );
}

export const TRIAGE_PREFIX = '[triage]';

const SCOPE_WORDS: Record<TriageScope, string> = {
  extend: 'extend the open graph',
  new: 'start a new graph',
};
const SHAPE_WORDS: Record<TriageShape, string> = {
  drafts: 'drafts then a pick',
  single: 'one exact result',
};

function other<K extends string>(choice: K, options: readonly K[]): K {
  return options.find((o) => o !== choice) ?? choice;
}

const two = (p: number) => p.toFixed(2);

/** The line the language model reads. One shape for every message, so a stored answer always reads the same. */
export function triageNote(a: TriageAnswers): string {
  const scope = `${SCOPE_WORDS[a.scope]} ${two(a.scopeP)} (${SCOPE_WORDS[other(a.scope, SCOPES)]} ${two(round(1 - a.scopeP))})`;
  const shape = `${SHAPE_WORDS[a.shape]} ${two(a.shapeP)} (${SHAPE_WORDS[other(a.shape, SHAPES)]} ${two(round(1 - a.shapeP))})`;
  return `${TRIAGE_PREFIX} A quick read of this message by a small model, not a decision: clear enough to build ${two(a.clear)}; ${scope}; ${shape}.`;
}

/**
 * A line this module wrote, not a message that happens to start the same way. Matched on the whole
 * shape: the mock agent drops these from what it reads, and a person who writes "[triage] why is
 * this here?" had their message read as empty and answered with the generic opening questions.
 */
const NOTE = new RegExp(
  `^${TRIAGE_PREFIX.replace(/[[\]]/g, '\\$&')} A quick read of this message by a small model, not a decision: clear enough to build \\d\\.\\d\\d; .+ \\d\\.\\d\\d \\(.+ \\d\\.\\d\\d\\); .+ \\d\\.\\d\\d \\(.+ \\d\\.\\d\\d\\)\\.$`
);

export function isTriageNote(text: string): boolean {
  return NOTE.test(text);
}
