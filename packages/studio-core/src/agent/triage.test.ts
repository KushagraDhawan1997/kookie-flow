import { describe, expect, it } from 'vitest';
import {
  CANVAS_CHARS,
  isTriageAnswers,
  isTriageNote,
  readTriage,
  triageNote,
  triageState,
  TRIAGE_QUESTIONS,
} from './triage';

const answers = {
  clear: { type: 'boolean', probability: 0.917 },
  scope: { type: 'choice', choice: 'extend', probabilities: { extend: 0.88, new: 0.12 } },
  shape: { type: 'choice', choice: 'drafts', probabilities: { drafts: 0.705, single: 0.295 } },
};

describe('triage', () => {
  it('asks three questions the harness already decides by rule', () => {
    expect(Object.keys(TRIAGE_QUESTIONS)).toEqual(['clear', 'scope', 'shape']);
    expect(Object.keys(TRIAGE_QUESTIONS.scope.criteria)).toEqual(['extend', 'new']);
    expect(Object.keys(TRIAGE_QUESTIONS.shape.criteria)).toEqual(['drafts', 'single']);
  });

  it('keeps the answers small and rounded, and refuses an answer that was not asked for', () => {
    const kept = readTriage(answers);
    expect(kept).toEqual({
      v: 1,
      clear: 0.92,
      scope: 'extend',
      scopeP: 0.88,
      shape: 'drafts',
      shapeP: 0.71,
    });
    expect(isTriageAnswers(kept)).toBe(true);
    expect(readTriage({ ...answers, scope: { type: 'choice', choice: 'elsewhere' } })).toBeNull();
    expect(readTriage({ ...answers, clear: { type: 'boolean', probability: 1.5 } })).toBeNull();
    expect(readTriage(null)).toBeNull();
    expect(
      isTriageAnswers({ v: 2, clear: 0.5, scope: 'extend', scopeP: 1, shape: 'single', shapeP: 1 })
    ).toBe(false);
  });

  it('reads a choice with no distribution as certain', () => {
    const kept = readTriage({ ...answers, shape: { type: 'choice', choice: 'single' } });
    expect(kept?.shape).toBe('single');
    expect(kept?.shapeP).toBe(1);
  });

  it('knows its own line from a message that merely starts the same way', () => {
    const kept = readTriage(answers);
    if (!kept) throw new Error('no answers');
    expect(isTriageNote(triageNote(kept))).toBe(true);
    // A person may write this. Read as a note, their message reached the scripted agent as empty.
    expect(isTriageNote('[triage] why is this note showing up?')).toBe(false);
    expect(isTriageNote('[triage]')).toBe(false);
    expect(isTriageNote(`${triageNote(kept)} and then some`)).toBe(false);
  });

  it('writes one line, the same every time, that the mock and the panel can tell apart', () => {
    const kept = readTriage(answers);
    if (!kept) throw new Error('no answers');
    const note = triageNote(kept);
    expect(note).toBe(
      '[triage] A quick read of this message by a small model, not a decision: clear enough to build 0.92; extend the open graph 0.88 (start a new graph 0.12); drafts then a pick 0.71 (one exact result 0.29).'
    );
    expect(triageNote(kept)).toBe(note);
    expect(isTriageNote(note)).toBe(true);
    expect(isTriageNote('Concept art for a controller')).toBe(false);
  });

  it('names an empty canvas and bounds a large one', () => {
    expect(triageState('a cat', '  ').canvas).toBe('The canvas is empty.');
    const big = triageState('a cat', 'n1 source/text\n'.repeat(1000));
    // The browser slices to this before sending, so the route's body limit is never the thing that
    // decides whether a large graph gets a triage at all.
    expect(CANVAS_CHARS).toBe(6_000);
    expect(big.canvas.length).toBeLessThan(6_100);
    expect(big.canvas.endsWith('…')).toBe(true);
    expect(big.message).toBe('a cat');
  });
});
