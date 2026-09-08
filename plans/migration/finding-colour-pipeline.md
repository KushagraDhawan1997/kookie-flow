# The colour pipeline: how it works, why it holds, and the one thing that will break it

Written while establishing whether the migration's verification spike #1 ("a GL node's `--tone-solid`
must sample to the same pixel as a DOM button's `--tone-solid`") can pass. Everything below was
measured in a real headless render, not derived. Two earlier drafts of this file asserted a bug that
does not exist; the retraction is kept at the bottom because the way it was wrong is instructive.

**Verdict: the shipped colour pipeline is correct and coherent, and load-bearing on one deprecated
prop. Phase 3 had a hard blocker that had nothing to do with three.js — v2's OKLCH tokens resolved
to mid-grey — which is fixed as of 2026-09-08.**

---

## How it works today

Three facts compose, and all three have to hold:

**1. Tokens arrive as sRGB.** `useThemeTokens` reads custom properties off the theme element
(`document.querySelector('.radix-themes') ?? documentElement`, `useThemeTokens.ts:499`) and converts
via `parseColorToRGB`. Kookie UI v1 tokens are plain hex — measured, `--gray-2` is `#f9f9fb` — so
`hexToRGB` handles them and the result is sRGB in 0–1.

**2. The shaders do no colour conversion.** Flow uses **22 `ShaderMaterial`s and 2
`MeshBasicMaterial`s**, and exactly one shader includes the output encode
(`image-entities.tsx:130`, `#include <colorspace_fragment>`). Everything else writes
`gl_FragColor = vec4(uColor, …)` directly, so whatever float is in the uniform is what lands in the
framebuffer.

**3. three's colour management is OFF.** `kookie-flow.tsx:2358-2360` mounts
`<Canvas flat legacy>`, and `legacy` sets `THREE.ColorManagement.enabled = false`. Measured in the
running app: `{ revision: "182", colorManagementEnabled: false }`.

Together those give **sRGB in, sRGB out**, with no encode or decode anywhere. Both construction
styles in the codebase land on the same pixel:

| Path | Sites | Measured, management OFF | Measured, management ON |
|---|---|---|---|
| `new THREE.Color(r, g, b)` floats | 24 | **128,128,128** ✅ | 128,128,128 ✅ |
| `new THREE.Color('#808080')` hex | grid, connection-line | **128,128,128** ✅ | 55,55,55 ❌ |

(DOM truth for the same token: `rgb(128,128,128)`.)

## The fragility, which is the real finding

The coherence rests entirely on fact 3, and fact 3 rests on **`legacy`** — a prop React Three Fiber
documents as deprecated. Remove it, or move to a version that drops it, and:

- the 24 float sites keep working, because `setRGB` with the default working space still does not
  convert;
- the two hex sites (`grid.tsx:43-44`, `connection-line.tsx:111`) silently darken — measured, a
  mid-grey renders at byte 55 instead of 128;
- nothing fails loudly. The grid just gets darker and nobody knows why.

Two mitigations, worth doing before anyone touches renderer configuration:

1. **A harness law that asserts the invariant, not the mechanism.** For each GL element that draws a
   token colour, the pixel read back must equal the pixel a DOM element wearing that same token
   paints. That is spike #1, and it fails the moment `legacy` goes, whatever the cause.
2. **Say it once, in code.** The convention "our shader uniforms carry sRGB, never linear" lives
   nowhere. Give it one home:

   ```ts
   // src/utils/color.ts
   /**
    * A colour for one of our unmanaged ShaderMaterials: the uniform must carry sRGB, not linear.
    * Naming the WORKING space is how you say "do not convert" — and it stays correct whether or
    * not THREE.ColorManagement is enabled, which the bare constructor calls do not.
    */
   export function toShaderColor(rgb: RGBColor): THREE.Color {
     return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
   }
   ```

   Measured, both spellings, same render, same readback:

   | Spelling | Read back | |
   |---|---|---|
   | `setRGB(0.5,0.5,0.5, THREE.LinearSRGBColorSpace)` | **128,128,128** | ✅ |
   | `setRGB(0.5,0.5,0.5, THREE.SRGBColorSpace)` | **55,55,55** | ❌ |

   The second is the trap: the values genuinely *are* sRGB, so naming `SRGBColorSpace` reads like the
   honest thing to write, and it is exactly wrong — the argument declares the space to convert
   *from*. The helper mostly exists to stop someone making this correction in good faith.

---

## Phase 3 blocker: v2's OKLCH tokens resolved to mid-grey — FIXED 2026-09-08

**This one was real, it is not about three.js, and it would have stopped Phase 3 dead.**
Fixed in commit `fix: resolve OKLCH, lab and every modern colour function`; the description below
is kept because the failure mode is worth recognising if it ever returns.

`parseColorToRGB` (`color.ts:190`) routes anything that is not hex or `rgb()` to
`resolveColorToRGB`, which sets the value on a probe element and reads back
`getComputedStyle(probe).color`. Its comment says this "handles oklch, hsl, hwb, lab, lch, and all
other CSS color formats."

