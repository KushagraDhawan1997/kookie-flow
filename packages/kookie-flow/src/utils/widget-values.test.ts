import { describe, it, expect } from 'vitest';
import { readWidgetValue, widgetKey } from './widget-values';

/**
 * The GL widgets have no component to keep a `useState` in, so the DOM layer's "local, but
 * follows an external write unless you are mid-edit" rule lives in a map and a function. These
 * are that rule's cases, each one a behaviour the DOM layer documented and this must keep.
 */
describe('readWidgetValue', () => {
  const k = widgetKey('n1', 'in-0');

  it('shows the entity value when the person has not touched the widget', () => {
    expect(readWidgetValue(new Map(), k, 0.25)).toBe(0.25);
  });

  it('shows what the person set while the consumer has not echoed it yet', () => {
    // A slider dragged to 0.8 in a consumer that debounces: the entity still says 0.25.
    const local = new Map<string, unknown>([[k, 0.8]]);
    expect(readWidgetValue(local, k, 0.25)).toBe(0.8);
    expect(local.has(k)).toBe(true);
  });

  it('retires the local value the moment it round-trips, so external writes win again', () => {
    const local = new Map<string, unknown>([[k, 0.8]]);
    expect(readWidgetValue(local, k, 0.8)).toBe(0.8);
    expect(local.has(k)).toBe(false);
    // An undo now reaches the widget.
    expect(readWidgetValue(local, k, 0.25)).toBe(0.25);
  });

  it('an external write arriving mid-edit loses to what the person chose', () => {
    // Stated by the DOM layer as a behaviour choice: a preset applied while a field is being
    // typed into does not overwrite the typing; it is picked up once the typed value round-trips.
    const local = new Map<string, unknown>([[k, 'hello']]);
    expect(readWidgetValue(local, k, 'preset')).toBe('hello');
  });

  it('keys one widget, not one entity', () => {
    const local = new Map<string, unknown>([[widgetKey('n1', 'in-0'), 1]]);
    expect(readWidgetValue(local, widgetKey('n1', 'in-1'), 5)).toBe(5);
  });
});
