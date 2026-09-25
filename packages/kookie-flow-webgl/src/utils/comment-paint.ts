import type { CommentEntityData, Entity } from '../types';
import type { ThemeTokens } from '../hooks/useThemeTokens';
import { noteHue, noteInk } from './note-ink';
import { parseColorToRGBA, rgbToHex, withColorScope, type RGBAColor } from './color';

export interface CommentPaint {
  fill: RGBAColor;
  edge: RGBAColor;
  text: string;
}
// An editor owns this cache through its tokens and scope. Moving a note keeps its data reference.
interface CachedPaint {
  hue: string;
  fill?: string;
  text?: string;
  paint: CommentPaint;
}
const caches = new WeakMap<Element, WeakMap<ThemeTokens, WeakMap<object, CachedPaint[]>>>();
export function commentPaint(
  entity: Entity,
  tokens: ThemeTokens,
  scope: Element | null
): CommentPaint {
  const data = entity.data as CommentEntityData;
  const hue = noteHue(data.color, entity.color);
  let cache: WeakMap<object, CachedPaint[]> | undefined;
  if (scope) {
    let themes = caches.get(scope);
    if (!themes) caches.set(scope, (themes = new WeakMap()));
    cache = themes.get(tokens);
    if (!cache) themes.set(tokens, (cache = new WeakMap()));
    const entries = cache.get(data);
    if (entries)
      for (const hit of entries) {
        if (hit.hue === hue && hit.fill === data.backgroundColor && hit.text === data.textColor)
          return hit.paint;
      }
  }
  const ink = noteInk(hue);
  const paint = withColorScope(scope, () => {
    const text = parseColorToRGBA(data.textColor ?? ink.text);
    return {
      fill: parseColorToRGBA(data.backgroundColor ?? ink.fill),
      edge: data.backgroundColor ? ([0, 0, 0, 0] as RGBAColor) : parseColorToRGBA(ink.edge),
      text: rgbToHex([text[0], text[1], text[2]]),
    };
  });
  if (cache) {
    const entries = cache.get(data) ?? [];
    if (entries.length === 8) entries.shift();
    entries.push({ hue, fill: data.backgroundColor, text: data.textColor, paint });
    cache.set(data, entries);
  }
  return paint;
}