That was true when computed values were always serialised to `rgb()`. It is not true now. Measured:

```
probe.style.color = 'oklch(0.628 0.2577 29.23)'
getComputedStyle(probe).color  ->  "oklch(0.628 0.2577 29.23)"     // unchanged
```

Chrome returns modern colour functions as themselves. So `parseRGBString` matches nothing and
returns its hardcoded fallback **`[0.5, 0.5, 0.5]`** — and it does so **silently**, because the
`console.warn` in `parseColorToRGB` is only reached when `resolveColorToRGB` returns `null`, which
this path never does.

v2's tokens are OKLCH. Pointed at v2 unchanged, **every node, socket, edge and label renders
mid-grey**, with no warning.

### The fix, measured against four candidates

| Candidate | Result | |
|---|---|---|
| `getComputedStyle().color` (current) | `oklch(0.628 0.2577 29.23)` | ❌ unchanged |
| canvas 2D `fillStyle` round-trip | `oklch(0.628 0.2577 29.23)` | ❌ unchanged |
| `CSS.registerProperty` with `syntax: '<color>'` | `oklch(0.628 0.2577 29.23)` | ❌ unchanged |
| paint + `getImageData` readback | `[255, 0, 0]` | ✅ works, 8-bit |
| **`color-mix(in srgb, <value> 100%, transparent 0%)`** | `color(srgb 1.00005 0.000209593 0.000442659)` | ✅ **works, full float** |

`color-mix` wins: no canvas allocation, full float precision rather than 8-bit quantisation, and it
forces conversion into sRGB — which is exactly the space the shader uniforms need. It requires
teaching `parseRGBString` one more shape, `color(srgb r g b)`, alongside the `color(display-p3 …)`
branch it already has.

**Landed in `src/utils/color.ts`.** `readProbe()` wraps the value in `color-mix` and falls back to
the raw value behind a sentinel, because a rejected declaration leaves `color` at its inherited
value — silently wrong rather than absent. `parseRGBString`/`parseRGBAString` learned
`color(srgb r g b [/ a])`.

Verified by `harness/spikes/color-formats.mjs`, which tests the SHIPPED functions against an
independent canvas readback rather than a table of expected values written by the same person who
wrote the parser. All ten formats pass; alpha survives the wrapper. Falsified by removing the
wrapper, which reproduces the defect exactly — oklch and lab fall to mid-grey while hex and rgb stay
correct, which is precisely why v1 works and v2 would not have.

## Two smaller defects found on the way

**The exported colour probe was outside the theme scope — FIXED.** `getColorProbe` (`color.ts:25`) appends its
probe to `document.body`, but tokens are scoped to `.radix-themes`. Measured:

| Value | probe on `<body>` | probe inside the theme |
|---|---|---|
| `var(--accent-9)` | `rgb(0, 0, 0)` | `rgb(0, 144, 255)` |
| `var(--gray-2)` | `rgb(249, 249, 249)` | `rgb(249, 249, 251)` |

Flow's own rendering was unaffected — its internal path passes literal colour values, which resolve
identically anywhere. But `resolveColorToRGB` and `resolveColorToRGBA` are **public API**
(`src/index.ts:60-61`), so a consumer resolving `var(--accent-9)` got black. `getColorProbe` now
appends inside `.radix-themes` when present and re-checks the host on every call, because the theme
element mounts after this module first runs. Falsified by moving it back to body, which returns
`0,0,0`.

**`display-p3` coordinates were read as sRGB — FIXED.** `parseRGBString` matched
`color(display-p3 r g b)` and returned those coordinates directly, commented "values are already
0-1". They are 0–1 — in P3, a wider gamut. A saturated P3 red is not sRGB `(1,0,0)`. It now goes
through linear light and the P3→XYZ→sRGB matrix product, clamped, because clamping is the only
honest thing a narrower space can do with an out-of-gamut colour.

---

## Retraction, kept deliberately

Two earlier drafts of this file claimed a shipped bug: that `grid.tsx` and `connection-line.tsx`
render "markedly too dark" because they hand a colour-managed `THREE.Color` to an unmanaged shader.
The measurement supporting it was real — hex path reads back 55 where the token says 128 — but it was
taken in a **bare three.js page**, not in Flow. Flow mounts `<Canvas flat legacy>`, colour management
is off, and under that configuration the hex path is correct.

The draft before *that* claimed the exact opposite: that the 24 float sites rendered too bright. That
one came from reasoning about `THREE.Color` semantics without rendering anything, and it was wrong
because `ShaderMaterial` gets no output encode — a fact no amount of reading `Color`'s internals
would surface.

Three passes, two inverted conclusions, one correct answer. The pattern is worth naming: **each wrong
answer came from measuring a smaller system than the one in question** — first `THREE.Color` alone,
then three.js alone, and only the third time the actual application with its actual renderer flags.
Reproduce the real configuration, or do not report a colour finding.
