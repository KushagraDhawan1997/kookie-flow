// Compatibility entry point. New applications can import kookie-flow-react directly and pass a
// skin; this package keeps the earlier API, where the editor was glass without being told.
import { createElement, forwardRef } from 'react';
import {
  KookieFlow as FlowWithSkin,
  resolveEntityStyle as resolveEntityStyleWithMetrics,
  resolveSocketLayout as resolveSocketLayoutWithMetrics,
  useThemeTokens as useThemeTokensWithSkin,
  type FlowSkin,
  type KookieFlowInstance,
  type KookieFlowProps as KookieFlowPropsWithSkin,
  type SkinMetrics,
  type ThemeTokens,
  type EntitySize,
  type EntityVariant,
  type EntityRadius,
  type HeaderPosition,
  type EntityStyleOverrides,
  type ResolvedEntityStyle,
  type ResolvedSocketLayout,
} from '@kushagradhawan/kookie-flow-react';
import { glassSkin, GLASS_METRICS } from '@kushagradhawan/kookie-flow-skin-glass';

export * from '@kushagradhawan/kookie-flow-react';
export {
  glassSkin,
  GLASS_COLORS as THEME_COLORS,
  SIZE_MAP,
  VARIANT_MAP,
  RADIUS_MAP,
  SOCKET_ROW_HEIGHT_TOKEN,
  WIDGET_HEIGHT_TOKEN,
} from '@kushagradhawan/kookie-flow-skin-glass';

/** The editor's props, with `skin` optional: it defaults to glass. */
export type KookieFlowProps = Omit<KookieFlowPropsWithSkin, 'skin'> & { skin?: FlowSkin };

/** The editor, glass unless told otherwise. */
export const KookieFlow = forwardRef<KookieFlowInstance, KookieFlowProps>(
  function KookieFlow(props, ref) {
    return createElement(FlowWithSkin, { ...props, skin: props.skin ?? glassSkin, ref });
  }
);

/** `resolveEntityStyle` with the glass skin's metrics unless others are given. */
export function resolveEntityStyle(
  size: EntitySize | undefined,
  variant: EntityVariant | undefined,
  radius: EntityRadius | undefined,
  header: HeaderPosition | undefined,
  accentHeader: boolean | undefined,
  tokens: ThemeTokens,
  overrides?: Partial<EntityStyleOverrides>,
  metrics: SkinMetrics = GLASS_METRICS
): ResolvedEntityStyle {
  return resolveEntityStyleWithMetrics(
    size,
    variant,
    radius,
    header,
    accentHeader,
    tokens,
    overrides,
    metrics
  );
}

/** `resolveSocketLayout` with the glass skin's metrics unless others are given. */
export function resolveSocketLayout(
  hasTitleBand: boolean,
  size: EntitySize | undefined,
  tokens: ThemeTokens,
  metrics: SkinMetrics = GLASS_METRICS
): ResolvedSocketLayout {
  return resolveSocketLayoutWithMetrics(hasTitleBand, size, tokens, metrics);
}

/** `useThemeTokens` reading tokens the glass skin's way unless another skin is given. */
export function useThemeTokens(scope?: Element | null, skin: FlowSkin = glassSkin): ThemeTokens {
  return useThemeTokensWithSkin(scope, skin);
}
