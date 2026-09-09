/**
 * The element the design system's tokens are scoped to.
 *
 * ONE home, because there were three — `useThemeTokens` fell back to `document.documentElement`,
 * `getColorProbe` fell back to `document.body`, and the harness inlined its own copy in five
 * files — and they answered the same question differently.
 *
 * WHY THE FALLBACK ORDER IS LOAD-BEARING, and it is the failure mode no law can see. KookieUI v1
 * scoped its tokens to `.radix-themes` (`:where(.radix-themes)` in space.css, typography.css and
 * shadow.css), so a probe outside that element resolved NOTHING — loudly wrong, and measurable:
 * `var(--accent-9)` came back `rgb(0,0,0)` from `<body>` against `rgb(0,144,255)` from inside.
 *
 * v2 does not work that way. Its tokens are declared at `:root` and re-declared inside
 * `[data-appearance]`, `[data-density]`, `[data-radius]` and `[data-pointer]` scopes — so falling
 * through to `<html>` under v2 returns a COMPLETE, VALID palette that is simply the wrong one: the
 * root appearance rather than the Theme's. Every token resolves, the census passes, and the whole
 * canvas paints in light while the app is in dark.
 *
 * So the fallback to the document element is a last resort for an un-themed document, never a
 * working path. Both class names are checked because this function has to be correct on v1 and on
 * v2 — it is introduced BEFORE the swap so it is green on v1, which is what makes the swap itself
 * a port rather than a rewrite.
 */
export function themeRoot(): Element {
  if (typeof document === 'undefined') return null as unknown as Element;
  return (
    document.querySelector('.radix-themes') ??
    document.querySelector('.kui-theme') ??
    document.documentElement
  );
}
