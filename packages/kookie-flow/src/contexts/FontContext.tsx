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
  presetName: 'google-sans',
};

const FontContext = createContext<FontContextValue>(DEFAULT_CONTEXT);

interface FontProviderProps {
  children: ReactNode;
  /** Font preset or custom configuration. Default: 'google-sans' */
  font?: FontPreset | FontConfig;
}

/**
 * Loads a THREE.Texture from a URL or base64 data URL.
 */
function loadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
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

export function FontProvider({ children, font = 'google-sans' }: FontProviderProps) {
  const [fontState, setFontState] = useState<FontState>(INITIAL_FONT_STATE);

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
  }, [font]);

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
 * Lazily loads a font preset's MSDF data.
 * Returns null for 'system' preset (no WebGL fonts).
 */
async function loadFontPreset(preset: FontPreset): Promise<FontConfig | null> {
  switch (preset) {
    case 'google-sans': {
      // Google Sans is embedded - import synchronously
      const {
        EMBEDDED_FONT_METRICS_REGULAR,
        EMBEDDED_FONT_ATLAS_URL_REGULAR,
        EMBEDDED_FONT_METRICS_SEMIBOLD,
        EMBEDDED_FONT_ATLAS_URL_SEMIBOLD,
      } = await import('../core/embedded-font');
      return {
        name: 'Google Sans',
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

    case 'inter':
    case 'roboto':
    case 'source-serif': {
      // MSDF atlases not yet bundled for these presets.
      // Provide an actionable message so developers know how to supply their own.
      console.warn(
        `[KookieFlow] Font preset "${preset}" is not yet bundled. ` +
        `Falling back to Google Sans. To use ${preset}, provide a custom FontConfig ` +
        `with your own MSDF atlas via the \`font\` prop.`
      );
      return loadFontPreset('google-sans');
    }

    case 'system':
      // System fonts - no WebGL rendering, use DOM mode
      return null;

    default:
      console.warn(
        `[KookieFlow] Unknown font preset "${preset}". ` +
        `Falling back to Google Sans. Valid presets: "google-sans", "inter", "roboto", "source-serif", "system".`
      );
      return loadFontPreset('google-sans');
  }
}
