'use client';

import { Theme } from '@kushagradhawan/kookie-ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme
      accentColor="gray"
      grayColor="auto"
      material="solid"
      radius="small"
      fontFamily="sans"
      appearance="dark"
    >
      {children}
    </Theme>
  );
}
