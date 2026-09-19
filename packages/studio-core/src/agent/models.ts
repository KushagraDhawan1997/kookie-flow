/**
 * The language models the agent can think with, what they cost, and how Studio's one effort scale
 * reaches each provider.
 *
 * Every model is called through Vercel AI Gateway by its gateway slug (plans/studio/plan.md, Agent).
 * The prices are the gateway's list prices, which carry no markup, read from
 * `https://ai-gateway.vercel.sh/v1/models` on 2026-09-17, in micros per million tokens. OpenAI
 * doubles its price past 272,000 input tokens; a turn here never comes near that, so only the base
 * tier is kept.
 *
 * Pure: the menu in the browser and the route on the server read the same list.
 */

export type AgentEffort = 'low' | 'medium' | 'high' | 'max';

export const AGENT_EFFORTS: ReadonlyArray<{ id: AgentEffort; name: string }> = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
];

export type AgentProvider = 'anthropic' | 'openai' | 'typesafe';

/** Micros per million tokens. */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentModel {
  /** The gateway slug, which is also the id the menu stores. */
  id: string;
  name: string;
  maker: string;
  provider: AgentProvider;
  price: TokenPrice;
  /** Reads pictures in a tool result, so `inspect` can hand it the image itself. */
  images: boolean;
  /**
   * How the model thinks. `adaptive`: it decides, steered by effort (Claude 5). `budget`: an older
   * Claude that takes neither adaptive thinking nor effort, only a thinking token budget (Haiku 4.5).
   * OpenAI models ignore this and take a reasoning effort.
   */
  thinking?: 'adaptive' | 'budget';
}

const million = (dollars: number) => Math.round(dollars * 1_000_000);

const price = (input: number, output: number, cacheRead: number, cacheWrite: number): TokenPrice => ({
  input: million(input),
  output: million(output),
  cacheRead: million(cacheRead),
  cacheWrite: million(cacheWrite),
});

export const AGENT_MODELS: readonly AgentModel[] = [
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', maker: 'Anthropic', provider: 'anthropic', price: price(5, 25, 0.5, 6.25), images: true },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', maker: 'Anthropic', provider: 'anthropic', price: price(2, 10, 0.2, 2.5), images: true },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', maker: 'Anthropic', provider: 'anthropic', price: price(1, 5, 0.1, 1.25), images: true, thinking: 'budget' },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', maker: 'OpenAI', provider: 'openai', price: price(10, 50, 1, 12.5), images: true },
  { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', maker: 'OpenAI', provider: 'openai', price: price(2, 10, 0.2, 2.5), images: true },
  { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', maker: 'OpenAI', provider: 'openai', price: price(2, 12, 0.2, 2.5), images: true },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', maker: 'OpenAI', provider: 'openai', price: price(0.2, 1.2, 0.02, 0.25), images: true },
];

/**
 * The decision model triage asks before the language model runs (`triage.ts`). Not on the menu: it
 * writes nothing, so nobody thinks with it; it is here so a triage call is priced and recorded like a
 * turn. TypeSafe's published price, checked 2026-09-19 ($0.042 a million input tokens, output free);
 * the gateway's own list price could not be read from here and should be confirmed against
 * `https://ai-gateway.vercel.sh/v1/models`.
 */
export const TRIAGE_MODEL: AgentModel = {
  id: 'typesafe-ai/jev',
  name: 'Jev',
  maker: 'TypeSafe AI',
  provider: 'typesafe',
  price: price(0.042, 0, 0, 0),
  images: false,
};

export const AUTO_AGENT_MODEL = 'auto';

const BY_ID = new Map(AGENT_MODELS.map((m) => [m.id, m]));

export function findAgentModel(id: string): AgentModel | undefined {
  return BY_ID.get(id);
}

/** A model a turn can be billed as: one from the menu, or the triage model. */
export function findBilledModel(id: string): AgentModel | undefined {
  return BY_ID.get(id) ?? (id === TRIAGE_MODEL.id ? TRIAGE_MODEL : undefined);
}

