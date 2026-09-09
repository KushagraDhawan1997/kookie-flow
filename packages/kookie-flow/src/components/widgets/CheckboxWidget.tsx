/**
 * Built-in Checkbox Widget for socket inputs.
 * Uses Kookie UI Checkbox at size 2.
 */

import { useCallback } from 'react';
import { Checkbox, Text, Flex } from '@kookie-ui/react';
import type { WidgetProps } from '../../types';

export function CheckboxWidget({ label, value, onChange, disabled }: WidgetProps) {
  const checked = Boolean(value);

  const handleCheckedChange = useCallback(
    (newChecked: boolean) => {
      onChange(newChecked);
    },
    [onChange]
  );

  // gap 3, not v1's 2: the space palette gained two fine rungs at its bottom in v2, so every
  // index shifted one place. v1's `--space-2` is 8px and v2's is 4px; 8px is `--space-3` here.
  // Same rendered distance, different rung. The type ramp did NOT shift (12/14/16 at 1/2/3 in
  // both), so the `size="2"` on the Text below is still 14px and needs no such correction.
  return (
    <Flex align="center" gap="3" style={{ flex: 1, alignSelf: 'center' }}>
      {/*
        No `variant`: a checkbox in v2 has one designed appearance — neutral off, accent on —
        and that identity is the component's, not the call site's.
      */}
      <Checkbox
        aria-label={label}
        size="2"
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
      />
      {/*
        The value read-out is secondary to the control it describes, so it takes the muted ink
        role. v2 has no `color`: an ink is picked by rank (`emphasis`), and the family — here
        none, so it reads the surface's own foreground — by `tone`.
      */}
      <Text size="2" emphasis="medium">
        {checked ? 'True' : 'False'}
      </Text>
    </Flex>
  );
}
