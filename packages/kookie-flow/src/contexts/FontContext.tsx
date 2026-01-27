import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';
import * as THREE from 'three';
import type { FontPreset, FontConfig, FontWeightConfig } from '../types';
import type { FontMetrics } from '../utils/text-layout';

/**
 * Loaded font data for WebGL rendering.
 */
export interface LoadedFontWeight {
  metrics: FontMetrics;
  texture: THREE.Texture;
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
export function FontProvider({ children, font = 'google-sans' }: FontProviderProps) {
  const [loadedFonts, setLoadedFonts] = useState<{
    regular: LoadedFontWeight | null;
    semibold: LoadedFontWeight | null;
  }>({ regular: null, semibold: null });
  const [isLoading, setIsLoading] = useState(true);

  // Load fonts when prop changes
  useEffect(() => {
    let cancelled = false;

    async function loadFonts() {
      setIsLoading(true);

      try {
        if (isPreset(font)) {
          // Load preset fonts dynamically
          const preset = await loadFontPreset(font);
          if (cancelled) return;

          if (preset) {
            const regular = loadFontWeight(preset.weights.regular);
            const semibold = preset.weights.semibold
              ? loadFontWeight(preset.weights.semibold)
              : null;
            setLoadedFonts({ regular, semibold });
          } else {
            // System preset or unknown - no WebGL fonts
            setLoadedFonts({ regular: null, semibold: null });
          }
        } else {
          // Custom FontConfig
          const regular = loadFontWeight(font.weights.regular);
          const semibold = font.weights.semibold
            ? loadFontWeight(font.weights.semibold)
            : null;
          setLoadedFonts({ regular, semibold });
        }
      } catch (error) {
        console.error('Failed to load fonts:', error);
        setLoadedFonts({ regular: null, semibold: null });
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    }

    loadFonts();

    return () => {
      cancelled = true;
    };
  }, [font]);

  const value = useMemo<FontContextValue>(
    () => ({
      regular: loadedFonts.regular,
      semibold: loadedFonts.semibold,
      isLoading,
      presetName: isPreset(font) ? font : null,
    }),
    [loadedFonts, isLoading, font]
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

    case 'inter': {
      // Inter - lazily loaded when we have the atlases
      // TODO: Generate and bundle Inter MSDF atlases
      // For now, fall back to Google Sans
      console.warn('Inter font preset not yet available, falling back to Google Sans');
      return loadFontPreset('google-sans');
    }

    case 'roboto': {
      // Roboto - lazily loaded when we have the atlases
      // TODO: Generate and bundle Roboto MSDF atlases
      console.warn('Roboto font preset not yet available, falling back to Google Sans');
      return loadFontPreset('google-sans');
    }

    case 'source-serif': {
      // Source Serif - lazily loaded when we have the atlases
      // TODO: Generate and bundle Source Serif MSDF atlases
      console.warn('Source Serif font preset not yet available, falling back to Google Sans');
      return loadFontPreset('google-sans');
    }

    case 'system':
      // System fonts - no WebGL rendering, use DOM mode
      return null;

    default:
      console.warn(`Unknown font preset: ${preset}, falling back to Google Sans`);
      return loadFontPreset('google-sans');
  }
}
