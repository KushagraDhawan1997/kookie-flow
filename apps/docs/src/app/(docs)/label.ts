/**
 * An identifier, written the way a person reads it.
 *
 * DERIVED, NEVER A SECOND FIELD. An exported name is the key code matches on, so it cannot
 * become "Flow Store" without breaking that. A `displayName` beside it would be a second home
 * for one fact, and the two would part company the first time something was renamed. The rule
 * is mechanical, so it is a function.
 *
 * ONE FUNCTION FOR BOTH KINDS OF NAME. A component is `PascalCase` and a prop is `camelCase`,
 * and the difference is only whether the first word is already capitalized — so the split is
 * the same and the capitalization is applied once, at the front.
 */
export const humanLabel = (identifier: string): string =>
  identifier
    // The boundary is lowercase-or-digit followed by uppercase: `KookieFlow` → `Kookie Flow`,
    // `lineNumbers` → `line Numbers`, `Kbd` and `size` untouched.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
