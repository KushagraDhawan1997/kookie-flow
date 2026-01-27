'use client';

import { Theme } from '@kushagradhawan/kookie-ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Theme
      accentColor="iris"
      grayColor="auto"
      material="solid"
      radius="full"
      fontFamily="sans"
      appearance="light"
    >
      {children}
    </Theme>
  );
}
