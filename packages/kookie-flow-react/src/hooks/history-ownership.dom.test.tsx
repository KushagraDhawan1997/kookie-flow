import { afterEach, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useGraph, type UseGraphReturn } from './use-graph';
import { bindHistoryOwner } from '@kushagradhawan/kookie-flow-webgl/internal/hooks/history-owner';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});
function mount(id: string, explicitOwner = false) {
  let api!: UseGraphReturn;
  const host = document.createElement('div');
  host.setAttribute('data-kookie-flow-container', '');
  host.tabIndex = 0;
  document.body.append(host);
  const root = createRoot(host);
  const containerRef = { current: host };
  function Harness() {
    api = useGraph({
      initialEntities: [{ id, type: 'default', position: { x: 0, y: 0 }, data: {} }],
      history: explicitOwner ? { containerRef } : true,
    });
    return <input aria-label="edit" />;
  }
  act(() => root.render(<Harness />));
  const unbind = explicitOwner ? () => {} : bindHistoryOwner(host, () => api.onEntitiesChange);
  cleanups.push(() => {
    unbind();
    act(() => root.unmount());
    host.remove();
  });
  return { get: () => api, host };
}

it('A13: Ctrl+Z affects only the graph that owns keyboard focus', () => {
  const a = mount('a');
  const b = mount('b');
  act(() => a.get().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 10, y: 0 } }]));
  act(() => b.get().onEntitiesChange([{ type: 'position', id: 'b', position: { x: 20, y: 0 } }]));
  a.host.focus();
  act(() =>
    a.host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    )
  );
  expect(a.get().entities[0].position.x).toBe(0);
  expect(b.get().entities[0].position.x).toBe(20);
});

it('an explicit container scopes undo and both redo shortcuts', () => {
  const a = mount('a', true);
  act(() => a.get().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 10, y: 0 } }]));
  a.host.focus();
  const press = (key: string, shiftKey = false) =>
    act(() => {
      a.host.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  press('z');
  expect(a.get().entities[0].position.x).toBe(0);
  press('z', true);
  expect(a.get().entities[0].position.x).toBe(10);
  press('z');
  press('y');
  expect(a.get().entities[0].position.x).toBe(10);
});

it('respects an already-handled shortcut and editable descendants', () => {
  const a = mount('a');
  act(() => a.get().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 10, y: 0 } }]));
  a.host.focus();
  const handled = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  act(() => a.host.dispatchEvent(handled));
  expect(a.get().entities[0].position.x).toBe(10);
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  a.host.append(editor);
  editor.focus();
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => editor.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(a.get().entities[0].position.x).toBe(10);
});

it('A14: text input inside the graph keeps its native undo', () => {
  const a = mount('a');
  act(() => a.get().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 10, y: 0 } }]));
  const input = a.host.querySelector('input')!;
  input.focus();
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => input.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(a.get().entities[0].position.x).toBe(10);
});
