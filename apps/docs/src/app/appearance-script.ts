/**
 * The pre-paint appearance stamp, ported from KookieUI v2's own docs app.
 *
 * The server cannot know the visitor's appearance, so the HTML ships without one and this
 * script runs synchronously in <head> before first paint: stored choice first,
 * `prefers-color-scheme` otherwise.
 *
 * The attribute lands on <html>, and that placement is load-bearing: the root
 * `<Theme appearance="inherit">` stamps no appearance of its own, so the scope this script
 * writes is the one every token resolves against — including the `--neutral-*` tokens
 * kookie-flow reads into WebGL. One source of truth, no flash, nothing for hydration to
 * mismatch.
 *
 * The read is guarded SEPARATELY from the stamp. Wrapping both in one try/catch meant a
 * browser that throws on storage access (Safari "Block all cookies") skipped `setAttribute`
 * too, leaving no `data-appearance` at all and a dark-OS visitor on the light fallback.
 * `matchMedia` needs no permission and always answers: read defensively, stamp unconditionally.
 */
export const APPEARANCE_KEY = 'kookie-theme';

export const appearanceScript = `(function () {
  var e = document.documentElement;
  var read = function (k) { try { return localStorage.getItem(k); } catch (err) { return null; } };
  var a = read(${JSON.stringify(APPEARANCE_KEY)});
  var dark = a === "light" ? false : a === "dark" ? true : matchMedia("(prefers-color-scheme: dark)").matches;
  e.setAttribute("data-appearance", dark ? "dark" : "light");
})();`;
