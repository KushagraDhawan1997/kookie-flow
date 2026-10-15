import { createContext, useContext } from 'react';
import type { FlowSkin } from './types';

/**
 * The skin the editor paints with. One value per editor, set once; changing it rebuilds
 * materials like a theme change does, never per frame. There is no default: the renderer has no
 * look of its own.
 */
const SkinContext = createContext<FlowSkin | null>(null);

export const SkinProvider = SkinContext.Provider;

export function useSkin(): FlowSkin {
  const skin = useContext(SkinContext);
  if (!skin) {
    throw new Error(
      'Kookie Flow has no skin. Pass `skin` to <KookieFlow>, for example `glassSkin` from ' +
        '@kushagradhawan/kookie-flow-skin-glass.'
    );
  }
  return skin;
}
