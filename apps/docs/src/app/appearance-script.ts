/**
 * The pre-paint appearance stamp — the dark-mode SSR answer (REVIEW "Dark-mode flash / SSR",
 * §18's "dark mode keeps its inline script alone"). The server cannot know the visitor's
 * appearance, so the HTML ships without one and this script runs synchronously in <head>,
 * before first paint: stored choice first, `prefers-color-scheme` otherwise.
 *
 * Both attributes land on <html>, and that placement is load-bearing twice over:
 *  - the root <Theme appearance="inherit"> stamps no appearance of its own, so the scope the
 *    script writes is the one every token resolves against — no second source of truth;
 *  - the generated contrast="high" selectors assume `data-appearance` and `data-contrast`
 *    co-locate on ONE element (§7 — Theme normally guarantees it), so the script owns both.
 *
 * Kept as a string in its own module so the store (appearance.tsx) and the layout agree on
 * the storage keys by import rather than by coincidence.
 */
export const APPEARANCE_KEY = "kui-appearance";
export const CONTRAST_KEY = "kui-contrast";

/**
 * The read is guarded SEPARATELY from the stamp, which is the whole shape of this script.
 *
 * Wrapping the two together — one try/catch around everything — meant that a browser which
 * throws on storage access (Safari "Block all cookies" and friends) skipped the
 * `setAttribute` calls as well, so the page was left with no `data-appearance` at all and a
 * dark-OS visitor silently got the light `:root` fallback. The stored choice is the only
 * part that can fail; `matchMedia` needs no permission and always answers. So: read
 * defensively, then stamp unconditionally.
 */
export const appearanceScript = `(function () {
  var e = document.documentElement;
  var read = function (k) { try { return localStorage.getItem(k); } catch (err) { return null; } };
  var a = read(${JSON.stringify(APPEARANCE_KEY)});
  var dark = a === "light" ? false : a === "dark" ? true : matchMedia("(prefers-color-scheme: dark)").matches;
  e.setAttribute("data-appearance", dark ? "dark" : "light");
  var c = read(${JSON.stringify(CONTRAST_KEY)});
  if (c === "high" || c === "normal") e.setAttribute("data-contrast", c);
})();`;
