import { describe, expect, it } from 'vitest';
import { optionLabel } from './widget-parts';
import { widgetPartTexts, widgetValueText } from './widget-text';
import type { ResolvedWidgetConfig } from '../types/index';

/**
 * An option's value is what is stored; its label is what a person reads. Every place that prints an
 * option — the closed select, a segment — must print the label, and fall back to the value.
 */

const box = { x: 0, y: 0, width: 200, height: 32 };

describe('option labels', () => {
  it('reads a label where there is one, and the value where there is not', () => {
    const labels = { png: 'PNG' };
    expect(optionLabel(labels, 'png')).toBe('PNG');
    expect(optionLabel(labels, 'webp')).toBe('webp');
    expect(optionLabel(undefined, 'png')).toBe('png');
    // A value that names something on every object is still just a value.
    expect(optionLabel(labels, 'toString')).toBe('toString');
  });

  it('a closed select prints the chosen option by its label', () => {
    const config: ResolvedWidgetConfig = {
      type: 'select',
      options: ['auto', 'png'],
      optionLabels: { auto: 'Auto', png: 'PNG' },
    };
    expect(widgetValueText(config, 'png', box)?.text).toBe('PNG');
    expect(widgetValueText({ ...config, optionLabels: undefined }, 'png', box)?.text).toBe('png');
  });

  it('a segmented control prints each segment by its label', () => {
    const config: ResolvedWidgetConfig = {
      type: 'segmented',
      options: ['low', 'high'],
      optionLabels: { low: 'Low' },
    };
    expect(widgetPartTexts(config, 'low', box)?.map((p) => p.text)).toEqual(['Low', 'high']);
  });
});