/**
 * The model a choice resolves to. Auto thinks with Sonnet for everyday asks and Opus when the person
 * asked for more effort; an id that is not on the list is treated as Auto rather than refused, so a
 * menu from an older build still works.
 */
export function resolveAgentModel(id: string, effort: AgentEffort): AgentModel {
  const stated = BY_ID.get(id);
  if (stated) return stated;
  const auto = effort === 'high' || effort === 'max' ? 'anthropic/claude-opus-5' : 'anthropic/claude-sonnet-5';
  return BY_ID.get(auto) ?? (AGENT_MODELS[0] as AgentModel);
}

export function isAgentEffort(value: unknown): value is AgentEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max';
}

/** JSON, as provider options must be: they travel to the gateway as they are. Shaped as the AI SDK's own. */
export type JsonValue = null | string | number | boolean | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

/** Thinking tokens for a model that takes a budget, per effort. Always under the output cap below. */
const THINKING_BUDGET: Record<AgentEffort, number> = { low: 2_000, medium: 6_000, high: 16_000, max: 32_000 };

/**
 * The provider options for a call: one effort scale, said the way each provider hears it, and the
 * gateway's own caching so the long system prompt and tool list are paid for once per conversation.
 *
 * Claude 5 takes adaptive thinking with `effort` (low to max). Haiku 4.5 takes neither and gets a
 * thinking budget instead. OpenAI's GPT-5.6 and GPT-6 take `reasoningEffort` from low to max.
 * Checked against the AI SDK provider docs and Anthropic's effort docs on 2026-09-17.
 */
export function agentProviderOptions(model: AgentModel, effort: AgentEffort): Record<string, JsonObject> {
  const gateway = { caching: 'auto' };
  if (model.provider === 'anthropic') {
    if (model.thinking === 'budget') {
      return { gateway, anthropic: { thinking: { type: 'enabled', budgetTokens: THINKING_BUDGET[effort] } } };
    }
    return { gateway, anthropic: { thinking: { type: 'adaptive' }, effort } };
  }
  return { gateway, openai: { reasoningEffort: effort } };
}

export interface TokenUsage {
  /** Input tokens not read from or written to the cache. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What these tokens cost at the model's list price, in micros, before the fee. */
export function tokenMicros(model: AgentModel, usage: TokenUsage): number {
  const p = model.price;
  const total =
    usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite;
  return Math.round(total / 1_000_000);
}

/**
 * The most one call may write, thinking included. Thinking counts against it, and Anthropic advises
 * a large cap at high effort and above (64k for Opus 5 at max), or a call stops mid-tool-call.
 */
export function agentMaxOutputTokens(effort: AgentEffort): number {
  return effort === 'low' ? 16_000 : effort === 'medium' ? 32_000 : 64_000;
}

/**
 * What a call is expected to write when holding for it: a plan and a batch of ops with some thinking.
 * Not the cap: holding for the cap would lock dollars per message at Max. The charge is what was
 * used, whether above or below this.
 */
export const AGENT_HOLD_OUTPUT_TOKENS = 8_000;

/** Model calls one step request may make while server tools answer inside it. */
export const AGENT_MAX_CALLS = 6;

/**
 * What a step request is held for before it starts, in micros before the fee: two calls reading
 * the whole prompt uncached and writing a typical amount. The real charge is what the gateway reports,
 * which is almost always far less, and the hold is released either way.
 */
export function holdEstimateMicros(model: AgentModel, promptChars: number): number {
  // Three characters a token, fewer than the usual four, so the hold is never short.
  const promptTokens = Math.ceil(promptChars / 3);
  const perCall = tokenMicros(model, { input: promptTokens, output: AGENT_HOLD_OUTPUT_TOKENS, cacheRead: 0, cacheWrite: 0 });
  // Later calls in a step mostly read the cache, so two full calls cover a step in practice.
  return perCall * Math.min(2, AGENT_MAX_CALLS);
}
