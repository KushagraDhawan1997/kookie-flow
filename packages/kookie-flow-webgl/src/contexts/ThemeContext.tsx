import { createContext, useContext, useState, type ReactNode } from 'react';
import { useThemeTokens, FALLBACK_TOKENS, type ThemeTokens } from '../hooks/useThemeTokens';
const ThemeContext = createContext<ThemeTokens>(FALLBACK_TOKENS);
const ThemeScopeContext = createContext<Element | null>(null);
export interface ThemeProviderProps {
  children: ReactNode;
}
/** One invisible scope anchor per editor, independent of the number of graph entities. */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [scope, setScope] = useState<HTMLDivElement | null>(null);
  const tokens = useThemeTokens(scope);
  return (
    <div ref={setScope} style={{ display: 'contents' }} data-kookie-flow-theme="">
      <ThemeScopeContext.Provider value={scope}>
        <ThemeContext.Provider value={tokens}>{children}</ThemeContext.Provider>
      </ThemeScopeContext.Provider>
    </div>
  );
}
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
export function useThemeScope(): Element | null {
  return useContext(ThemeScopeContext);
}
