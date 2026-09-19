/**
 * Reads the bench's result files and prints what they say: what each model passed, what a scene cost
 * it, where the tokens went, and which checks fail most across all of them.
 *
 *   node bench/report.mjs                 # every result file
 *   node bench/report.mjs sweep           # only files whose name contains "sweep"
 */

import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, 'results');
const filter = process.argv[2] ?? '';
const files = fs
  .readdirSync(dir)
  .filter((f) => (f.endsWith('.json') || f.endsWith('.jsonl')) && f.includes(filter))
  .map((f) => path.join(dir, f));

/** `.jsonl` is a run in progress, one trial a line; `.json` is a finished run's summary. */
function trialsIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return JSON.parse(text).trials ?? [];
}

// A finished run writes both files; prefer the summary and skip its twin.
const finished = new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
const trials = files.filter((f) => !(f.endsWith('.jsonl') && finished.has(f.replace(/\.jsonl$/, '')))).flatMap(trialsIn);
if (!trials.length) {
  console.log(`no trials in ${files.length} file(s)`);
  process.exit(0);
}

const usd = (micros) => `$${(micros / 1_000_000).toFixed(4)}`;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const by = (list, key) => {
  const out = new Map();
  for (const item of list) {
    const k = key(item);
    const seen = out.get(k);
    if (seen) seen.push(item);
    else out.set(k, [item]);
  }
  return out;
};
const sum = (list, pick) => list.reduce((a, t) => a + pick(t), 0);
const mean = (list, pick) => (list.length ? sum(list, pick) / list.length : 0);

console.log(`${trials.length} trials from ${files.length} file(s)\n`);

// Per model: scenes that passed every repeat (pass^k), cost, calls, tokens.
const models = by(trials, (t) => `${t.model} · ${t.effort}`);
console.log('MODEL'.padEnd(34) + 'pass^k  scenes  $/scene   calls  tools   ops   out-tok  read-tok  write-tok  fails');
for (const [name, mine] of models) {
  const real = mine.filter((t) => !t.baselineFor);
  const scenes = by(real, (t) => t.task);
  let allPass = 0;
  for (const [, repeats] of scenes) if (repeats.every((t) => t.passed)) allPass++;
  console.log(
    name.padEnd(34) +
      `${pct(allPass, scenes.size).padStart(6)}  ${String(scenes.size).padStart(6)}  ` +
      `${usd(mean(mine, (t) => t.micros)).padStart(8)}  ${mean(mine, (t) => t.steps).toFixed(1).padStart(5)}  ` +
      `${mean(mine, (t) => t.toolCalls).toFixed(1).padStart(5)}  ${mean(mine, (t) => t.ops).toFixed(1).padStart(4)}  ` +
      `${Math.round(mean(mine, (t) => t.usage.output)).toString().padStart(7)}  ` +
      `${Math.round(mean(mine, (t) => t.usage.cacheRead)).toString().padStart(8)}  ` +
      `${Math.round(mean(mine, (t) => t.usage.cacheWrite)).toString().padStart(9)}  ` +
      `${real.filter((t) => !t.passed).length}/${real.length}`
  );
}

/**
 * Dollars a million tokens, mirroring `AGENT_MODELS` in studio-core. Kept here so the report stays a
 * plain script; if a price moves there, move it here.
 */
const PRICE = {
  'anthropic/claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'anthropic/claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'openai/gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'openai/gpt-5.6-sol': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'openai/gpt-5.6-terra': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  'openai/gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
};

// Where the money goes, per model, in dollars — not in tokens. Cache reads are most of the tokens
// and a tenth of the price, so a token share says the opposite of what the bill says.
console.log('\nWHERE THE MONEY GOES (share of that model\'s own dollars)');
console.log('MODEL'.padEnd(34) + 'output  cache-write  cache-read  uncached      spent');
for (const [name, mine] of models) {
  const price = PRICE[mine[0].model];
  if (!price) continue;
  const dollars = {
    output: sum(mine, (t) => t.usage.output) * price.output,
    cacheWrite: sum(mine, (t) => t.usage.cacheWrite) * price.cacheWrite,
    cacheRead: sum(mine, (t) => t.usage.cacheRead) * price.cacheRead,
    input: sum(mine, (t) => t.usage.input) * price.input,
  };
  const total = dollars.output + dollars.cacheWrite + dollars.cacheRead + dollars.input;
  console.log(
    name.padEnd(34) +
      `${pct(dollars.output, total).padStart(6)}  ${pct(dollars.cacheWrite, total).padStart(11)}  ` +
      `${pct(dollars.cacheRead, total).padStart(10)}  ${pct(dollars.input, total).padStart(8)}  ` +
      `${usd(sum(mine, (t) => t.micros)).padStart(9)}`
  );
}

// Per scene, across models: how often it passed and what it cost.
console.log('\nSCENE'.padEnd(25) + 'tier  passed        $/trial  calls  tools  the usual problem');
for (const [task, mine] of by(trials, (t) => t.task)) {
  const first = mine[0];
  const problems = by(
    mine.filter((t) => !t.passed),
    (t) => t.problems[0] ?? ''
  );
  const worst = [...problems.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  console.log(
    task.padEnd(25) +
      `${String(first.tier).padStart(4)}  ${`${mine.filter((t) => t.passed).length}/${mine.length}`.padStart(6)}` +
      `${first.baselineFor ? ' (base)' : '       '}  ` +
      `${usd(mean(mine, (t) => t.micros)).padStart(7)}  ${mean(mine, (t) => t.steps).toFixed(1).padStart(5)}  ` +
      `${mean(mine, (t) => t.toolCalls).toFixed(1).padStart(5)}  ${(worst?.[0] ?? '').slice(0, 60)}`
  );
}

// Every distinct problem, most common first: the harness's to-do list.
console.log('\nPROBLEMS, most common first');
const problems = new Map();
for (const trial of trials) {
  for (const problem of trial.problems) {
    const key = problem.replace(/\d+/g, 'N').slice(0, 78);
    problems.set(key, (problems.get(key) ?? 0) + 1);
  }
}
for (const [problem, n] of [...problems.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${problem}`);
}

// Tool mix: which calls the loop actually spends its round trips on.
console.log('\nTOOL CALLS per trial, by model');
const names = [...new Set(trials.flatMap((t) => Object.keys(t.tools)))].sort();
console.log('MODEL'.padEnd(34) + names.map((n) => n.slice(0, 8).padStart(9)).join(''));
for (const [name, mine] of models) {
  console.log(
    name.padEnd(34) + names.map((n) => mean(mine, (t) => t.tools[n] ?? 0).toFixed(1).padStart(9)).join('')
  );
}

// Money the agent asked the person to spend, and whether it was pointed at the right thing.
console.log('\nSPENDING BEHAVIOUR');
console.log('MODEL'.padEnd(34) + 'runs asked  approved  $ approved/trial  refused ops');
for (const [name, mine] of models) {
  console.log(
    name.padEnd(34) +
      `${mean(mine, (t) => t.runsAsked).toFixed(1).padStart(10)}  ${mean(mine, (t) => t.runsApproved).toFixed(1).padStart(8)}  ` +
      `${usd(mean(mine, (t) => t.approvedMicros)).padStart(16)}  ${sum(mine, (t) => t.refusals.length)}`
  );
}
