/**
 * Built-in Select Widget for socket inputs.
 * Uses Kookie UI Select at size 2 (32px height).
 */

import { useCallback } from 'react';
import { Select } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function SelectWidget({
  value,
  onChange,
  disabled,
  options = [],
  placeholder,
}: WidgetProps) {
  const strValue = value !== undefined ? String(value) : '';

  const handleValueChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange]
  );

  return (
    <Select.Root
      size="2"
      value={strValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <Select.Trigger
        placeholder={placeholder ?? 'Select...'}
        style={{ flex: 1 }}
      />
      <Select.Content>
        {options.map((option) => (
          <Select.Item key={option} value={option}>
            {option}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
