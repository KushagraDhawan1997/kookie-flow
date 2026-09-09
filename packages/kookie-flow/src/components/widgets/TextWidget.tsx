/**
 * Built-in Text Input Widget for socket inputs.
 * Uses Kookie UI TextField at size 2 (32px height).
 */

import { useCallback } from 'react';
import { TextField } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

export function TextWidget({
  label,
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
    // No `variant`: v2 gives the field family one resting dress (fill plus a supplementing
    // edge), so there is nothing for `soft` to select — construction is a theme identity now,
    // not a per-field choice.
    //
    // `spellCheck` is stated because v1's TextField.Root hardcoded `spellCheck="false"` on its
    // own <input> and v2 states nothing, leaving the browser's default on. Socket values are
    // identifiers, paths and prompts, not prose; without this they gain red squiggles v1 never
    // drew.
    //
    // `style` lands on the WRAPPER, which is the element that IS the control — so `flex: 1`
    // still sizes the field inside the widget row rather than the text inside the field.
    <TextField
      aria-label={label}
      size="2"
      value={strValue}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder ?? 'Enter text...'}
      spellCheck={false}
      style={{ flex: 1, alignSelf: 'center' }}
    />
  );
}
