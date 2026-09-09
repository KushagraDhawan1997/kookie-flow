/**
 * The element the design system's tokens are scoped to.
 *
 * ONE home, because there were three — `useThemeTokens` fell back to `document.documentElement`,
 * `getColorProbe` fell back to `document.body`, and the harness inlined its own copy in five
 * files — and they answered the same question differently.
 *
 * WHY THE FALLBACK IS A LAST RESORT AND NEVER A WORKING PATH, and it is the failure mode no law
 * can see. KookieUI v2 declares its tokens at `:root` and re-declares them inside
 * `[data-appearance]`, `[data-density]`, `[data-radius]` and `[data-pointer]` scopes — so falling
 * through to `<html>` returns a COMPLETE, VALID palette that is simply the wrong one: the root
 * appearance rather than the Theme's. Every token resolves, the census passes, and the whole
 * canvas paints in light while the app is in dark. A null here would be loud; this is silent.
 *
 * The v1 `.radix-themes` branch is gone with v1 itself (see `useThemeTokens`). It mattered for a
 * different reason worth keeping on the record: v1 scoped its tokens to that class, so a probe
 * outside the element resolved NOTHING — `var(--accent-9)` came back `rgb(0,0,0)` from `<body>`
 * against `rgb(0,144,255)` from inside. Loudly wrong beats quietly wrong.
 */
export function themeRoot(): Element {
  if (typeof document === 'undefined') return null as unknown as Element;
  return document.querySelector('.kui-theme') ?? document.documentElement;
}
