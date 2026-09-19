import { NextResponse } from 'next/server';
import { convertToModelMessages, isStepCount, streamText, validateUIMessages, type LanguageModelUsage, type ModelMessage } from 'ai';
import { z } from 'zod';
import {
  AGENT_MAX_CALLS,
  AGENT_TOOLS,
  agentMaxOutputTokens,
  agentInstructions,
  agentProviderOptions,
  holdEstimateMicros,
  isAgentEffort,
  registry,
  resolveAgentModel,
  type TokenUsage,
} from 'studio-core';
import { saveConversation } from '@/server/agent/conversation';
import { agentLanguageModel, agentMode } from '@/server/agent/model';
import { agentTools } from '@/server/agent/tools';
import { closeTurn, InsufficientBalance, openTurn } from '@/server/billing';
import { getDb } from '@/server/db';
import { getGraph } from '@/server/graphs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';
/** A step can run a few calls with server tools between them; a long plan takes a while to write. */
export const maxDuration = 300;

/** The chat's own request, with the model and effort the person picked. The chat id is the graph id. */
const Body = z.object({
  id: z.string().min(1).max(64),
  messages: z.array(z.unknown()).min(1).max(500),
  model: z.string().max(80).default('auto'),
  effort: z.string().max(16).default('medium'),
});

/**
 * A picture in the prompt, as characters for the hold. A 1024px picture is about 1,600 tokens to
 * either provider; counted as its bytes it was millions, and one turn after three inspects asked for
 * a $73 hold on a $0.02 run (2026-09-17).
 */
const PICTURE_CHARS = 1_600 * 3;

/** The prompt's length in characters, with pictures and other files counted as a fixed allowance. */
function promptChars(instructions: string, messages: readonly ModelMessage[]): number {
  let files = 0;
  const text = JSON.stringify(messages, (key, value: unknown) => {
    if (key === 'data' && (value instanceof Uint8Array || value instanceof URL || (typeof value === 'string' && value.length > PICTURE_CHARS))) {
      files++;
      return null;
    }
    return value;
  });
  return instructions.length + text.length + JSON.stringify(AGENT_TOOLS).length + files * PICTURE_CHARS;
}

/** The SDK's usage, as the ledger prices it: uncached input, output, and each side of the cache. */
function tokenUsage(usage: LanguageModelUsage): TokenUsage {
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const input = usage.inputTokenDetails.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { input, output: usage.outputTokens ?? 0, cacheRead, cacheWrite };
}

function sumUsage(usages: LanguageModelUsage[]): TokenUsage {
  return usages.map(tokenUsage).reduce(
    (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  );
}

/**
 * One step of the agent: the conversation so far in, the model's turn out as a stream.
 *
 * Server tools run inside the step and the model carries on. A browser tool ends it; the editor runs
 * the tool against the live graph and calls this again with the answer. The step is held against the
 * balance before the model is asked and charged on the tokens it used when the stream ends; a mock
 * step (no gateway key) is neither held nor charged.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { id: graphId } = body.data;

  const graph = await getGraph(graphId, user.id);
  if (!graph) return NextResponse.json({ error: 'That graph does not exist.' }, { status: 404 });

  const effort = isAgentEffort(body.data.effort) ? body.data.effort : 'medium';
  const model = resolveAgentModel(body.data.model, effort);
  const tools = agentTools({ workspaceId: user.id, model });
  const mode = agentMode();

  let messages;
  try {
    messages = await validateUIMessages({ messages: body.data.messages, tools });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Those messages are not valid.' }, { status: 400 });
  }
  const instructions = agentInstructions(registry);
  const modelMessages = await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true });

  const db = await getDb();
  let turnId: string;
  try {
    const turn = await openTurn(db, {
      workspaceId: user.id,
      graphId,
      model: model.id,
      estimateMicros: mode === 'gateway' ? holdEstimateMicros(model, promptChars(instructions, modelMessages)) : 0,
    });
    turnId = turn.id;
  } catch (error) {
    if (error instanceof InsufficientBalance) return NextResponse.json({ error: error.message }, { status: 402 });
    throw error;
  }

  // Every ending passes through here once: the stream finishing, the person stopping it, a failure.
  let closed = false;
  const close = (usage: TokenUsage | null, error?: string) => {
    if (closed) return;
    closed = true;
    closeTurn(db, turnId, mode === 'gateway' ? usage : null, error).catch((e: unknown) =>
      console.error('[studio] agent turn did not settle', turnId, e)
    );
  };

  const result = streamText({
    model: agentLanguageModel(model),
    instructions,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(AGENT_MAX_CALLS),
    maxOutputTokens: agentMaxOutputTokens(effort),
    providerOptions: mode === 'gateway' ? agentProviderOptions(model, effort) : undefined,
    abortSignal: request.signal,
    onEnd: ({ totalUsage }) => close(tokenUsage(totalUsage)),
    onAbort: ({ steps }) => close(sumUsage(steps.map((s) => s.usage)), 'stopped'),
    onError: ({ error }) => {
      console.error('[studio] agent step failed', error);
      close(null, error instanceof Error ? error.message : String(error));
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onEnd: async ({ messages: all }) => {
      await saveConversation(graphId, user.id, all).catch((e: unknown) =>
        console.error('[studio] conversation not saved', graphId, e)
      );
    },
    onError: (error) => {
      if (error instanceof InsufficientBalance) return error.message;
      return error instanceof Error ? `The agent stopped: ${error.message}` : 'The agent stopped.';
    },
  });
}
