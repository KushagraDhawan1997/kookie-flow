/**
 * Built-in Textarea Widget for multi-line text input.
 * Uses Kookie UI TextArea component.
 */

import { useCallback } from 'react';
import { TextArea } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

export function TextareaWidget({
  label,
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

  // Wrapper with alignSelf: stretch overrides parent's alignItems: center.
  // `display: flex` is not decoration: v2's TextArea box is `inline-flex`, so as the only child
  // of a block it would sit on a line box and pick up the strut's descender below its 100%
  // height — overflowing the socket slot the layer measures. As a flex item it is blockified.
  return (
    <div style={{ alignSelf: 'stretch', display: 'flex', width: '100%', height: '100%' }}>
      <TextArea
        aria-label={label}
        size="2"
        value={strValue}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder ?? 'Enter text...'}
        rows={rows}
        // `style` lands on the WRAPPER, which is the element that IS the control in v2 — so the
        // box is what fills the socket's measured slot, and the bare inner <textarea> fills the
        // wrapper by the field family's own `flex: 1 1 auto` + `align-items: stretch`.
        // `resize: none` still reaches the handle: the inner element takes `resize: inherit`.
        style={{ width: '100%', height: '100%', resize: 'none' }}
      />
    </div>
  );
}
