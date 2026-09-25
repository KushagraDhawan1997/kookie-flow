'use client';

import * as React from 'react';
import { Button } from '@kushagradhawan/kookie-ui-react';
import { PlusIcon } from './icons';

/** The box's "+": pictures only, since a picture is what the agent can wire into a model. */
export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button iconOnly emphasis="medium" aria-label="Attach pictures" onClick={() => input.current?.click()}>
        <PlusIcon />
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </>
  );
}

