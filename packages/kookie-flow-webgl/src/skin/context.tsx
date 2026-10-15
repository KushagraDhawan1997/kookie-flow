import { createContext, useContext } from 'react';
import type { FlowSkin } from './types';
import { glassSkin } from './glass/index';

/**
 * The skin the editor paints with. One value per editor, set once; changing it rebuilds
 * materials like a theme change does, never per frame.
 */
const SkinContext = createContext<FlowSkin>(glassSkin);

export const SkinProvider = SkinContext.Provider;

export function useSkin(): FlowSkin {
  return useContext(SkinContext);
}
