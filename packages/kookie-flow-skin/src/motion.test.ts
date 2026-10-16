import { describe, expect, it } from 'vitest';
import * as glass from './index';
import * as gl from '@kushagradhawan/kookie-flow-webgl/internal/gl/index';

/** What the glass skin and the renderer's GL kit export, together. */
const kit = { ...gl, ...glass };

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true; exhaustive: true }
    ): Record<string, string>;
  }
}

/**
 * v2 removed motion, so the GL controls have none either. A shader cannot read a custom property,
 * so the controls used to keep their own copy of v2's clocks, and that copy drifted the day v2
 * dropped them. This holds both halves to the stylesheet this package is installed against: v2
 * declares no motion, and neither the glass skin nor the GL kit exports any. `exhaustive`, because a glob skips
 * node_modules without it.
 */
const SHEETS = Object.values(
  import.meta.glob('../node_modules/@kushagradhawan/kookie-ui-react/dist/styles.css', {
    query: '?raw',
    import: 'default',
    eager: true,
    exhaustive: true,
  })
);

function sheet(): string {
  if (SHEETS.length !== 1)
    throw new Error(`expected v2's stylesheet once, read ${SHEETS.length} files`);
  return SHEETS[0];
}

describe('motion', () => {
  it('v2 declares no motion tokens', () => {
    expect(sheet().match(/--(motion|press|floating-fall)[\w-]*\s*:/g) ?? []).toEqual([]);
  });

  it('v2 declares no transitions', () => {
    expect(sheet().match(/transition(-[a-z]+)?\s*:/g) ?? []).toEqual([]);
  });

  it('the glass skin and the GL kit export no motion clock', () => {
    const names = Object.keys(kit).filter((name) =>
      /motion|press|ease|spring|transition|settled/i.test(name)
    );
    expect(names).toEqual([]);
  });

  it('the focus ring has no landing travel', () => {
    expect(Object.keys(kit.FOCUS_RING).sort()).toEqual(['offset', 'width']);
  });
});
