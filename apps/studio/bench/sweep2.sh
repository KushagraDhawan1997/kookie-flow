#!/bin/zsh
# The ceiling (Opus 5) and whether effort buys what the harness is missing.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
export BENCH_RUN=1 BENCH_GAP=3000

print "=== opus 5, tiers 1-2, one repeat (cap \$2)"
BENCH_REPEATS=1 BENCH_TIERS=1,2 BENCH_MODELS=anthropic/claude-opus-5 BENCH_BUDGET=2.00 BENCH_LABEL=sweep-opus \
  ./node_modules/.bin/vitest run --config vitest.bench.config.ts 2>&1 | grep -E "bench\]|Error"

print "=== sonnet 5 at medium effort (cap \$2.50)"
BENCH_REPEATS=2 BENCH_EFFORT=medium BENCH_MODELS=anthropic/claude-sonnet-5 BENCH_BUDGET=2.50 BENCH_LABEL=sweep-sonnet-medium \
  ./node_modules/.bin/vitest run --config vitest.bench.config.ts 2>&1 | grep -E "bench\]|Error"

print "=== luna at medium effort (cap \$0.50)"
BENCH_REPEATS=2 BENCH_EFFORT=medium BENCH_MODELS=openai/gpt-5.6-luna BENCH_BUDGET=0.50 BENCH_LABEL=sweep-luna-medium \
  ./node_modules/.bin/vitest run --config vitest.bench.config.ts 2>&1 | grep -E "bench\]|Error"

print "=== sweep 2 finished"
