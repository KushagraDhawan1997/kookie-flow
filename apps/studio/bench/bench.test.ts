/**
 * The bench. Runs the scenes in `tasks.ts` against real models through the gateway, with the app's own
 * instructions, tool schemas, provider options and caps, and answers every tool from a document
 * (`host.ts`) so nothing is rendered and no picture is paid for.
 *
 * IT SPENDS REAL TOKENS. Nothing runs without `BENCH_RUN=1`, and `BENCH_BUDGET` (US dollars, list
 * price) stops it. Every trial's cost is printed as it goes and the run stops the moment the budget is
 * reached, so the worst case is one trial's overshoot.
 *
 *   BENCH_RUN=1 BENCH_MODELS=anthropic/claude-sonnet-5 BENCH_TASKS=one-image BENCH_BUDGET=0.50 \
 *     ./node_modules/.bin/vitest run bench/bench.test.ts
 *
 * Env: BENCH_MODELS (comma-separated gateway slugs), BENCH_EFFORT (low|medium|high|max),
 * BENCH_TASKS (ids, or "all"), BENCH_TIERS ("1,2"), BENCH_REPEATS, BENCH_BUDGET, BENCH_LABEL.
 *
 * It is a test file so that vitest resolves the workspace's TypeScript; it asserts nothing about the
 * models. The numbers are the point, and they are written to `bench/results/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStepCount, streamText, type LanguageModelUsage, type ModelMessage } from 'ai';
import {
  agentInstructions,
  agentMaxOutputTokens,
  agentProviderOptions,
  describeGraph,
  findAgentModel,
  registry,
  tokenMicros,
  type AgentEffort,
  type AgentModel,
  type TokenUsage,
} from 'studio-core';
import { agentLanguageModel, agentMode } from '@/server/agent/model';
import { BenchHost, type BenchPicture } from './host';
import { benchTools } from './tools';
import { TASKS, type Task, type TaskState } from './tasks';

/** A step is one model call. The app caps a request at 6 and continues in the next one; a whole scene
 *  gets more room than that, or a long build would be cut off mid-plan and read as a failure. */
const MAX_STEPS = 24;

/**
 * THE PERSON USING THE APP COMES FIRST. The bench and the app share one gateway key, and four sweeps
 * at once took the owner's own turn down with "No access to this model at this time" (2026-09-18). So:
 * one model at a time, a pause between scenes, and a wait-and-retry when the gateway pushes back.
 */
const GAP_MS = Number(process.env.BENCH_GAP ?? '2000');
const RETRIES = 4;
const BACKOFF_MS = 20_000;
/**
 * A model call that has not finished in this long is abandoned. One Sol stream hung for two and a half
 * hours on "Failed to process successful response", which ran the whole run out of time and cost the
 * Opus sweep its turn (2026-09-18).
 */
const CALL_TIMEOUT_MS = Number(process.env.BENCH_CALL_TIMEOUT ?? '240000');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A gateway saying "slow down" or "no access at this time" is a wait, not a result. */
function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /rate.?limit|no access to this model|overloaded|429|503|capacity/i.test(message);
}

const here = path.dirname(new URL(import.meta.url).pathname);
const appDir = path.resolve(here, '..');
const BLOBS = path.join(appDir, '.data', 'blobs');

/** Pictures a run hands back, from the store. Real bytes, so a look costs real image tokens. */
const PICTURES: BenchPicture[] = [
  { hash: 'cd9da959113eddbd5e1efb660ee82180133bd85fc6033ee6c612e95f2ad55c21', mime: 'image/jpeg', width: 1024, height: 768 },
  { hash: '2f8571964c6ec0691e13d55a4617f8d346e96d97d541d54fba036892443ad810', mime: 'image/jpeg', width: 1024, height: 1024 },
  { hash: 'eb332f1d1a8c4f29873d9d5f4b672b2455d6f8226a5e9650639fc4ac7ff61c56', mime: 'image/jpeg', width: 572, height: 1024 },
  { hash: 'bdb5996cf78584fde2705735aaae0c087173ad346780a6a2cbe70594f268e3b4', mime: 'image/jpeg', width: 572, height: 1024 },
];

