/**
 * The accessibility mirror, at the tier that can mount it.
 *
 * WHAT IS BEING PINNED. The seven built-in socket widgets draw in WebGL, where there are no roles,
 * no names and no focusable children — so this file is the only place a socket widget exists as
 * something a screen reader or a keyboard can reach. Two failure modes matter more than the rest
 * and each has its own describe: mounting the WRONG KIND of element (a `role="checkbox"` div
 * instead of a checkbox, which throws away the platform's whole keyboard model), and hiding the
 * elements in a way that removes them from the accessibility tree, which would make the entire
 * exercise ceremonial.
 *
 * jsdom lays nothing out, so the real geometry claim — every mirror element measures a pixel on
 * screen — lives in harness/behaviors.mjs against Chromium. What is real here is which elements
 * mount, what they announce, what a change commits, and that the value sync neither misses a store
 * write nor clobbers the field someone is typing into.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { Profiler, useEffect, type ProfilerOnRenderCallback } from 'react';
import { FlowProvider, useFlowStoreApi } from './context';
import { WidgetA11yMirror } from './widget-a11y-mirror';
import type { Entity, SocketType, WidgetProps } from '../types';
import type { FlowStore as Store } from '../core/store';

const socketTypes: Record<string, SocketType> = {
  boolean: { name: 'Boolean', color: '#000', widget: 'checkbox' },
  float: { name: 'Float', color: '#000', widget: 'slider', min: 0, max: 1, step: 0.01 },
  string: { name: 'String', color: '#000', widget: 'text' },
  int: { name: 'Int', color: '#000', widget: 'number', min: 0, max: 10, step: 1 },
  color: { name: 'Color', color: '#000', widget: 'color' },
  enum: { name: 'Enum', color: '#000', widget: 'select' },
  long: { name: 'Long', color: '#000', widget: 'textarea' },
};

function widgetEntity(values?: Record<string, unknown>): Entity {
  return {
    id: 'w',
    type: 'default',
    position: { x: 0, y: 0 },
    width: 320,
    data: {
      label: 'Widgets',
      values: values ?? {
        flag: false,
        amount: 0.2,
        label: 'name',
        count: 3,
        tint: '#8e4ec6',
        mode: 'one',
        body: 'lines',
      },
    },
    inputs: [
      { id: 'flag', name: 'Flag', type: 'boolean' },
      { id: 'amount', name: 'Amount', type: 'float' },
      { id: 'label', name: 'Label', type: 'string' },
      { id: 'count', name: 'Count', type: 'int' },
      { id: 'tint', name: 'Tint', type: 'color' },
      { id: 'mode', name: 'Mode', type: 'enum', options: ['one', 'two', 'three'] },
      { id: 'body', name: 'Body', type: 'long', rows: 3 },
    ],
  };
}

interface Mounted {
  container: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
  store: Store;
  /** How many times the mirror's subtree has rendered. */
  renders: () => number;
}

function StoreProbe({ onStore }: { onStore: (s: Store) => void }) {
  const store = useFlowStoreApi();
  useEffect(() => onStore(store), [store, onStore]);
  return null;
}

function mount(options?: {
  entityId?: string | null;
  editingSocketId?: string | null;
  entity?: Entity;
  widgetTypes?: Record<string, unknown>;
}): Mounted {
  const onChange = vi.fn();
  let store: Store | null = null;
  let renders = 0;
  const onRender: ProfilerOnRenderCallback = () => {
    renders++;
  };
  const { container } = render(
    <FlowProvider initialState={{ entities: [options?.entity ?? widgetEntity()] }}>
      <StoreProbe onStore={(s) => { store = s; }} />
      <div data-kookie-flow-container="" tabIndex={0}>
        <Profiler id="mirror" onRender={onRender}>
          <WidgetA11yMirror
            entityId={options?.entityId === undefined ? 'w' : options.entityId}
            socketTypes={socketTypes}
            widgetTypes={options?.widgetTypes}
            editingSocketId={options?.editingSocketId ?? null}
            onChange={onChange}
          />
        </Profiler>
      </div>
    </FlowProvider>
  );
  if (!store) throw new Error('the store never reached the test — the provider did not mount');
  return { container, onChange, store, renders: () => renders };
}

const controls = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-a11y-mirror]')];

