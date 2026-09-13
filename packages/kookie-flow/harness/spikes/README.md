# Spikes

One-question measurements, each answering something a behaviour test cannot.

| Spike | Question |
|---|---|
| `color-parity.mjs` | Does a colour drawn in GL match the same token drawn in CSS, pixel for pixel? |
| `color-formats.mjs` | Which CSS colour syntaxes does the token reader actually resolve? |
| `label-zoom.mjs` | Does a label stay legible and correctly placed across the zoom range? |
| `theme-flip.mjs` | Does a light→dark→light round trip return the scene to where it started? |
| `perf-baseline.mjs` | Frame intervals at 1k / 10k / 50k. **Needs a quiet machine.** |
| `counts.mjs` | How much WORK does an interaction cost — React commits, draw calls, instances rewritten, bytes allocated? |
| `token-census.mjs` | Which theme tokens does the GL layer actually get, and which silently fall back? |

## Why counts.mjs and not a stopwatch

Everything here runs on SwiftShader. A millisecond on a software rasteriser says nothing about a
real GPU, so `perf-baseline.mjs` is the only spike that reports time and it is the one that needs a
machine doing nothing else.

What DOES transfer is work. How many draw calls a pan issues, how many instances get rewritten per
pointermove, how many times React commits during a drag, and how many bytes the handlers allocate
are the same numbers on any machine — and they are what CLAUDE.md's rules are actually written
about ("zero React re-renders during interactions", "no allocations in hot paths", "O(log n), never
O(n)"). Phase 3 of the remediation plan is nine perf commits and every one of them names a count as
its proof.

## The instrument was dead the first time, and it looked like a pass

The React counter began in `app.tsx`'s module body. React reads
`window.__REACT_DEVTOOLS_GLOBAL_HOOK__` once when its own module is evaluated, and ES imports are
hoisted — so the hook was installed after React had already looked. It reported **zero commits for
every interaction**, including a node drag that calls `setState` through the fixture's controlled
component contract, i.e. a case where the true answer is not zero.

Zero is also the answer the codebase wants to hear, which is what makes that failure dangerous.
The counter now lives in a plain `<script>` in `index.html`, and `counts.mjs` refuses to report
anything at all unless two viewport changes move it first.

## Reading the numbers

- **react** — commits inside the interaction window. Per GESTURE, not per frame; a handful at the
  end of a drag is the controlled-component contract, a number that tracks pointermoves is the bug.
- **draws / instances** — GL work. Compare the same interaction at two graph sizes: if these scale
  with the size of the graph rather than with what is on screen, nothing is being culled.
- **alloc KB** — sampled through CDP's heap profiler, not diffed from `usedJSHeapSize`. A heap-size
  delta reports what SURVIVED a collection, so a handler allocating a megabyte of garbage per frame
  and collecting all of it shows as zero.
- **wall** — round-trip time for the scripted input. Not a performance number.

## Why token-census.mjs exists before the v2 swap

The token reader takes a fallback for anything it cannot find, and the entire fallback table is
DARK. A theme missing tokens therefore produces no error, no warning, and nothing obviously wrong
in dark mode — it paints dark constants into a light UI, one token at a time, and the more that are
missing the more of the canvas is hardcoded rather than themed.

The behaviour suite asserts the census is clean, so the commit that swaps design systems fails and
NAMES each token that stopped resolving. This spike prints the same census grouped, which is the
form you want while doing the port rather than after it.

## glass-compare.mjs: real v2 beside the GL controls

`glass-look.mjs` shows the GL controls alone, which is how the first two passes were judged, and
how a look that did not match v2 got approved by its author. This spike builds
`reference/reference.tsx`, a page of real v2 controls in `material="regular"`, and screenshots it
next to the canvas at the same device scale, closed and with a list open, in both appearances
(`dist/compare/`). `v2-probe.mjs` prints each v2 part's computed style, pseudo-elements included,
so a number can be read off the real control and not guessed from a token.

## magnet.mjs: a wire dragged into a socket

The pull, the morph and the fused bridge (gl/magnet.ts, D21) are a LOOK and a FEEL, and the laws
can only assert the parts that are numbers — that a compatible socket pulls, that a release inside
the pull connects, that a refusing one pulls nothing. This walks a drag in from out of reach to on
the dot in the magnet's own units, shooting each stage around the TARGET socket and printing the
stage, the pull, the verdict and how far the tip is lagging the pointer. It does it twice: once
against a socket that accepts and once against one that refuses, in both appearances
(`dist/magnet/`).

What to look for: at `awake` the ring thickens and the tip is a separate head held short of it; at
`recognised` the tip reaches the rim; at `fused` the hole is closed, the dot has swelled and the
neck has merged into it. A refusing socket must look untouched at every stage.

