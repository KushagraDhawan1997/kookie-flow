/**
 * Built-in Number Input Widget for socket inputs.
 * Uses Kookie UI TextField at size 2 (32px height).
 */

import { useCallback, useState, useEffect } from 'react';
import { TextField } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function NumberWidget({
  value,
  onChange,
  disabled,
  min,
  max,
  step = 1,
  placeholder,
}: WidgetProps) {
  // Track local string value for editing
  const [localValue, setLocalValue] = useState(() => (value !== undefined ? String(value) : ''));

  // Sync local value with prop changes
  useEffect(() => {
    setLocalValue(value !== undefined ? String(value) : '');
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Parse and validate
      const numValue = parseFloat(newValue);
      if (!isNaN(numValue)) {
        let clampedValue = numValue;
        if (min !== undefined) clampedValue = Math.max(min, clampedValue);
        if (max !== undefined) clampedValue = Math.min(max, clampedValue);

        // Apply step rounding if specified
        if (step !== undefined && step > 0) {
          clampedValue = Math.round(clampedValue / step) * step;
        }

        onChange(clampedValue);
      }
    },
    [onChange, min, max, step]
  );

  const handleBlur = useCallback(() => {
    // On blur, ensure local value reflects the actual value
    setLocalValue(value !== undefined ? String(value) : '');
  }, [value]);

  return (
    <TextField.Root
      size="2"
      variant="soft"
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder ?? 'Enter number...'}
      style={{ flex: 1 }}
    />
  );
}
