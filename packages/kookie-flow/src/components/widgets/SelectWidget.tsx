/**
 * Built-in Select Widget for socket inputs.
 * Uses Kookie UI Select at size 2 (32px height).
 */

import { useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';
import { optionLabel } from '../../utils/widget-parts';

const EMPTY_OPTIONS: string[] = [];

export function SelectWidget({
  label,
  value,
  onChange,
  disabled,
  options = EMPTY_OPTIONS,
  optionLabels,
  placeholder,
}: WidgetProps) {
  // '' is how this widget spells "nothing chosen", and Base UI agrees: an empty serialized value
  // is not a selection, so the trigger shows the placeholder rather than an empty label.
  const strValue = value !== undefined ? String(value) : '';

  const handleValueChange = useCallback(
    (newValue: string | null) => {
      // `null` arrives when the mounted option set no longer contains the current value — a
      // consumer swapping `options` out from under a chosen one. Reporting it as '' keeps the
      // stored value in step with what the trigger now shows, and round-trips without tripping
      // the wrapper's mid-edit guard the way `undefined` would (it would fall back to the
      // socket's defaultValue and re-select).
      onChange(newValue ?? '');
    },
    [onChange]
  );

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
      <Select
        size="2"
        value={strValue}
        onValueChange={handleValueChange}
        disabled={disabled}
        // Base UI paints the closed trigger from `items` alone. Without labels an option's value
        // is already the right words, so no map is passed.
        items={optionLabels}
      >
        <SelectTrigger
          aria-label={label}
          placeholder={placeholder ?? 'Select...'}
          style={{ flex: 1 }}
        />
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(optionLabels, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
