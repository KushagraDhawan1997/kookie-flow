/**
 * Built-in Slider Widget for socket inputs.
 * Uses Kookie UI Slider at size 2 (32px height).
 */

import { useCallback, useMemo } from 'react';
import { Box, Slider } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function SliderWidget({
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
    (values: number[]) => {
      onChange(values[0]);
    },
    [onChange]
  );

  return (
    <Box width="100%" style={{ flex: 1 }}>
      <Slider
        size="2"
        variant="soft"
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
