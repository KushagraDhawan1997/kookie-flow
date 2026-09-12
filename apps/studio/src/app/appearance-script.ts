/**
 * The pre-paint appearance stamp, the same mechanism the docs site uses: the server cannot know
 * the visitor's appearance, so this runs synchronously in <head> before first paint and writes
 * `data-appearance` on <html>, where the root `<Theme appearance="inherit">` reads it. The read is
 * guarded separately from the stamp, because storage access can throw and the stamp must still
 * happen.
 */
export const APPEARANCE_KEY = 'studio-appearance';

export const appearanceScript = `(function () {
  var e = document.documentElement;
  var read = function (k) { try { return localStorage.getItem(k); } catch (err) { return null; } };
  var a = read(${JSON.stringify(APPEARANCE_KEY)});
  var dark = a === "light" ? false : a === "dark" ? true : matchMedia("(prefers-color-scheme: dark)").matches;
  e.setAttribute("data-appearance", dark ? "dark" : "light");
})();`;
