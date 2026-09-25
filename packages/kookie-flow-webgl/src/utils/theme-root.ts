/** Token reads belong to the caller's scope; never select another editor's theme. */
export function themeRoot(scope?: Element | null): Element | null {
  return scope ?? (typeof document === 'undefined' ? null : document.documentElement);
}
