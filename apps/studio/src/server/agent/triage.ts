/**
 * Triage on the server: the decision model through the gateway, or a scripted stand-in, asked the
 * questions `studio-core` states (`agent/triage.ts`), and the line its answers become on the way to
 * the language model.
 *
 * The gateway serves Jev under the same key the agent thinks with, so nothing new is configured; with
 * no key, or `STUDIO_AGENT=mock`, the stand-in answers from the words alone, so the whole path runs
 * in development and in tests for nothing. `STUDIO_TRIAGE=off` skips triage while keeping everything
 * else, for comparing the agent with and without it.
 */

import {
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel,
  type UIMessage,
} from 'ai';
import { Experimental_EvaluationMockModelV4 as EvaluationMockModelV4 } from 'ai/test';
import {
  isTriageAnswers,
  readTriage,
  TRIAGE_MODEL,
  TRIAGE_QUESTIONS,
  triageNote,
  triageState,
  type TriageAnswers,
} from 'studio-core';
import { agentMode } from './model';

export function triageEnabled(): boolean {
  return process.env.STUDIO_TRIAGE?.trim().toLowerCase() !== 'off';
}

export interface Triaged {
  answers: TriageAnswers;
  /** What the model read, for the turn's record and its price. */
  inputTokens: number;
}

/** Four characters a token, near enough for a price that is a fraction of a cent. */
export function triageTokens(message: string, canvas: string): number {
  const state = triageState(message, canvas);
  return Math.ceil(
    (state.message.length + state.canvas.length + JSON.stringify(TRIAGE_QUESTIONS).length) / 4
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type EvaluateOptions = Parameters<Exclude<Experimental_EvaluationModel, string>['doEvaluate']>[0];

/** Words that name one exact job rather than something to be judged by eye. */
const EXACT =
  /\b(edit|upscale|enlarge|cut ?out|remove|background|tidy|arrange|crop|resize|the (first|second|third|fourth) one|option [1-4])\b/i;

/**
 * The stand-in reads what the mock agent reads: a short ask is unclear, a named edit is one exact
 * result, and the work stays on the open canvas.
 */
function mockTriageModel(): EvaluationMockModelV4 {
  return new EvaluationMockModelV4({
    provider: 'studio-mock',
    modelId: TRIAGE_MODEL.id,
    supportedQuestionTypes: ['boolean', 'choice'],
    doEvaluate: async ({ state }: EvaluateOptions) => {
      const message = isRecord(state) && typeof state.message === 'string' ? state.message : '';
      const words = message.trim().split(/\s+/).filter(Boolean).length;
      const clear = words > 3 ? 0.9 : 0.15;
      const single = EXACT.test(message) ? 0.85 : 0.2;
      return {
        answers: {
          clear: { type: 'boolean', probability: clear },
          scope: { type: 'choice', choice: 'extend', probabilities: { extend: 0.9, new: 0.1 } },
          shape: {
            type: 'choice',
            choice: single > 0.5 ? 'single' : 'drafts',
            probabilities: { drafts: 1 - single, single },
          },
        },
        usage: { inputTokens: Math.ceil(JSON.stringify(state).length / 4), outputTokens: 0 },
        warnings: [],
      };
    },
  });
}

/**
 * Ask the three questions of one message. Throws when the model does not answer or answers something
 * else; the caller decides whether that is a failed request or a message sent without a hint.
 */
export async function triage(
  message: string,
  canvas: string,
  signal?: AbortSignal
): Promise<Triaged> {
  const result = await evaluate({
    // A plain slug is resolved by the AI SDK's default provider, which is the gateway.
    model: agentMode() === 'gateway' ? TRIAGE_MODEL.id : mockTriageModel(),
    state: triageState(message, canvas),
    questions: TRIAGE_QUESTIONS,
    maxRetries: 1,
    abortSignal: signal,
  });
  const answers = readTriage(result.answers);
  if (!answers) throw new Error('the triage model answered something other than what was asked');
  return { answers, inputTokens: result.usage.inputTokens ?? 0 };
}

/**
 * The messages as the language model reads them: a person's message that carries triage answers on
 * its metadata gets the line they make, after its own words. The stored conversation and the panel
 * keep the messages as they were; only the copy sent to the model changes, and it changes the same way
 * on every step, so the provider's cache holds.
 */
export function withTriageNotes(messages: readonly UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (
      message.role !== 'user' ||
      !isRecord(message.metadata) ||
      !isTriageAnswers(message.metadata.triage)
    )
      return message;
    return {
      ...message,
      parts: [...message.parts, { type: 'text', text: triageNote(message.metadata.triage) }],
    };
  });
}
