/**
 * Built-in Number Input Widget for socket inputs.
 * Uses Kookie UI TextField at size 2 (32px height).
 */

import { useCallback, useState, useEffect, useInsertionEffect } from 'react';
import { TextField } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

/**
 * v1's text-field.css hid the native number stepper — `-moz-appearance: textfield` on the input
 * plus `::-webkit-inner-spin-button { appearance: none }` — "because it's small, ugly, hard to
 * use" (its words). v2's stylesheet carries no such rule anywhere: its `appearance: none` sits on
 * the input host, which does not reach the spinner, since that is a shadow pseudo-element. Left
 * alone, the swap grows arrows on hover and focus inside a 32px socket field that has no room for
 * them, in every browser, where v1 drew none.
 *
 * Injected rather than passed as a prop because a pseudo-element is unreachable from `style`, and
 * this package ships no stylesheet of its own. Scoped to this widget's class so it cannot reach a
 * consumer's own number inputs. The right long-term home is v2's own text-field.css, at which
 * point this whole block deletes.
 */
const SPINNER_CLASS = 'kookie-flow-number-widget';
const SPINNER_STYLE_ID = 'kookie-flow-number-widget-style';
const SPINNER_CSS = `
.${SPINNER_CLASS} input[type='number'] { -moz-appearance: textfield; }
.${SPINNER_CLASS} input[type='number']::-webkit-inner-spin-button,
.${SPINNER_CLASS} input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}
`;

function useHiddenNumberStepper() {
  // useInsertionEffect, not useEffect: the rule must land before layout is read, and this is the
  // hook React provides for exactly that. Per instance it is one getElementById after the first
  // widget mounts, so a graph of number sockets pays for the sheet once.
  useInsertionEffect(() => {
    if (document.getElementById(SPINNER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SPINNER_STYLE_ID;
    style.textContent = SPINNER_CSS;
    document.head.appendChild(style);
  }, []);
}

export function NumberWidget({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step = 1,
  placeholder,
}: WidgetProps) {
  useHiddenNumberStepper();

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
    // No `variant`: v2 gives the field family one resting dress (fill plus a supplementing
    // edge), so there is nothing for `soft` to select — construction is a theme identity now,
    // not a per-field choice.
    //
    // `className` and `style` both land on the WRAPPER, which is the element that IS the control
    // in v2 — the same element v1's TextField.Root was — so `flex: 1` still sizes the field in
    // the socket row rather than the text inside it.
    <TextField
      aria-label={label}
      className={SPINNER_CLASS}
      size="2"
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder ?? 'Enter number...'}
      style={{ flex: 1, alignSelf: 'center' }}
    />
  );
}
