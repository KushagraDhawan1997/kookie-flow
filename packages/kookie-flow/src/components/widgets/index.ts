/**
 * Built-in socket widgets for Phase 7D.
 *
 * All widgets use Kookie UI components at size 2 (32px height)
 * to fit within the 40px socket row height.
 */

export { SliderWidget } from './SliderWidget';
export { NumberWidget } from './NumberWidget';
export { SelectWidget } from './SelectWidget';
export { CheckboxWidget } from './CheckboxWidget';
export { TextWidget } from './TextWidget';
export { ColorWidget } from './ColorWidget';
export { TextareaWidget } from './TextareaWidget';

import type { WidgetType, WidgetProps } from '../../types';
import { SliderWidget } from './SliderWidget';
import { NumberWidget } from './NumberWidget';
import { SelectWidget } from './SelectWidget';
import { CheckboxWidget } from './CheckboxWidget';
import { TextWidget } from './TextWidget';
import { ColorWidget } from './ColorWidget';
import { TextareaWidget } from './TextareaWidget';

/**
 * Map of built-in widget types to their components.
 * Custom widgets can be added via the `widgetTypes` prop on KookieFlow.
 *
 * The canvas draws every built-in widget in GL; these DOM components remain for consumers who
 * mount them themselves. The newer kinds borrow the nearest one that writes the same value type —
 * a switch is a checkbox, a segmented control a select, a seed a number. A vector writes a
 * `number[]` and no DOM component here does, so it has no entry rather than a wrong one.
 */
export const BUILT_IN_WIDGETS: Record<Exclude<WidgetType, 'vector'>, React.ComponentType<WidgetProps>> = {
  slider: SliderWidget,
  number: NumberWidget,
  select: SelectWidget,
  checkbox: CheckboxWidget,
  text: TextWidget,
  color: ColorWidget,
  textarea: TextareaWidget,
  switch: CheckboxWidget,
  segmented: SelectWidget,
  seed: NumberWidget,
};
