import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { isTriageNote } from 'studio-core';
import { mockHistory } from './model';
import { triage, triageEnabled, withTriageNotes } from './triage';

describe('triage on the server', () => {
  const env = { agent: process.env.STUDIO_AGENT, triage: process.env.STUDIO_TRIAGE };
  beforeEach(() => {
    process.env.STUDIO_AGENT = 'mock';
    delete process.env.STUDIO_TRIAGE;
  });
  afterEach(() => {
    if (env.agent === undefined) delete process.env.STUDIO_AGENT;
    else process.env.STUDIO_AGENT = env.agent;
    if (env.triage === undefined) delete process.env.STUDIO_TRIAGE;
    else process.env.STUDIO_TRIAGE = env.triage;
  });

  it('reads a short ask as unclear and a named edit as one exact result, through the evaluate call', async () => {
    const short = await triage('a controller', '', undefined);
    expect(short.answers.clear).toBeLessThan(0.5);
    expect(short.answers.shape).toBe('drafts');
    expect(short.inputTokens).toBeGreaterThan(0);

    const edit = await triage(
      'Remove the background from the picture and upscale it twice',
      'n1 source/image "Picture"',
      undefined
    );
    expect(edit.answers.clear).toBeGreaterThan(0.5);
    expect(edit.answers.shape).toBe('single');
    expect(edit.answers.scope).toBe('extend');
  });

  it('is on unless told otherwise', () => {
    expect(triageEnabled()).toBe(true);
    process.env.STUDIO_TRIAGE = 'off';
    expect(triageEnabled()).toBe(false);
  });

  it('adds the line to the copy the model reads, and only where a message carries answers', async () => {
    const { answers } = await triage(
      'Concept art for a controller for a handheld games console',
      '',
      undefined
    );
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Concept art for a controller' }],
        metadata: { triage: answers },
      },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Which style?' }] },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'Matte black' }],
        metadata: { triage: { v: 9 } },
      },
    ];
    const forModel = withTriageNotes(messages);
    expect(forModel[0]?.parts).toHaveLength(2);
    expect(forModel[0]?.parts[1]).toMatchObject({ type: 'text' });
    const note = forModel[0]?.parts[1];
    expect(note && 'text' in note && isTriageNote(note.text)).toBe(true);
    expect(forModel[1]).toBe(messages[1]);
    expect(forModel[2]?.parts).toHaveLength(1);
    // The stored messages are untouched.
    expect(messages[0]?.parts).toHaveLength(1);
  });

  it('takes stored lines out of the model\u2019s copy when triage is off, not just new ones', async () => {
    const { answers } = await triage(
      'Concept art for a controller for a handheld games console',
      '',
      undefined
    );
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Concept art' }],
        metadata: { triage: answers },
      },
    ];
    expect(withTriageNotes(messages)[0]?.parts).toHaveLength(2);
    // A conversation triaged before the flag was set keeps its answers; the model must stop reading
    // them, or the off side of the comparison is measured against an agent still being hinted.
    process.env.STUDIO_TRIAGE = 'off';
    expect(withTriageNotes(messages)[0]?.parts).toHaveLength(1);
  });

  it('is invisible to the mock agent, which reads only the words the person wrote', async () => {
    const { answers } = await triage('a controller', '', undefined);
    const [user] = withTriageNotes([
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'a controller' }],
        metadata: { triage: answers },
      },
    ]);
    const content = user?.parts.flatMap((p) =>
      p.type === 'text' ? [{ type: 'text' as const, text: p.text }] : []
    );
    const history = mockHistory([{ role: 'user', content: content ?? [] }]);
    expect(history.userText).toBe('a controller');
  });
});
