/**
 * Built-in Textarea Widget for multi-line text input.
 * Uses Kookie UI TextArea component.
 */

import { useCallback } from 'react';
import { TextArea } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function TextareaWidget({
  value,
  onChange,
  disabled,
  placeholder,
  rows = 1,
}: WidgetProps) {
  const strValue = value !== undefined ? String(value) : '';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // Wrapper with alignSelf: stretch overrides parent's alignItems: center
  return (
    <div style={{ alignSelf: 'stretch', width: '100%', height: '100%' }}>
      <TextArea
        size="2"
        variant="soft"
        value={strValue}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder ?? 'Enter text...'}
        rows={rows}
        style={{ width: '100%', height: '100%', resize: 'none' }}
      />
    </div>
  );
}
