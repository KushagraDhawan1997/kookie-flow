import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTheme } from './ThemeContext';
import {
  resolveEntityStyle,
  resolveSocketLayout,
  type ResolvedEntityStyle,
  type ResolvedSocketLayout,
} from '../utils/style-resolver';
import type { EntitySize, EntityVariant, EntityRadius, EntityStyleOverrides, HeaderPosition } from '../types';
import { WIDGET_RADIUS, PAD } from '../utils/widget-text';
import { FALLBACK_TOKENS } from '../hooks/useThemeTokens';

/**
 * Style configuration props passed to KookieFlow.
 */
export interface StyleConfig {
  size: EntitySize;
  variant: EntityVariant;
  radius?: EntityRadius;
  header: HeaderPosition;
  accentHeader: boolean;
  entityStyle?: Partial<EntityStyleOverrides>;
}

/**
 * Context value combining resolved styles and configuration.
 */
export interface StyleContextValue {
  /** Resolved WebGL-ready style values */
  resolved: ResolvedEntityStyle;
  /** Resolved socket layout for positioning sockets and widgets */
  socketLayout: ResolvedSocketLayout;
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
  entityStyle: undefined,
};

/**
 * Default context value (uses fallback tokens).
 * This will be overwritten by StyleProvider.
 */
const DEFAULT_CONTEXT: StyleContextValue = {
  resolved: {
    padding: 12,
    headerHeight: 40, // --space-7 default
    headerBackground: [0.133, 0.133, 0.133], // --gray-3 default
    accentBand: null,
    headerPosition: 0, // none
    borderRadius: 12,
    widgetRadius: WIDGET_RADIUS,
    widgetPad: PAD,
    borderWidth: 1,
    borderColor: [0.239, 0.239, 0.239],
    borderColorHover: [0.306, 0.306, 0.306],
    background: [0.067, 0.067, 0.067],
    backgroundHover: [0.098, 0.098, 0.098],
    backgroundAlpha: 1,
    shadowBlur: 0,
    shadowOffsetY: 0,
    shadowOpacity: 0,
    topLightAlpha: 0,
    selectedBorderColor: [0.392, 0.404, 0.961],
    fontSize: 14,
    socketSize: 10,
  },
  // ONE source, not a second copy. These literals were the object eight unit fixtures were copied
  // from, so every one of them drifted the moment the real resolver moved.
  socketLayout: resolveSocketLayout(false, '2', FALLBACK_TOKENS),
  config: DEFAULT_CONFIG,
};

const StyleContext = createContext<StyleContextValue>(DEFAULT_CONTEXT);

interface StyleProviderProps {
  children: ReactNode;
  size?: EntitySize;
  variant?: EntityVariant;
  radius?: EntityRadius;
  header?: HeaderPosition;
  accentHeader?: boolean;
  entityStyle?: Partial<EntityStyleOverrides>;
}

/**
 * Provides resolved entity styles to all child components.
 *
 * Reads theme tokens from ThemeContext and resolves style props
 * to WebGL-ready values. Memoized to avoid re-computation.
 */
/**
 * Are two style-override objects the same style?
 *
 * `EntityStyleOverrides` is five flat, optional primitives, so this is O(1) and allocation-free.
 * A deep compare would be wrong here as well as slower: the point is to survive an inline literal,
 * and an inline literal never nests.
 */
function sameOverrides(
  a: EntityStyleOverrides | undefined,
  b: EntityStyleOverrides | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.background === b.background &&
    a.borderColor === b.borderColor &&
    a.borderWidth === b.borderWidth &&
    a.borderRadius === b.borderRadius &&
    a.shadow === b.shadow
  );
}

export function StyleProvider({
  children,
  size = '2',
  variant = 'surface',
  radius,
  header = 'none',
  accentHeader = false,
  entityStyle,
}: StyleProviderProps) {
  const tokens = useTheme();

  /**
   * `entityStyle` stabilised by VALUE.
   *
   * It is a plain object prop, so a consumer writing `entityStyle={{ background: '#111' }}` inline
   * hands this a new identity on every render — and it is in the dependency list of the memo below,
   * so every render of the host component re-resolved every entity style, rebuilt the socket
   * layout, and pushed a new context value to every consumer of it.
   *
   * React's documented render-phase adjustment rather than a ref written during render: a
   * render-body ref write is precisely the defect the audit files separately, three files over, and
   * copying it here to fix this one would be a poor trade. The compare is five flat primitives, so
   * it allocates nothing — the same shape as `sameLayout` in the socket layout cache.
   */
  const [stableStyle, setStableStyle] = useState(entityStyle);
  if (!sameOverrides(stableStyle, entityStyle)) setStableStyle(entityStyle);

  // Resolve styles once, memoized
  const value = useMemo<StyleContextValue>(() => {
    const resolved = resolveEntityStyle(size, variant, radius, header, accentHeader, tokens, stableStyle);
    // `none` draws the title in the body too, so it reserves the same band `inside` does; only
    // `outside` puts it above and needs none.
    const socketLayout = resolveSocketLayout(header !== 'outside', size, tokens);
    const config: StyleConfig = {
      size,
      variant,
      radius,
      header,
      accentHeader,
      entityStyle: stableStyle,
    };
    return { resolved, socketLayout, config };
  }, [size, variant, radius, header, accentHeader, stableStyle, tokens]);

  return <StyleContext.Provider value={value}>{children}</StyleContext.Provider>;
}

/**
 * Hook to access resolved entity styles from context.
 */
export function useEntityStyle(): StyleContextValue {
  return useContext(StyleContext);
}

/**
 * Hook to access only the resolved style values (convenience).
 */
export function useResolvedStyle(): ResolvedEntityStyle {
  return useContext(StyleContext).resolved;
}

/**
 * Hook to access the resolved socket layout (convenience).
 */
export function useSocketLayout(): ResolvedSocketLayout {
  return useContext(StyleContext).socketLayout;
}
