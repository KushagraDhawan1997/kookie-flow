#!/bin/zsh
# One model at a time, cheapest first, each with its own cap. Serial on purpose: the bench and the
# app share one gateway key, and parallel sweeps took the owner's own session down once.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
export BENCH_RUN=1 BENCH_GAP=3000 BENCH_REPEATS=3

run() {
  print "=== $1 (cap \$$2)"
  BENCH_MODELS="$1" BENCH_BUDGET="$2" BENCH_LABEL="sweep-$3" \
    ./node_modules/.bin/vitest run --config vitest.bench.config.ts 2>&1 | grep -E "bench\]|Error"
}

run openai/gpt-5.6-luna 1.00 luna
run anthropic/claude-haiku-4.5 3.00 haiku
run anthropic/claude-sonnet-5 5.00 sonnet
run openai/gpt-5.6-sol 5.00 sol
BENCH_REPEATS=1 BENCH_TIERS=1,2 run anthropic/claude-opus-5 3.00 opus
print "=== every sweep finished"