const bySocket = (container: HTMLElement, socketId: string) => {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[data-socket-id="${socketId}"]`
  );
  if (!el) throw new Error(`no mirror for socket ${socketId}`);
  return el;
};

afterEach(() => {
  cleanup();
});

describe('every widget kind mirrors as the real element', () => {
  it('mounts one control per socket, each the platform control for its kind', () => {
    const { container } = mount();
    // A `role="checkbox"` div, a `role="slider"` div and a hand-rolled listbox would all pass a
    // law that only counted controls. What each of these gives for free — the role, the value
    // semantics, arrow and Home/End handling, type-ahead, the OS colour picker — is the reason
    // the shape is asserted rather than the count.
    expect(controls(container).length).toBe(7);
    expect(bySocket(container, 'flag').tagName).toBe('INPUT');
    expect((bySocket(container, 'flag') as HTMLInputElement).type).toBe('checkbox');
    expect((bySocket(container, 'amount') as HTMLInputElement).type).toBe('range');
    expect((bySocket(container, 'label') as HTMLInputElement).type).toBe('text');
    expect((bySocket(container, 'count') as HTMLInputElement).type).toBe('number');
    expect((bySocket(container, 'tint') as HTMLInputElement).type).toBe('color');
    expect(bySocket(container, 'body').tagName).toBe('TEXTAREA');
    expect(bySocket(container, 'mode').tagName).toBe('SELECT');
  });

  it('gives the range and the number field their own bounds rather than aria attributes', () => {
    const { container } = mount();
    const range = bySocket(container, 'amount') as HTMLInputElement;
    expect([range.min, range.max, range.step]).toEqual(['0', '1', '0.01']);
    // The platform derives valuemin/valuemax/valuenow from these. Nothing here maintains them by
    // hand, which is the failure this repo already has to excuse once, upstream.
    expect(range.getAttribute('aria-valuenow')).toBeNull();
    const number = bySocket(container, 'count') as HTMLInputElement;
    expect([number.min, number.max, number.step]).toEqual(['0', '10', '1']);
  });

  it('gives the select a real option per configured option', () => {
    const { container } = mount();
    const select = bySocket(container, 'mode') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'one', 'two', 'three']);
  });
});

describe('hidden means clipped, never removed from the accessibility tree', () => {
  it('clips every control instead of hiding it', () => {
    const { container } = mount();
    for (const el of controls(container)) {
      // The four wrong fixes, each of which takes the element out of the accessibility tree and
      // so undoes the entire feature.
      expect(getComputedStyle(el).display).not.toBe('none');
      expect(getComputedStyle(el).visibility).not.toBe('hidden');
      expect(el.hasAttribute('hidden')).toBe(false);
      expect(el.closest('[aria-hidden="true"]')).toBeNull();
      // ...and the mechanism that is correct.
      expect(el.style.clipPath).toBe('inset(50%)');
      expect([el.style.width, el.style.height]).toEqual(['1px', '1px']);
    }
  });

  it('keeps the graph to one tab stop', () => {
    const { container } = mount();
    // Every control is reachable programmatically and by a screen reader's own cursor, and none
    // of them is a Tab stop — which is what stops "reach a thousand nodes" meaning "Tab a
    // thousand times".
    for (const el of controls(container)) expect(el.tabIndex).toBe(-1);
  });
});

describe('every control announces the socket a person can see', () => {
  it('names each control from socket.name', () => {
    const { container } = mount();
    expect(controls(container).map((el) => el.getAttribute('aria-label'))).toEqual([
      'Flag',
      'Amount',
      'Label',
      'Count',
      'Tint',
      'Mode',
      'Body',
    ]);
  });

  it('gives the group the entity label and no two controls the same name', () => {
    const { container } = mount();
    const group = container.querySelector('[data-a11y-mirror-group]');
    expect(group?.getAttribute('aria-label')).toBe('Widgets');
    expect(group?.getAttribute('data-entity-id')).toBe('w');
    const names = controls(container).map((el) => el.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });

  it('removes the control under an open borrowed input rather than hiding it', () => {
    // Two controls called "Label" inside one node is the duplicate-name defect the naming law
    // fails on, and `aria-hidden` on a focusable element is its own violation — so the mirror
    // goes away entirely for as long as the real input is there.
    const { container } = mount({ editingSocketId: 'label' });
    expect(container.querySelector('[data-socket-id="label"]')).toBeNull();
    expect(controls(container).length).toBe(6);
  });
});

describe('a keystroke reaches the same path a press does', () => {
  it('sends a boolean for a checkbox', () => {
    const { container, onChange } = mount();
    const el = bySocket(container, 'flag') as HTMLInputElement;
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith('w', 'flag', true);
  });

  it('sends a NUMBER for a range, not the string the DOM holds', () => {
    // The pointer path sends `sliderValueAt(...)`, a number. A mirror sending "0.6" would hand
    // the consumer two different types for one socket depending on how it was operated.
    const { container, onChange } = mount();
    fireEvent.change(bySocket(container, 'amount'), { target: { value: '0.6' } });
    expect(onChange).toHaveBeenCalledWith('w', 'amount', 0.6);
  });

  it('sends a number for a number field, and empty for an emptied one', () => {
    const { container, onChange } = mount();
    fireEvent.change(bySocket(container, 'count'), { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith('w', 'count', 7);
    fireEvent.change(bySocket(container, 'count'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('w', 'count', '');
  });

  it('sends the chosen option for a select and the text for a field', () => {
    const { container, onChange } = mount();
    fireEvent.change(bySocket(container, 'mode'), { target: { value: 'three' } });
    expect(onChange).toHaveBeenLastCalledWith('w', 'mode', 'three');
    fireEvent.change(bySocket(container, 'label'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenLastCalledWith('w', 'label', 'hello');
  });
});

describe('Down and Up move between controls', () => {
  it('moves focus to the next control and wraps at the end', () => {
    const { container } = mount();
    const first = bySocket(container, 'flag');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bySocket(container, 'amount'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    // Wrapping, so holding a key walks the group rather than stopping at an end that looks like
    // every other position.
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(bySocket(container, 'body'));
  });

  it('hands focus back to the canvas on Escape', () => {
    const { container } = mount();
    const el = bySocket(container, 'flag');
    el.focus();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(document.activeElement).toBe(container.querySelector('[data-kookie-flow-container]'));
  });
});

describe('values follow the store without re-rendering', () => {
  it('shows what the widget is showing on mount, including a pending local write', async () => {
    const { container, store } = mount();
    expect((bySocket(container, 'label') as HTMLInputElement).value).toBe('name');
    expect((bySocket(container, 'flag') as HTMLInputElement).checked).toBe(false);
    expect((bySocket(container, 'mode') as HTMLSelectElement).value).toBe('one');
    // `async act` because the sync is microtask-batched behind a pending flag, exactly as
    // CommentsContainer's is — a burst of store writes has to cost one pass, not one per write.
    await act(async () => {
      store.getState().setWidgetValue('w', 'label', 'pending');
    });
    // The same rule the GL layer paints by: a local write wins until the consumer answers.
    expect((bySocket(container, 'label') as HTMLInputElement).value).toBe('pending');
  });

  it('follows a consumer echo, and costs no render of the mirror to do it', async () => {
    const { container, store, renders } = mount();
    const before = renders();
    const echoed = { ...(widgetEntity().data.values as Record<string, unknown>), label: 'echoed', flag: true };
    await act(async () => {
      store.getState().setEntities([widgetEntity(echoed)]);
    });
    expect((bySocket(container, 'label') as HTMLInputElement).value).toBe('echoed');
    expect((bySocket(container, 'flag') as HTMLInputElement).checked).toBe(true);
    // The element SET did not change, so nothing re-rendered — the split this component exists
    // to keep. A mirror that re-rendered here would tear down the input being typed into on
    // every echoed keystroke.
    expect(renders()).toBe(before);
  });

  it('does not write over the field that has focus', async () => {
    // Assigning `.value` to a focused text field moves the caret to the end, so a consumer that
    // echoes each keystroke back would reverse-type whatever anyone entered — the same class of
    // defect as the borrowed input's "only the last character survived".
    const { container, store } = mount();
    const el = bySocket(container, 'label') as HTMLInputElement;
    el.focus();
    el.value = 'half-typed';
    await act(async () => {
      store.getState().setWidgetValue('w', 'label', 'other');
    });
    expect(el.value).toBe('half-typed');
  });
});

describe('the mirror exists only where it is bounded to', () => {
  it('renders no group and no control when the cursor is nowhere', () => {
    const { container } = mount({ entityId: null });
    expect(container.querySelector('[data-a11y-mirror-group]')).toBeNull();
    expect(controls(container).length).toBe(0);
  });

  it('renders nothing for an id the graph does not hold', () => {
    const { container } = mount({ entityId: 'gone' });
    expect(controls(container).length).toBe(0);
  });

  it('leaves a socket alone when the consumer already mounts a DOM control for it', () => {
    function Stub(_: WidgetProps) {
      return null;
    }
    const { container } = mount({ widgetTypes: { text: Stub } });
    // widgets-layer.tsx already mounts a named control for the text socket. Two would collide.
    expect(container.querySelector('[data-socket-id="label"]')).toBeNull();
    expect(controls(container).length).toBe(6);
  });
});
