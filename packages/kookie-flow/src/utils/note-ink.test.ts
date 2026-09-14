import { describe, it, expect } from 'vitest';
import { DEFAULT_NOTE_HUE, NOTE_HUES, noteHue, noteInk } from './note-ink';

describe('note ink', () => {
  it('is yellow unless the note or its entity names a hue', () => {
    expect(noteHue(undefined, undefined)).toBe(DEFAULT_NOTE_HUE);
    expect(noteHue(undefined, 'violet')).toBe('violet');
    expect(noteHue('green', 'violet')).toBe('green');
  });

  it('mixes the hue into the theme page and text colours, so the theme does the appearance', () => {
    const ink = noteInk('violet');
    expect(ink.fill).toContain('#6e56cf');
    expect(ink.fill).toContain('var(--color-page');
    expect(ink.text).toContain('var(--color-text');
  });

  it('takes grey from the live neutral scale v2 ships, not a frozen step it has none of', () => {
    expect(noteInk('gray').fill).toContain('var(--neutral-9)');
  });

  it('falls back to yellow for a hue it does not know', () => {
    expect(noteInk('not-a-hue').fill).toContain('#ffe629');
  });

  it('builds each hue once, so the paint path allocates nothing', () => {
    expect(noteInk('blue')).toBe(noteInk('blue'));
  });

  it('offers only hues it can draw', () => {
    for (const { hue } of NOTE_HUES) {
      expect(noteInk(hue).fill).not.toContain('null');
      expect(noteInk(hue).fill).not.toContain('undefined');
    }
  });
});
