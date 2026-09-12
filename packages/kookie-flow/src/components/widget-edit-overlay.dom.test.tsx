/**
 * The borrowed text input: what mounts, what it shows, what it commits, and when it lets go.
 *
 * A select and a colour widget used to be here too, borrowing a `<select>` and an
 * `<input type="color">`. Both are GL panels now (widget-popover.tsx), driven from the canvas's
 * own pointer and keyboard handlers, so nothing in this file mentions them except to pin that
 * they never reach the overlay.
 *
 * jsdom cannot paint, so nothing here asserts a pixel — the pixel half of every claim lives in
 * harness/behaviors.mjs against real Chromium. What IS real in this tier is every rule around the
 * input: which element mounts, whether it took focus, which value it shows, what a keystroke
 * commits, and when the edit ends.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { FlowProvider } from './context';
import { WidgetEditOverlay } from './widget-edit-overlay';
import { PAD, WIDGET_RADIUS } from '../utils/widget-text';
import type { WidgetHit } from '../utils/widget-hit';
import type { ResolvedWidgetConfig } from '../types';

function hitFor(config: ResolvedWidgetConfig, value: unknown): WidgetHit {
  return {
    entityId: 'n1',
    socketId: 'in-1',
    socketName: 'Input one',
    index: 0,
    box: { x: 10, y: 20, width: 120, height: 32 },
    config,
    value,
  };
}

interface Mounted {
  onChange: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  /** A React ancestor of the overlay, so a key that escapes the input is observable. */
  ancestorKeys: ReturnType<typeof vi.fn>;
  container: HTMLElement;
}

function mount(hit: WidgetHit): Mounted {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const ancestorKeys = vi.fn();
  const { container } = render(
    <FlowProvider>
      <div onKeyDown={ancestorKeys}>
        <WidgetEditOverlay hit={hit} onChange={onChange} onClose={onClose} />
      </div>
    </FlowProvider>
  );
  return { onChange, onClose, ancestorKeys, container };
}

afterEach(() => {
  cleanup();
});

describe('the other widget kinds are unchanged', () => {
  it('still borrows an input for text and a textarea for textarea', () => {
    const text = mount(hitFor({ type: 'text' }, 'hello'));
    const input = text.container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('hello');
    expect(text.container.querySelector('select')).toBeNull();
    if (input) {
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(text.onClose).toHaveBeenCalledTimes(1);
    }
    cleanup();

    const area = mount(hitFor({ type: 'textarea' }, 'a\nb'));
    const textarea = area.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    if (textarea) {
      // Enter is a newline in a textarea, not a commit — the one kind that keeps the key.
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(area.onClose).not.toHaveBeenCalled();
    }
  });
});

/**
 * ONE PAINTER. GL draws the well, the hairline, the shade and the focus ring; the borrowed element
 * contributes glyphs, a caret and the platform's list, and paints nothing of its own. These pin the
 * style rather than a screenshot because the defect they close was a style: `font: inherit`
 * resolving to the UA serif, a 4px radius under an 8px well, and `border 1px + padding 6px` putting
 * the glyph one pixel right of where the MSDF layer had it. The pixel half of the claim — the
 * glyph bounds moving by no more than half a pixel — is measured in the browser, not here.
 */
describe('the borrowed element is transparent and sits where the glyphs were', () => {
  const styleOf = (el: HTMLElement) => el.style;

  it('paints no well, no hairline and no ring of its own, for a field', () => {
    const { container } = mount(hitFor({ type: 'text' }, 'hello'));
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    if (!input) return;
    const st = styleOf(input);
    expect(st.background).toBe('transparent');
    expect(st.borderWidth === '0px' || st.border === '0px' || st.border === '0').toBe(true);
    expect(st.boxShadow).toBe('none');
    expect(st.outline).toBe('none');
  });

  it('takes the same inset the value was printed at, with no border to add to it', () => {
    const { container } = mount(hitFor({ type: 'text' }, 'hello'));
    const input = container.querySelector('input');
    if (!input) throw new Error('no input');
    expect(input.style.paddingLeft).toBe(`${PAD}px`);
    expect(input.style.paddingRight).toBe(`${PAD}px`);
    expect(input.style.borderRadius).toBe(`${WIDGET_RADIUS}px`);
    expect(input.style.boxSizing).toBe('border-box');
  });

  it('leads with the atlas face and never inherits the canvas container\'s font', () => {
    const { container } = mount(hitFor({ type: 'text' }, 'hello'));
    const input = container.querySelector('input');
    if (!input) throw new Error('no input');
    // jsdom has no Theme and no --font-body, which is exactly the bare page the defect showed:
    // the family must still be stated, and must not be 'inherit'.
    expect(input.style.fontFamily.startsWith('"Inter"')).toBe(true);
    expect(input.style.fontFamily).not.toContain('inherit');
    // The size's own type step, as v2 prices a control's text: 14px at size 2.
    expect(input.style.fontSize).toBe('14px');
  });

  it('hides a number input\'s stepper through one injected rule, keyed on its own attribute', () => {
    const { container } = mount(hitFor({ type: 'number' }, 3));
    const input = container.querySelector('input[type="number"]');
    if (!input) throw new Error('no number input');
    expect(input.hasAttribute('data-kookie-flow-widget-edit')).toBe(true);
    const sheets = document.querySelectorAll('#kookie-flow-widget-edit-style');
    expect(sheets.length).toBe(1);
    expect(sheets[0].textContent).toContain('[data-kookie-flow-widget-edit]::-webkit-inner-spin-button');
    // A second mount does not add a second sheet.
    cleanup();
    mount(hitFor({ type: 'number' }, 4));
    expect(document.querySelectorAll('#kookie-flow-widget-edit-style').length).toBe(1);
  });
});
