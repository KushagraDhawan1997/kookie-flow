# Skin layer: separating how Flow looks from how it works

Goal: Womp copies `core`, `react` and `webgl` unchanged and writes only its own skin
(solid, Kookie UI v1 tokens). Ports between the two repos then never touch a look file.

## The three layers

| Layer    | Owns                                                                                                                                     | Package                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Logic    | graph, store, history, layout, evaluation                                                                                                | `kookie-flow-core` (already clean)                                           |
| Behavior | geometry, SDF shapes, hit testing, state (hover, selected, focus, accent hue), pointer and keyboard, accessibility mirror, text, culling | `kookie-flow-webgl`                                                          |
| Look     | which token plays which role, sizes and radii, material numbers, the shader code that paints a surface, whether a backdrop is sampled    | new: `kookie-flow-skin` (yours), `@womp/kookie-flow-skin-solid` (Womp) |

The rule: `webgl` never names a CSS token, a material value or a glass function. It asks the skin.

## Where the look lives today

Already in one place, easy to move:

- `core/theme-colors.ts` (role to token), `utils/style-resolver.ts` (size, variant, radius maps),
  `hooks/useThemeTokens.ts` (token list, fallbacks, `.kui-theme` host), `gl/material.ts` (v2 numbers).
- `core/palette.ts` and `utils/accent-colors.ts`: socket and header hues. These were measured from
  v1, so they stay shared in `webgl`.

Tangled, the real work:

- Glass layering is written inline in component shaders: `nodes.tsx` (aura, rim light, cast,
  header band), `widgets-gl.tsx` (ring, light, cast, marks), `widget-popover.tsx` (floating
  surface, backdrop blur, rows), `utils/media-quad.ts` + four media entity files (lens, glass
  controls). `sockets.tsx` and `edges.tsx` only use the `over` helper.
- The backdrop snapshot pass (`gl/backdrop.ts`, used by popover, toolbar, media lens) is a glass
  need, always on.
- `toolbar.tsx` and `media-viewer.tsx` import v2 React components (`Toolbar`, `Button`, `iconStroke`).

## The skin interface

```ts
interface FlowSkin {
  tokenHost: string; // '.kui-theme' | '.radix-themes'
  tokens: SkinTokens; // role -> token, per appearance (today THEME_COLORS)
  metrics: SkinMetrics; // size, radius, variant maps (today style-resolver maps)
  material: Record<'light' | 'dark', unknown>; // skin-private numbers, passed to its own GLSL
  glsl: string; // implements the paint functions below
  usesBackdrop: boolean; // false skips the snapshot pass
  ui: { Toolbar; Button; iconStroke? }; // DOM chrome components
}
```

Fixed paint functions every skin implements. Inputs are shape distance, size, state flags and
resolved colors; output is one straight-alpha `vec4`:
`paintCard` (node body, header band, accent), `paintControl` (widget fill, ring, states),
`paintMark` (check, radio, slider thumb), `paintFloating` (popover surface), `paintRow`,
`paintMediaChrome`. Solid is a subset of glass (fill, border, shadow), so the signatures fit both.

## Steps (PRs in your repo, no visual change until step 6)

1. Add `SkinContext` and move the token, metric and material files under `src/skin/glass/`.
   Components read through the context.
2. Replace inline glass in `widgets-gl.tsx` and `widget-popover.tsx` with paint calls.
3. Same for `nodes.tsx`, then `media-quad.ts` and the media entities.
4. Make the backdrop pass conditional on `usesBackdrop`; route DOM chrome through `skin.ui`.
5. Move `src/skin/glass/` into `kookie-flow-skin`. `check:boundaries` fails if `webgl`
   imports a skin.
6. Womp copy: `core`, `react`, `webgl` verbatim; write `skin-solid` against v1 tokens.

The skin is read once at material build, like tokens today: no per-frame cost, no new re-renders.
Each of steps 1-5 must pass the existing browser suite with pixel-identical screenshots.

## Decisions

- Separate skin package, or a folder inside `webgl`? Recommended: package, so Womp's copy of
  `webgl` is byte-identical.
- Default skin? Recommended: `skin` is a required prop on `react`; the legacy `kookie-flow`
  package defaults to glass so existing consumers don't break.
