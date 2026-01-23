/**
 * Built-in Checkbox Widget for socket inputs.
 * Uses Kookie UI Checkbox at size 2.
 */

import { useCallback } from 'react';
import { Checkbox, Text, Flex } from '@kushagradhawan/kookie-ui';
import type { WidgetProps } from '../../types';

export function CheckboxWidget({ value, onChange, disabled }: WidgetProps) {
  const checked = Boolean(value);

  const handleCheckedChange = useCallback(
    (newChecked: boolean) => {
      onChange(newChecked);
    },
    [onChange]
  );

  return (
    <Flex align="center" gap="2" style={{ flex: 1 }}>
      <Checkbox
        size="2"
        variant="soft"
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
      />
      <Text size="2" color="gray">
        {checked ? 'True' : 'False'}
      </Text>
    </Flex>
  );
}
