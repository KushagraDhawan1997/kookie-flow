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

import type { WidgetType, WidgetProps } from '../../types';
import { SliderWidget } from './SliderWidget';
import { NumberWidget } from './NumberWidget';
import { SelectWidget } from './SelectWidget';
import { CheckboxWidget } from './CheckboxWidget';
import { TextWidget } from './TextWidget';
import { ColorWidget } from './ColorWidget';

/**
 * Map of built-in widget types to their components.
 * Custom widgets can be added via the `widgetTypes` prop on KookieFlow.
 */
export const BUILT_IN_WIDGETS: Record<WidgetType, React.ComponentType<WidgetProps>> = {
  slider: SliderWidget,
  number: NumberWidget,
  select: SelectWidget,
  checkbox: CheckboxWidget,
  text: TextWidget,
  color: ColorWidget,
};
