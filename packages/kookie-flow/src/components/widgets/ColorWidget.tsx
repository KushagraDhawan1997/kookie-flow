/**
 * Built-in Color Picker Widget for socket inputs.
 * Uses native color input wrapped for consistent styling.
 */

import { useCallback } from 'react';
import { Flex } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

export function ColorWidget({ label, value, onChange, disabled }: WidgetProps) {
  const colorValue = typeof value === 'string' ? value : '#000000';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // gap 3, not v1's 2: v2's space palette gained two fine rungs at its bottom, so every index
  // shifted one place — v1's `--space-2` is 8px, v2's is 4px, and 8px is `--space-3` here. Same
  // rendered distance, different rung. CheckboxWidget's identical row carries the same correction.
  return (
    <Flex align="center" gap="3" style={{ flex: 1, alignSelf: 'center' }}>
      <input
        aria-label={label}
        type="color"
        value={colorValue}
        onChange={handleChange}
        disabled={disabled}
        style={{
          width: '32px',
          height: '32px',
          padding: 0,
          border: 'none',
          // Semantic band, not a numeric palette step. `--radius-2` is whatever the theme's
          // radius level makes it, and v2's DEFAULT level is `full`, where it resolves to
          // 9999px — a silent circle. The MARK band is the one this swatch belongs to: a
          // fixed-size square that is its own mark, off the control height ladder. It is
          // density-invariant and holds at `large` under `full`, so it never capsules; the
          // control band would (it states `control-height / 2` there, i.e. a circle again).
          // v1's `--radius-2` stays as the fallback arm for a v1 theme.
          borderRadius: 'var(--radius-mark-2, var(--radius-2, 4px))',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-1)',
          color: 'var(--neutral-11, var(--gray-11, #6b6b6b))',
        }}
      >
        {colorValue}
      </span>
    </Flex>
  );
}
