/**
 * What the agent thinks with: a model through Vercel AI Gateway, or the scripted mock.
 *
 * The gateway is used when it can authenticate, with `AI_GATEWAY_API_KEY` or, on Vercel, the
 * deployment's OIDC token. Without either, or with `STUDIO_AGENT=mock`, the mock answers, so the
 * agent works in development and in tests with no key and no cost.
 */

import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { AgentModel } from 'studio-core';
import { nextMockTurn, type MockHistory } from './mock-script';

export function agentMode(): 'gateway' | 'mock' {
  if (process.env.STUDIO_AGENT === 'mock') return 'mock';
  if (process.env.STUDIO_AGENT === 'gateway') return 'gateway';
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ? 'gateway' : 'mock';
}

export function agentLanguageModel(model: AgentModel): LanguageModel {
  // A plain slug is resolved by the AI SDK's default provider, which is the gateway.
  return agentMode() === 'gateway' ? model.id : mockModel(model);
}

type Prompt = Parameters<MockLanguageModelV4['doStream']>[0]['prompt'];

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) =>
      part !== null && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part
        ? String(part.text)
        : ''
    )
    .join('');
}

/** The prompt, reduced to what the script reads. */
export function mockHistory(prompt: Prompt): MockHistory {
  let lastUser = -1;
  let userMessages = 0;
  prompt.forEach((message, i) => {
    if (message.role === 'user') {
      lastUser = i;
      userMessages++;
    }
  });
  const userText = lastUser >= 0 ? textOf(prompt[lastUser]?.content) : '';
  const results: MockHistory['results'] = [];
  for (const message of prompt.slice(lastUser + 1)) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      const output = part.output;
      const value = output.type === 'json' || output.type === 'text' ? output.value : output.type;
      results.push({ name: part.toolName, output: value });
    }
  }
  return { userText, userMessages, results };
}

function mockModel(model: AgentModel): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'studio-mock',
    modelId: model.id,
    doStream: async (options) => {
      const turn = nextMockTurn(mockHistory(options.prompt));
      const promptChars = JSON.stringify(options.prompt).length;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (turn.text) {
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: turn.text });
            controller.enqueue({ type: 'text-end', id: 't' });
          }
          (turn.calls ?? []).forEach((call, i) => {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: `mock-${Date.now().toString(36)}-${i}`,
              toolName: call.name,
              input: JSON.stringify(call.input),
            });
          });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: turn.calls?.length ? 'tool-calls' : 'stop', raw: undefined },
            usage: {
              inputTokens: { total: Math.ceil(promptChars / 4), noCache: Math.ceil(promptChars / 4), cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 120, text: 120, reasoning: 0 },
            },
          });
          controller.close();
        },
      });
      return { stream };
    },
  });
}
