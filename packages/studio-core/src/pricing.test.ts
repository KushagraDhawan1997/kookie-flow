import { describe, expect, it } from 'vitest';
import { actualModelMicros, estimateModelMicros, formatUsd, withFee } from './pricing';
import type { MediaRef } from './values';

const picture = (width: number, height: number): MediaRef => ({ kind: 'image', hash: 'h', width, height });

describe('pricing', () => {
  it('adds the stated fee on top of the model price, in whole micros', () => {
    expect(withFee(80_000)).toEqual({ model: 80_000, fee: 40_000, total: 120_000 });
    expect(withFee(13_170)).toEqual({ model: 13_170, fee: 6_585, total: 19_755 });
    expect(withFee(-5)).toEqual({ model: 0, fee: 0, total: 0 });
  });

  it('prints cents, and four places under a cent', () => {
    expect(formatUsd(120_000)).toBe('$0.12');
    expect(formatUsd(4_020)).toBe('$0.0040');
    expect(formatUsd(-2_500_000)).toBe('−$2.50');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('prices GPT Image from fal’s table by size and quality', () => {
    expect(estimateModelMicros('gpt-image-2.5', { size: 'square_hd', quality: 'medium' })).toBe(13_170);
    expect(estimateModelMicros('gpt-image-2.5', { size: 'custom', width: 3840, height: 2160, quality: 'max' })).toBe(400_260);
    // A picture turned on end is the same price.
    expect(estimateModelMicros('gpt-image-2.5', { size: 'custom', width: 1536, height: 1024, quality: 'low' })).toBe(4_740);
    // `auto` quality is fal's default, high.
    expect(estimateModelMicros('gpt-image-2.5', { size: 'square_hd', quality: 'auto' })).toBe(52_680);
  });

  it('adds input tokens for each connected picture, and charges by the size that came back', () => {
    const input = { size: 'auto', quality: 'medium', image: picture(1536, 1024) };
    expect(estimateModelMicros('gpt-image-2.5', input)).toBe(10_290 + 10_000);
    expect(actualModelMicros('gpt-image-2.5', input, { image: picture(1024, 1024) })).toBe(13_170 + 10_000);
  });

  it('prices the upscaler by the megapixels it makes', () => {
    const input = { image: picture(1536, 1024), factor: 2 };
    expect(estimateModelMicros('clarity-upscaler', input)).toBe(Math.round(0.03 * 3072 * 2048));
    expect(actualModelMicros('clarity-upscaler', input, { image: picture(3072, 2048) })).toBe(Math.round(0.03 * 3072 * 2048));
    expect(estimateModelMicros('clarity-upscaler', {})).toBe(0);
  });

  it('prices video by resolution and length, and refuses a task it does not know', () => {
    expect(estimateModelMicros('wan-i2v', { resolution: '720p', frames: 81 })).toBe(400_000);
    expect(estimateModelMicros('wan-i2v', { resolution: '480p', frames: 100 })).toBe(250_000);
    expect(estimateModelMicros('make-coffee', {})).toBeUndefined();
  });
});
