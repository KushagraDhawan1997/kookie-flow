/**
 * Built-in Text Input Widget for socket inputs.
 * Uses Kookie UI TextField at size 2 (32px height).
 */

import { useCallback } from 'react';
import { TextField } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function TextWidget({
  value,
  onChange,
  disabled,
  placeholder,
}: WidgetProps) {
  const strValue = value !== undefined ? String(value) : '';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <TextField.Root
      size="2"
      variant="soft"
      value={strValue}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder ?? 'Enter text...'}
      style={{ flex: 1, alignSelf: 'center' }}
    />
  );
}
