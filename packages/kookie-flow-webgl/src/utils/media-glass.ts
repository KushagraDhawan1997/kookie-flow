/**
 * The uniforms a piece of media's controls read: the skin's paint (`skin.shaders.media`) plus what
 * the renderer owns — the ground under a letterbox, the ink and accent of the glyphs and track, and
 * the control corner. The corner is the theme's control radius, so a pill theme gets pill controls
 * and a square one square ones.
 *
 * Built once per theme and SHARED by every material: `applyMediaGlass` binds the same uniform
 * objects into each, so a theme flip is one rebuild and a rebind, never a write per entity per frame.
 */

import * as THREE from 'three';
import type { FlowSkin } from '../skin/types';
import { resolveColor } from '../core/theme-colors';

type ThemeTokens = Parameters<typeof resolveColor>[1];

export type MediaGlass = Record<string, THREE.IUniform>;

/**
 * @param skin Supplies the colour roles and the controls' paint.
 * @param ground What shows where the media has no pixels — a letterbox, a model's transparent
 *   background: the canvas for a media entity, the card for a node's band.
 * @param controlRadius The theme's control corner. A pill sentinel is clamped by the shader to half
 *   of each control's own height, as v2 does.
 */
export function buildMediaGlass(
  skin: FlowSkin,
  tokens: ThemeTokens,
  ground: readonly number[],
  controlRadius: number
): MediaGlass {
  const { colors } = skin;
  const rgb = (v: readonly number[]) => new THREE.Color(v[0], v[1], v[2]);
  return {
    ...skin.shaders.media.uniforms({ tokens, colors }),
    uGround: { value: rgb(ground) },
    uInk: { value: rgb(resolveColor(colors.text.primary, tokens)) },
    uAccent: { value: rgb(resolveColor(colors.widget.active, tokens)) },
    uControlRadius: { value: controlRadius },
  };
}

/** Bind the shared glass into a material. The objects are shared, not copied. */
export function applyMediaGlass(material: THREE.ShaderMaterial, glass: MediaGlass): void {
  for (const key in glass) material.uniforms[key] = glass[key];
}
