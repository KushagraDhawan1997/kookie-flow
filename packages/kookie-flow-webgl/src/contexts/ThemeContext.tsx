import { createContext, useContext, useState, type ReactNode } from 'react';
import { useThemeTokens, type ThemeTokens } from '../hooks/useThemeTokens';
import { useSkin } from '../skin/context';
import { GLASS_FALLBACK_TOKENS } from '../skin/glass/tokens';
const ThemeContext = createContext<ThemeTokens>(GLASS_FALLBACK_TOKENS);
const ThemeScopeContext = createContext<Element | null>(null);
export interface ThemeProviderProps {
  children: ReactNode;
}
/** One invisible scope anchor per editor, independent of the number of graph entities. */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [scope, setScope] = useState<HTMLDivElement | null>(null);
  const skin = useSkin();
  const tokens = useThemeTokens(scope, skin);
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
