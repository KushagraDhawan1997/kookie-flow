/**
 * Built-in Slider Widget for socket inputs.
 * Uses Kookie UI Slider at size 2 (32px height).
 */

import { useCallback, useMemo } from 'react';
import { Box, Slider } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

export function SliderWidget({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max = 1,
  step,
}: WidgetProps) {
  // Ensure value is a number
  const numValue = typeof value === 'number' ? value : min;

  // Convert to array for Kookie UI Slider
  const sliderValue = useMemo(() => [numValue], [numValue]);

  const handleValueChange = useCallback(
    // The primitive types this as `number | readonly number[]` — it renders one thumb per array
    // entry, and we always hand it one. Narrowed here so the widget's own contract stays a number.
    (values: number | readonly number[]) => {
      onChange(typeof values === 'number' ? values : values[0]);
    },
    [onChange]
  );

  return (
    <Box width="100%" style={{ flex: 1, alignSelf: 'center' }}>
      <Slider
        aria-label={label}
        size="2"
        value={sliderValue}
        onValueChange={handleValueChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={{ width: '100%' }}
      />
    </Box>
  );
}
