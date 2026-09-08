# Verified environment facts (probed, not assumed)

Measured 2026-09-08 in the migration session container. Re-probe on any other machine —
these numbers gate the Phase-0 harness design.

## Toolchain
- Node 22.22.2, pnpm 10.28.2. `pnpm install` succeeds.
- `pnpm --filter @kushagradhawan/kookie-flow test` → **149 passed** (vitest 4, node env).
- `pnpm --filter @kushagradhawan/kookie-flow lint` (`tsc --noEmit`) → **clean**.
- Existing coverage is `src/core/graph.test.ts` only: pure graph algorithms. There is
  **zero** coverage of rendering, interaction, pan/zoom, selection, widgets, text editing
  or performance. Phase 0 is building that from nothing.

## Headless browser (gates the browser + perf tiers)
Chromium 1194 at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(`/opt/pw-browsers/chromium` is the same binary). `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. A `playwright-core` installed from npm resolves to
build 1243 and will NOT launch — **pass `executablePath` explicitly**.

WebGL2 probe result, identical across default / `--use-angle=swiftshader` /
`--ignore-gpu-blocklist`:

| Property | Value |
|---|---|
| `webgl2` | available |
| renderer | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` |
| `MAX_TEXTURE_SIZE` | 8192 |
| `EXT_color_buffer_float` | yes |
| `EXT_float_blend` | yes |
| `readPixels` fidelity | **exact** — `clearColor(0.2,0.4,0.6,1)` reads back `[51,102,153,255]` |

### What this means for the harness
1. **The browser tier is viable.** R3F/three.js will run headlessly.
2. **Verification spike #1 is measurable here.** `readPixels` is exact with no rounding
   drift, so "a GL node's `--tone-solid` must sample to the same pixel as a DOM button's
   `--tone-solid`" can be asserted as an equality, not a tolerance. Any mismatch found will
   be a real colour-pipeline bug (CSS OKLCH→sRGB vs three.js colour management / output
   encoding), never instrument noise.
3. **There is no hardware GPU.** Everything rasterises through SwiftShader. Absolute frame
   times are therefore meaningless as an SLO — a 50K-node "60fps" claim cannot be made from
   this machine. Perf gating must be **relative**: same fixture, same machine, before vs
   after, with the distribution reported (p50/p95), not a single mean. Absolute targets need
   a run on real hardware and must be labelled as such.
4. `MAX_TEXTURE_SIZE` 8192 bounds MSDF atlas growth if GL text takes on the DOM labels.