/** `.env.local` holds the gateway key. Vite does not put it on `process.env`, so read it here. */
function loadEnv(): void {
  const file = path.join(appDir, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) process.env[key] = raw.trim().replace(/^['"]|['"]$/g, '');
  }
}

function usageOf(usage: LanguageModelUsage | undefined): TokenUsage {
  if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const input = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { input, output: usage.outputTokens ?? 0, cacheRead, cacheWrite };
}

const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

interface Trial {
  task: string;
  tier: number;
  model: string;
  effort: string;
  repeat: number;
  passed: boolean;
  problems: string[];
  baselineFor?: string;
  /** Model calls, which is what each turn is billed as. */
  steps: number;
  toolCalls: number;
  tools: Record<string, number>;
  ops: number;
  refusals: string[];
  runsAsked: number;
  runsApproved: number;
  approvedMicros: number;
  usage: TokenUsage;
  micros: number;
  seconds: number;
  said: string[];
  graph: string;
  error?: string;
}

async function runTrial(task: Task, model: AgentModel, effort: AgentEffort, repeat: number): Promise<Trial> {
  const host = new BenchHost({
    blobsDir: BLOBS,
    pictures: PICTURES,
    startDoc: task.startDoc?.(),
    approve: task.approve,
  });
  const { tools, trace, created } = benchTools(host, { images: model.images });
  const messages: ModelMessage[] = [{ role: 'user', content: task.ask }];
  const said: string[] = [];
  let usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let steps = 0;
  let error: string | undefined;

  const started = Date.now();
  const replies = task.replies ?? [];
  for (let turn = 0; turn <= replies.length; turn++) {
    let attempt = 0;
    for (;;) {
      try {
        // `streamText`, as the route uses, so the mock model and the real ones take the same path.
        const result = streamText({
          model: agentLanguageModel(model),
          instructions: agentInstructions(registry),
          messages,
          tools,
          stopWhen: isStepCount(MAX_STEPS),
          maxOutputTokens: agentMaxOutputTokens(effort),
          providerOptions: agentMode() === 'gateway' ? agentProviderOptions(model, effort) : undefined,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        await result.consumeStream();
        steps += (await result.steps).length;
        usage = add(usage, usageOf(await result.totalUsage));
        const text = (await result.text).trim();
        if (text) said.push(text);
        messages.push(...(await result.response).messages);
        break;
      } catch (e) {
        if (isBusy(e) && attempt < RETRIES) {
          attempt++;
          const wait = BACKOFF_MS * attempt;
          console.log(`[bench] the gateway is busy; waiting ${wait / 1000}s (attempt ${attempt}/${RETRIES})`);
          await sleep(wait);
          continue;
        }
        error = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    if (error) break;
    const reply = replies[turn];
    if (reply) messages.push({ role: 'user', content: reply });
  }

  const taskState: TaskState = { state: host.state, trace, created, said };
  const problems = error ? [`the model call failed: ${error}`] : task.expect(taskState);
  const tools_ = trace.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.name]: (acc[c.name] ?? 0) + 1 }), {});

  return {
    task: task.id,
    tier: task.tier,
    model: model.id,
    effort,
    repeat,
    passed: problems.length === 0,
    problems,
    baselineFor: task.baselineFor,
    steps,
    toolCalls: trace.length,
    tools: tools_,
    ops: host.state.opsSent,
    refusals: host.state.refusals,
    runsAsked: host.state.runs.length,
    runsApproved: host.state.runs.filter((r) => r.approved).length,
    approvedMicros: host.state.runs.filter((r) => r.approved).reduce((sum, r) => sum + r.micros, 0),
    usage,
    micros: tokenMicros(model, usage),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    said,
    graph: describeGraph(host.state.doc, registry),
    error,
  };
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

describe('agent bench', () => {
  it(
    'runs the scenes and writes the numbers',
    async () => {
      loadEnv();
      if (!process.env.BENCH_RUN) {
        console.log('[bench] BENCH_RUN is not set, so nothing was run and nothing was spent.');
        return;
      }

      const slugs = (process.env.BENCH_MODELS ?? 'anthropic/claude-sonnet-5').split(',').map((s) => s.trim()).filter(Boolean);
      const effort = (process.env.BENCH_EFFORT ?? 'low') as AgentEffort;
      const repeats = Number(process.env.BENCH_REPEATS ?? '1');
      const budgetMicros = Math.round(Number(process.env.BENCH_BUDGET ?? '1') * 1_000_000);
      const tiers = new Set((process.env.BENCH_TIERS ?? '1,2,3').split(',').map((t) => Number(t.trim())));
      const wanted = (process.env.BENCH_TASKS ?? 'all').split(',').map((s) => s.trim());
      const chosen = TASKS.filter((t) => (wanted[0] === 'all' || wanted.includes(t.id)) && tiers.has(t.tier));

      const models = slugs.map((slug) => {
        const model = findAgentModel(slug);
        if (!model) throw new Error(`no such model: ${slug}`);
        return model;
      });

      console.log(
        `[bench] ${agentMode()} · ${models.length} model(s) · ${chosen.length} scene(s) × ${repeats} · effort ${effort} · budget ${usd(budgetMicros)}`
      );

      const trials: Trial[] = [];
      let spent = 0;
      let stopped = false;

      // Appended as they finish. Four sweeps were stopped mid-run once and every trial they had paid
      // for was lost, because the file was only written at the end.
      const dir = path.join(here, 'results');
      fs.mkdirSync(dir, { recursive: true });
      const label = (process.env.BENCH_LABEL ?? 'run').replace(/[^a-z0-9-]/gi, '-');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const live = path.join(dir, `${stamp}-${label}.jsonl`);

      for (const model of models) {
        for (let repeat = 1; repeat <= repeats && !stopped; repeat++) {
          for (const task of chosen) {
            if (spent >= budgetMicros) {
              console.log(`[bench] budget reached at ${usd(spent)}; stopping.`);
              stopped = true;
              break;
            }
            const trial = await runTrial(task, model, effort, repeat);
            spent += trial.micros;
            trials.push(trial);
            fs.appendFileSync(live, `${JSON.stringify(trial)}\n`);
            const mark = trial.passed ? 'pass' : trial.baselineFor ? 'BASE' : 'FAIL';
            console.log(
              `[bench] ${mark} ${task.id.padEnd(22)} ${model.id.padEnd(28)} ${String(trial.steps).padStart(2)} calls ` +
                `${String(trial.toolCalls).padStart(2)} tools ${usd(trial.micros).padStart(9)} ${String(trial.seconds).padStart(5)}s ` +
                `(total ${usd(spent)})${trial.problems.length ? ` — ${trial.problems[0]}` : ''}`
            );
            if (GAP_MS > 0) await sleep(GAP_MS);
          }
        }
      }

      const file = path.join(dir, `${stamp}-${label}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({ at: new Date().toISOString(), effort, repeats, spentMicros: spent, trials }, null, 2)
      );
      console.log(`[bench] ${trials.length} trial(s), ${usd(spent)} spent, written to ${path.relative(appDir, file)}`);

      // A summary per model: what passed, what a scene cost, and where the tokens went.
      for (const model of models) {
        const mine = trials.filter((t) => t.model === model.id);
        if (!mine.length) continue;
        const real = mine.filter((t) => !t.baselineFor);
        const sum = (pick: (t: Trial) => number) => mine.reduce((a, t) => a + pick(t), 0);
        console.log(
          `[bench] ${model.name}: ${real.filter((t) => t.passed).length}/${real.length} scenes passed · ` +
            `${usd(sum((t) => t.micros) / Math.max(1, mine.length))} a scene · ` +
            `${Math.round(sum((t) => t.steps) / mine.length)} calls · ${Math.round(sum((t) => t.toolCalls) / mine.length)} tools · ` +
            `tokens in ${sum((t) => t.usage.input)} / read ${sum((t) => t.usage.cacheRead)} / write ${sum((t) => t.usage.cacheWrite)} / out ${sum((t) => t.usage.output)}`
        );
      }

      expect(trials.length).toBeGreaterThan(0);
    },
    1000 * 60 * 200
  );
});
