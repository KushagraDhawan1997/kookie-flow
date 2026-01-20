import { createContext, useContext, type ReactNode } from 'react';
import { useThemeTokens, FALLBACK_TOKENS, type ThemeTokens } from '../hooks/useThemeTokens';

/**
 * Context for sharing theme tokens across all Kookie Flow components.
 * Ensures single DOM read per theme change.
 */
const ThemeContext = createContext<ThemeTokens>(FALLBACK_TOKENS);

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Provides theme tokens to all child components.
 * Reads CSS variables once and shares via context.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const tokens = useThemeTokens();
  return <ThemeContext.Provider value={tokens}>{children}</ThemeContext.Provider>;
}

/**
 * Hook to access theme tokens from context.
 * Use this in child components instead of useThemeTokens() directly
 * to avoid duplicate DOM reads.
 */
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
