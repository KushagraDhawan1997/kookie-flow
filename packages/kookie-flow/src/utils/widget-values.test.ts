import { describe, it, expect } from 'vitest';
import { readWidgetValue, widgetKey, type WidgetOverride } from './widget-values';

/**
 * The GL widgets have no component to keep a `useState` in, so the DOM layer's "local, but
 * follows an external write unless you are mid-edit" rule lives in a map and a function. These
 * are that rule's cases, each one a behaviour the DOM layer documented and this must keep.
 */
describe('readWidgetValue', () => {
  const k = widgetKey('n1', 'in-0');
  const map = (value: unknown, baseline: unknown) =>
    new Map<string, WidgetOverride>([[k, { value, baseline }]]);

  it('shows the entity value when the person has not touched the widget', () => {
    expect(readWidgetValue(new Map(), k, 0.25)).toBe(0.25);
  });

  it('shows what the person set while the consumer has not echoed it yet', () => {
    // A slider dragged to 0.8 in a consumer that debounces: the entity still says 0.25.
    const local = map(0.8, 0.25);
    expect(readWidgetValue(local, k, 0.25)).toBe(0.8);
    expect(local.has(k)).toBe(true);
  });

  it('retires the local value the moment it round-trips, so external writes win again', () => {
    const local = map(0.8, 0.25);
    expect(readWidgetValue(local, k, 0.8)).toBe(0.8);
    expect(local.has(k)).toBe(false);
    // An undo now reaches the widget.
    expect(readWidgetValue(local, k, 0.25)).toBe(0.25);
  });

  it('retires when the consumer answers with a CLAMPED value, not only an identical one', () => {
    // THE CASE THE BASELINE EXISTS FOR. Retirement was `Object.is(mine, incoming)` — the record
    // went only if the entity came back holding exactly what the person set. A consumer that
    // validates answers with something else, so the comparison never matched: the override never
    // retired, the widget showed the rejected 150 forever, and every later external write to that
    // socket lost to it.
    const local = map(150, 0);
    expect(readWidgetValue(local, k, 100)).toBe(100);
    expect(local.has(k)).toBe(false);
  });

  it('retires when the consumer answers by rejecting the change outright', () => {
    // A consumer that refuses the edit and writes back something different again. Still an
    // answer, so the local record still goes.
    const local = map('draft', 'original');
    expect(readWidgetValue(local, k, 'rejected')).toBe('rejected');
    expect(local.has(k)).toBe(false);
  });

  it('an external write arriving mid-edit loses to what the person chose, only until it lands', () => {
    // Stated by the DOM layer as a behaviour choice: a preset applied while a field is being
    // typed into does not overwrite the typing. But it only holds while the ENTITY has not moved
    // — the moment the preset actually reaches the entity, that is the consumer answering and
    // the typed value yields. The old rule held the typed value against the preset forever.
    const local = map('hello', 'name');
    expect(readWidgetValue(local, k, 'name')).toBe('hello');
    expect(readWidgetValue(local, k, 'preset')).toBe('preset');
  });

  it('treats an undefined baseline as a real value, not as "no record"', () => {
    // A widget on a socket the entity has no value for yet: baseline is undefined, and the
    // override still has to survive until the consumer writes something.
    const local = map('typed', undefined);
    expect(readWidgetValue(local, k, undefined)).toBe('typed');
    expect(local.has(k)).toBe(true);
    expect(readWidgetValue(local, k, 'echoed')).toBe('echoed');
    expect(local.has(k)).toBe(false);
  });

  it('keys one widget, not one entity', () => {
    const local = new Map<string, WidgetOverride>([
      [widgetKey('n1', 'in-0'), { value: 1, baseline: 0 }],
    ]);
    expect(readWidgetValue(local, widgetKey('n1', 'in-1'), 5)).toBe(5);
  });
});
