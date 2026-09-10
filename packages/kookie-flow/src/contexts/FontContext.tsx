import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';
import * as THREE from 'three';
import type { FontPreset, FontConfig, FontWeightConfig } from '../types';
import type { FontMetrics, GlyphMap, KerningMap } from '../utils/text-layout';
import { buildGlyphMap, buildKerningMap } from '../utils/text-layout';

/**
 * Loaded font data for WebGL rendering.
 * Includes pre-built lookup maps so consumers don't duplicate them.
 */
export interface LoadedFontWeight {
  metrics: FontMetrics;
  texture: THREE.Texture;
  /** Pre-built glyph lookup map (O(1) by charCode) — shared across all consumers */
  glyphMap: GlyphMap;
  /** Pre-built kerning lookup map (O(1) by packed pair key) — shared across all consumers */
  kerningMap: KerningMap;
}

/**
 * Font context value for WebGL text rendering.
 */
export interface FontContextValue {
  /** Loaded regular weight font (metrics + texture) */
  regular: LoadedFontWeight | null;
  /** Loaded semibold weight font (metrics + texture) */
  semibold: LoadedFontWeight | null;
  /** Whether fonts are still loading */
  isLoading: boolean;
  /** Current font preset name (if using a preset) */
  presetName: FontPreset | null;
}

const DEFAULT_CONTEXT: FontContextValue = {
  regular: null,
  semibold: null,
  isLoading: true,
  presetName: 'inter',
};

const FontContext = createContext<FontContextValue>(DEFAULT_CONTEXT);

interface FontProviderProps {
  children: ReactNode;
  /** Font preset or custom configuration. Default: 'inter' */
  font?: FontPreset | FontConfig;
}

/**
 * Atlas textures, cached by URL for the lifetime of the page.
 *
 * A font atlas is a 512x512 RGBA texture — about 1MB of GPU memory per weight, two per font. This
 * used to mint a fresh one on every run of the loading effect, and the effect is keyed on the
 * `font` PROP: a consumer writing `<KookieFlow font={{ name: 'X', weights: {...} }} />` with an
 * inline object hands it a new identity on every render, so every render of the host component
 * uploaded two more atlases and dropped the previous pair on the floor.
 *
 * Caching by URL rather than disposing on change is deliberate, and it is the trade this codebase
 * already made one file over — `text-renderer.tsx` holds the same map, keyed the same way, with the
 * same texture configuration, for the same asset class. It makes the leak structurally impossible
 * instead of guarded: two configs naming one atlas resolve to one texture, so there is nothing to
 * dispose and no window in which a live `uAtlas` uniform can name a disposed one. The cost is that
 * an atlas is retained for the page lifetime, bounded by the number of distinct atlas URLs.
 */
const atlasCache = new Map<string, THREE.Texture>();

/**
 * Loads a THREE.Texture from a URL or base64 data URL.
 */
function loadTexture(url: string): THREE.Texture {
  const cached = atlasCache.get(url);
  if (cached) return cached;

  const texture = new THREE.TextureLoader().load(url);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  atlasCache.set(url, texture);
  return texture;
}

/**
 * Loads font weight data (metrics + texture).
 */
function loadFontWeight(config: FontWeightConfig): LoadedFontWeight {
  return {
    metrics: config.metrics,
    texture: loadTexture(config.atlasUrl),
    glyphMap: buildGlyphMap(config.metrics),
    kerningMap: buildKerningMap(config.metrics),
  };
}

/**
 * Checks if the font prop is a preset name.
 */
function isPreset(font: FontPreset | FontConfig): font is FontPreset {
  return typeof font === 'string';
}

/**
 * Provides font configuration for WebGL text rendering.
 *
 * - For preset fonts, lazily loads the MSDF atlas
 * - For custom fonts, uses the provided metrics and atlas URL
 * - Memoized to prevent re-computation during interactions
 */
interface FontState {
  regular: LoadedFontWeight | null;
  semibold: LoadedFontWeight | null;
  isLoading: boolean;
}

const INITIAL_FONT_STATE: FontState = { regular: null, semibold: null, isLoading: true };
const EMPTY_LOADED: FontState = { regular: null, semibold: null, isLoading: false };

