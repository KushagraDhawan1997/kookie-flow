/**
 * A select opens a LIST, and the list is a real `<select>`.
 *
 * WHAT THIS REPLACED, AND WHY IT NEEDED REPLACING. A press on a select used to advance to the next
 * option and wrap — `options[(current + 1) % options.length]`. Choosing the fourth of five took
 * four presses, and at no point were the five options on screen: the GL layer draws a well, a
 * chevron and the current option, and nothing else. The fix borrows the platform's own list through
 * this overlay, which already positions itself on the widget's world box and follows the viewport.
 *
 * jsdom cannot open a native popup, so nothing here asserts that a list appeared — that claim lives
 * in harness/behaviors.mjs against real Chromium. What IS real in this tier is every rule around the
 * list: which element mounts, whether it took focus, which value it shows, what a change commits,
 * and — the rule with the most ways to get it wrong — WHEN the edit ends, since a select fires
 * `change` for arrow keys and type-ahead as well as for a pick.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { FlowProvider } from './context';
import { WidgetEditOverlay } from './widget-edit-overlay';
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

const selectConfig: ResolvedWidgetConfig = { type: 'select', options: ['a', 'b', 'c'] };

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

function selectIn(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector('select');
  if (!el) throw new Error('no <select> mounted — the overlay chose a different element');
  return el;
}

afterEach(() => {
  cleanup();
});

describe('a select widget borrows a real list', () => {
  it('mounts a select carrying every option in order, and focuses it', () => {
    const { container } = mount(hitFor(selectConfig, 'b'));
    const el = selectIn(container);

    expect(container.querySelector('input')).toBeNull();
    expect([...el.options].map((o) => o.value)).toEqual(['a', 'b', 'c']);
    // The focus claim the layout effect exists to keep. It silently failed once already, when the
    // style was set from a passive effect and the element was still `display: none` when focus was
    // asked for — the field mounted, looked right and swallowed every keystroke.
    expect(document.activeElement).toBe(el);
  });

  it('shows the value the press snapshotted', () => {
    const { container } = mount(hitFor(selectConfig, 'b'));
    expect(selectIn(container).value).toBe('b');
  });

  it('commits a pick and ends the edit', () => {
    const { container, onChange, onClose } = mount(hitFor(selectConfig, 'a'));
    fireEvent.change(selectIn(container), { target: { value: 'c' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('n1', 'in-1', 'c');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a select stays open while it is being navigated', () => {
  it('commits an arrowed change without ending the edit, and closes on the next pick', () => {
    const { container, onChange, onClose } = mount(hitFor(selectConfig, 'a'));
    const el = selectIn(container);

    // Arrows on a closed select move the value and fire `change`. Closing on that would end the
    // edit on the first arrow press, which is the opposite of choosing.
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.change(el, { target: { value: 'b' } });
    expect(onChange).toHaveBeenLastCalledWith('n1', 'in-1', 'b');
    expect(onClose).not.toHaveBeenCalled();

    // A change with no key in front of it came from the list.
    fireEvent.change(el, { target: { value: 'c' } });
    expect(onChange).toHaveBeenLastCalledWith('n1', 'in-1', 'c');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not let a key that moved nothing swallow the next pick', () => {
    const { container, onClose } = mount(hitFor(selectConfig, 'a'));
    const el = selectIn(container);

    // Type-ahead for a letter no option starts with: a keydown, and no change at all. Arming the
    // flag on keydown alone leaves it standing, and the pick that follows then fails to close.
    fireEvent.keyDown(el, { key: 'z' });
    fireEvent.keyUp(el, { key: 'z' });
    fireEvent.change(el, { target: { value: 'c' } });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Enter and on Escape, and lets neither reach the canvas', () => {
    const escape = mount(hitFor(selectConfig, 'a'));
    fireEvent.keyDown(selectIn(escape.container), { key: 'Escape' });
    expect(escape.onClose).toHaveBeenCalledTimes(1);
    expect(escape.onChange).not.toHaveBeenCalled();
    // The failure this guards is a stray Delete reaching the graph and removing the node being
    // edited; Escape is the same path and the one a test can drive without side effects.
    expect(escape.ancestorKeys).not.toHaveBeenCalled();
    cleanup();

    const enter = mount(hitFor(selectConfig, 'a'));
    fireEvent.keyDown(selectIn(enter.container), { key: 'Enter' });
    expect(enter.onClose).toHaveBeenCalledTimes(1);
    expect(enter.ancestorKeys).not.toHaveBeenCalled();
  });
});

describe('a value the option list no longer offers', () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it('is shown as its own unselectable row rather than becoming option zero', () => {
    const { container } = mount(hitFor(selectConfig, 'gone'));
    const el = selectIn(container);

    expect(el.value).toBe('');
    const first = el.options[0];
    expect(first.textContent).toBe('gone');
    expect(first.disabled).toBe(true);
    expect(first.hidden).toBe(true);
    expect([...el.options].map((o) => o.value)).toEqual(['', 'a', 'b', 'c']);
    // React warns on a controlled select whose value matches nothing, and a control that silently
    // read back as 'a' would be lying about what the socket holds.
    expect(errors).not.toHaveBeenCalled();
  });

  it('labels an empty value the way the GL layer labels it', () => {
    const { container } = mount(
      hitFor({ type: 'select', options: ['a', 'b'], placeholder: 'Pick one' }, '')
    );
    // widget-text.ts prints the placeholder for a select with no chosen option, so opening the
    // edit must not change the words already on screen.
    expect(selectIn(container).options[0].textContent).toBe('Pick one');
  });
});

describe('opening the platform picker is feature-detected, not assumed', () => {
  const proto = HTMLSelectElement.prototype as unknown as { showPicker?: () => void };

  afterEach(() => {
    delete proto.showPicker;
  });

  it('mounts and focuses where the platform has no showPicker at all', () => {
    // Vacuity guard: if jsdom ever grows one, this test stops testing the fallback and should be
    // rewritten rather than left green.
    expect(typeof proto.showPicker).toBe('undefined');
    const { container } = mount(hitFor(selectConfig, 'a'));
    expect(document.activeElement).toBe(selectIn(container));
  });

  it('calls showPicker exactly once when the platform has one', () => {
    const picker = vi.fn();
    proto.showPicker = picker;
    mount(hitFor(selectConfig, 'a'));
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('survives the NotAllowedError a lapsed activation throws', () => {
    proto.showPicker = () => {
      throw new DOMException('not allowed', 'NotAllowedError');
    };
    const { container } = mount(hitFor(selectConfig, 'a'));
    expect(selectIn(container).value).toBe('a');
  });

  it('does not swallow a failure that is not the platform refusing', () => {
    proto.showPicker = () => {
      throw new Error('a real bug in this file');
    };
    // Without this the catch is a blanket swallow and every future mistake inside it is invisible.
    expect(() => mount(hitFor(selectConfig, 'a'))).toThrow('a real bug in this file');
  });
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
