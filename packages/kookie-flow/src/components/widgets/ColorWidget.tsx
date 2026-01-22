/**
 * Built-in Color Picker Widget for socket inputs.
 * Uses native color input wrapped for consistent styling.
 */

import { useCallback } from 'react';
import { Flex } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function ColorWidget({ value, onChange, disabled }: WidgetProps) {
  const colorValue = typeof value === 'string' ? value : '#000000';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <Flex align="center" gap="2" style={{ flex: 1 }}>
      <input
        type="color"
        value={colorValue}
        onChange={handleChange}
        disabled={disabled}
        style={{
          width: '32px',
          height: '32px',
          padding: 0,
          border: 'none',
          borderRadius: 'var(--radius-2)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-1)',
          color: 'var(--gray-11)',
        }}
      >
        {colorValue}
      </span>
    </Flex>
  );
}