export function FontProvider({ children, font = 'inter' }: FontProviderProps) {
  const [fontState, setFontState] = useState<FontState>(INITIAL_FONT_STATE);

  /**
   * What the font prop MEANS, rather than which object it is.
   *
   * The loading effect below is keyed on `font`, and an inline `{ name, weights }` literal is a
   * new object on every render — so the effect re-ran on every render of the host component,
   * rebuilding the glyph and kerning maps and re-rendering every text consumer, forever. Two
   * configs naming the same atlases are the same font.
   */
  const fontKey = isPreset(font)
    ? font
    : `${font.name}|${font.weights.regular.atlasUrl}|${font.weights.semibold?.atlasUrl ?? ''}`;

  // Load fonts when prop changes
  useEffect(() => {
    let cancelled = false;
    setFontState(INITIAL_FONT_STATE);

    async function loadFonts() {
      try {
        if (isPreset(font)) {
          const preset = await loadFontPreset(font);
          if (cancelled) return;

          if (preset) {
            const regular = loadFontWeight(preset.weights.regular);
            const semibold = preset.weights.semibold
              ? loadFontWeight(preset.weights.semibold)
              : null;
            setFontState({ regular, semibold, isLoading: false });
          } else {
            setFontState(EMPTY_LOADED);
          }
        } else {
          const regular = loadFontWeight(font.weights.regular);
          const semibold = font.weights.semibold
            ? loadFontWeight(font.weights.semibold)
            : null;
          setFontState({ regular, semibold, isLoading: false });
        }
      } catch (error) {
        console.error('Failed to load fonts:', error);
        setFontState(EMPTY_LOADED);
      }
    }

    loadFonts();

    return () => {
      cancelled = true;
    };
    // `fontKey`, not `font`: identity is not the question, and the atlases are cached by URL so
    // re-running for the same font would be work with no output anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  const value = useMemo<FontContextValue>(
    () => ({
      regular: fontState.regular,
      semibold: fontState.semibold,
      isLoading: fontState.isLoading,
      presetName: isPreset(font) ? font : null,
    }),
    [fontState, font]
  );

  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

/**
 * Hook to access loaded fonts for WebGL rendering.
 */
export function useFont(): FontContextValue {
  return useContext(FontContext);
}

/**
 * Resolve the correct LoadedFontWeight for a numeric CSS font-weight.
 * - fontWeight < 600 → regular
 * - fontWeight >= 600 → semibold (if available), else regular
 */
export function resolveFontForWeight(
  fontContext: FontContextValue,
  fontWeight: number
): LoadedFontWeight | null {
  if (fontWeight >= 600 && fontContext.semibold) return fontContext.semibold;
  return fontContext.regular;
}

/**
 * Lazily loads a font preset's atlas.
 *
 * Every preset but one is a pre-baked MSDF that arrives as a dynamic import. `system` is built
 * from the platform's own font when it is asked for — see utils/runtime-atlas.ts.
 */
async function loadFontPreset(preset: FontPreset): Promise<FontConfig | null> {
  switch (preset) {
    case 'inter': {
      // Inter is the bundled atlas. The import is dynamic so the ~568 KB of base64 lands in its own
      // chunk rather than in the package entry — a consumer that supplies its own FontConfig, or
      // asks for 'system', never downloads it.
      const {
        EMBEDDED_FONT_METRICS_REGULAR,
        EMBEDDED_FONT_ATLAS_URL_REGULAR,
        EMBEDDED_FONT_METRICS_SEMIBOLD,
        EMBEDDED_FONT_ATLAS_URL_SEMIBOLD,
      } = await import('../core/embedded-font');
      return {
        name: 'Inter',
        weights: {
          regular: {
            metrics: EMBEDDED_FONT_METRICS_REGULAR,
            atlasUrl: EMBEDDED_FONT_ATLAS_URL_REGULAR,
          },
          semibold: {
            metrics: EMBEDDED_FONT_METRICS_SEMIBOLD,
            atlasUrl: EMBEDDED_FONT_ATLAS_URL_SEMIBOLD,
          },
        },
      };
    }

    case 'roboto':
    case 'source-serif': {
      // MSDF atlases not yet bundled for these presets.
      // Provide an actionable message so developers know how to supply their own.
      console.warn(
        `[KookieFlow] Font preset "${preset}" is not yet bundled. ` +
        `Falling back to Inter. To use ${preset}, provide a custom FontConfig ` +
        `with your own MSDF atlas via the \`font\` prop.`
      );
      return loadFontPreset('inter');
    }

    case 'system': {
      /**
       * The platform's own UI font, baked into an atlas here and now.
       *
       * It cannot be pre-baked like the others: nobody knows what it is until the page is open,
       * and it differs by machine. This used to return null, which meant `font="system"` drew no
       * text at all — an option that silently produced an empty board.
       */
      const { buildRuntimeAtlas } = await import('../utils/runtime-atlas');
      const regular = buildRuntimeAtlas({ weight: 400 });
      if (!regular) {
        console.warn(
          '[KookieFlow] font="system" needs a 2D canvas to build its atlas and there is none. ' +
          'Falling back to Inter.'
        );
        return loadFontPreset('inter');
      }
      const semibold = buildRuntimeAtlas({ weight: 600 });
      return {
        name: 'System',
        weights: {
          regular: { metrics: regular.metrics, atlasUrl: regular.atlasUrl },
          ...(semibold
            ? { semibold: { metrics: semibold.metrics, atlasUrl: semibold.atlasUrl } }
            : {}),
        },
      };
    }

    default:
      console.warn(
        `[KookieFlow] Unknown font preset "${preset}". ` +
        `Falling back to Inter. Valid presets: "inter", "roboto", "source-serif", "system".`
      );
      return loadFontPreset('inter');
  }
}

/**
 * Test seam. Exported under a dunder name so it is obviously not API: the atlas cache is
 * module-level and lives for the page, which is correct in an app and useless in a test file that
 * needs each case to start empty.
 */
export const __testing = {
  loadTexture,
  clearAtlasCache: () => atlasCache.clear(),
};
