import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTheme } from './ThemeContext';
import { resolveNodeStyle, type ResolvedNodeStyle } from '../utils/style-resolver';
import type { NodeSize, NodeVariant, NodeRadius, NodeStyleOverrides, HeaderPosition } from '../types';

/**
 * Style configuration props passed to KookieFlow.
 */
export interface StyleConfig {
  size: NodeSize;
  variant: NodeVariant;
  radius?: NodeRadius;
  header: HeaderPosition;
  accentHeader: boolean;
  nodeStyle?: Partial<NodeStyleOverrides>;
}

/**
 * Context value combining resolved styles and configuration.
 */
export interface StyleContextValue {
  /** Resolved WebGL-ready style values */
  resolved: ResolvedNodeStyle;
  /** Original configuration */
  config: StyleConfig;
}

/** Default style configuration */
const DEFAULT_CONFIG: StyleConfig = {
  size: '2',
  variant: 'surface',
  radius: undefined,
  header: 'none',
  accentHeader: false,
  nodeStyle: undefined,
};

/**
 * Default context value (uses fallback tokens).
 * This will be overwritten by StyleProvider.
 */
const DEFAULT_CONTEXT: StyleContextValue = {
  resolved: {
    padding: 12,
    headerHeight: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: [0.239, 0.239, 0.239],
    borderColorHover: [0.306, 0.306, 0.306],
    background: [0.067, 0.067, 0.067],
    backgroundHover: [0.098, 0.098, 0.098],
    backgroundAlpha: 1,
    shadowBlur: 0,
    shadowOffsetY: 0,
    shadowOpacity: 0,
    selectedBorderColor: [0.392, 0.404, 0.961],
    fontSize: 14,
    socketSize: 10,
  },
  config: DEFAULT_CONFIG,
};

const StyleContext = createContext<StyleContextValue>(DEFAULT_CONTEXT);

interface StyleProviderProps {
  children: ReactNode;
  size?: NodeSize;
  variant?: NodeVariant;
  radius?: NodeRadius;
  header?: HeaderPosition;
  accentHeader?: boolean;
  nodeStyle?: Partial<NodeStyleOverrides>;
}

/**
 * Provides resolved node styles to all child components.
 *
 * Reads theme tokens from ThemeContext and resolves style props
 * to WebGL-ready values. Memoized to avoid re-computation.
 */
export function StyleProvider({
  children,
  size = '2',
  variant = 'surface',
  radius,
  header = 'none',
  accentHeader = false,
  nodeStyle,
}: StyleProviderProps) {
  const tokens = useTheme();

  // Resolve styles once, memoized
  const value = useMemo<StyleContextValue>(() => {
    const resolved = resolveNodeStyle(size, variant, radius, tokens, nodeStyle);
    const config: StyleConfig = {
      size,
      variant,
      radius,
      header,
      accentHeader,
      nodeStyle,
    };
    return { resolved, config };
  }, [size, variant, radius, header, accentHeader, nodeStyle, tokens]);

  return <StyleContext.Provider value={value}>{children}</StyleContext.Provider>;
}

/**
 * Hook to access resolved node styles from context.
 */
export function useNodeStyle(): StyleContextValue {
  return useContext(StyleContext);
}

/**
 * Hook to access only the resolved style values (convenience).
 */
export function useResolvedStyle(): ResolvedNodeStyle {
  return useContext(StyleContext).resolved;
}
