import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WidgetsLayer } from './widgets-layer';
import { createFlowStore } from '../core/store';
import type { Entity, WidgetProps } from '../types';

const probe = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('./context', () => ({ useFlowStoreApi: () => probe.store }));
let store: ReturnType<typeof createFlowStore>;
afterEach(() => { cleanup(); store?.getState().disposeEvaluation(); });
function Control({ value, onChange, label, placeholder, options }: WidgetProps) {
  return <input aria-label={label} value={String(value ?? '')} placeholder={placeholder}
    data-options={JSON.stringify(options)} onChange={(event) => onChange(event.target.value)} />;
}
const types = { text: Control };
function mount() {
  const entity: Entity = { id: 'n', type: 'default', position: { x: 0, y: 0 },
    data: { values: { text: 'initial' } }, inputs: [{ id: 'text', name: 'Text', type: 'string', widget: 'text' }] };
  store = createFlowStore({ entities: [entity] });
  probe.store = store;
  render(<WidgetsLayer socketTypes={{}} widgetTypes={types} />);
  return screen.getByLabelText('Text', { selector: 'input' }) as HTMLInputElement;
}
function external(value: string, direct = false) {
  const e = store.getState().entities[0];
  act(() => {
    const data = { ...e.data, values: { text: value } };
    if (direct) store.getState().applyEntityChanges([{ id: 'n', type: 'data', data }]);
    else store.getState().setEntities([{ ...e, data }]);
  });
}
it('custom widgets follow store data changes without a controlled-prop round trip', () => {
  const input = mount();
  external('external', true);
  expect(input.value).toBe('external');
});
it('a corrected consumer response retires a custom widget edit', () => {
  const input = mount();
  fireEvent.change(input, { target: { value: 'unvalidated' } });
  expect(input.value).toBe('unvalidated');
  external('corrected');
  expect(input.value).toBe('corrected');
  external('undo');
  expect(input.value).toBe('undo');
});
it('custom widgets receive changed configuration and defaults', () => {
  const input = mount();
  const e = store.getState().entities[0];
  act(() => store.getState().setEntities([{ ...e, data: {}, inputs: [{ ...e.inputs![0],
    placeholder: 'Choose', options: ['a', 'b'], defaultValue: 'a' }] }]));
  expect(input.value).toBe('a');
  act(() => {
    const current = store.getState().entities[0];
    store.getState().setEntities([{ ...current, inputs: [{ ...current.inputs![0],
      placeholder: 'Choose again', options: ['c', 'd'], defaultValue: 'c' }] }]);
  });
  expect(input.value).toBe('c');
  expect(input.placeholder).toBe('Choose again');
  expect(input.dataset.options).toBe('["c","d"]');
});
