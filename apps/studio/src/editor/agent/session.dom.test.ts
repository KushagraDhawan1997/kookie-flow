/**
 * The session's send path, in a DOM, against the real `Chat` from the AI SDK and a fake server.
 *
 * WHY IT HAS ITS OWN CONFIG. The app's unit config is server code only, and excludes this file by
 * its name; this one needs a window, so it runs under `pnpm test:dom`, as the bench does. It is, and
 * not left to Playwright, because what it covers is a race: a message now waits for its triage
 * before it reaches the chat, and everything that can happen inside that wait — a second Enter,
 * Start over, the pane closing — has to be pinned down by something that runs on every change.
 */

import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@/editor/agent/session';

/** A host stub: only readGraph is reached on the send path. */
const host = {
  readGraph: () => 'n1 source/text "Brief"',
  applyOps: () => ({ created: [], errors: [] }),
  estimate: () => ({ nodes: [], totalMicros: 0, total: '$0.00' }),
  run: async () => ({ nodes: [] }),
  inspect: () => ({ node: 'n1', error: 'none' }),
  addPictures: () => [],
  ready: async () => {},
} as never;

/** The step route, as a stream that stays open, so a second send would visibly overlap the first. */
function server(state: { posts: string[][]; live: number; maxLive: number }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(url).includes('/api/agent/triage')) {
      // Message one's triage is slow, message two's is quick: the inversion the audit described.
      const slow = String(body.text).includes('make a cat');
      await new Promise((r) => setTimeout(r, slow ? 120 : 10));
      return new Response(
        JSON.stringify({
          triage: { v: 1, clear: 0.9, scope: 'extend', scopeP: 0.9, shape: 'drafts', shapeP: 0.8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (String(url).includes('/api/agent/step')) {
      state.posts.push(
        (body.messages ?? []).map((m: { parts: { text?: string }[] }) =>
          m.parts.map((p) => p.text).join('')
        )
      );
      state.live++;
      state.maxLive = Math.max(state.maxLive, state.live);
      const stream = new ReadableStream({
        async start(c) {
          const enc = new TextEncoder();
          c.enqueue(enc.encode('data: {"type":"start"}\n\n'));
          await new Promise((r) => setTimeout(r, 200));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          state.live--;
          c.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (String(url).includes('/api/agent/')) {
      return new Response(JSON.stringify({ messages: [], mode: 'mock' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('two messages sent inside the triage wait', () => {
  it('keeps their order and never runs two step requests at once', async () => {
    const state = { posts: [] as string[][], live: 0, maxLive: 0 };
    vi.stubGlobal('fetch', server(state));
    const session = new AgentSession('g1', host);
    session.open();
    await session.start();

    session.send('make a cat');
    // The composer is blocked the moment the first message leaves it, so the panel would refuse a
    // second Enter here; send it anyway to prove the session itself is safe.
    expect(session.getState().delivering).toBe(true);
    session.send('in watercolour');
    await new Promise((r) => setTimeout(r, 900));

    expect(state.maxLive).toBe(1);
    expect(state.posts[0]).toEqual(['make a cat']);
    expect(state.posts[1]?.[0]).toBe('make a cat');
    expect(state.posts[1]?.at(-1)).toBe('in watercolour');
    expect(session.getState().delivering).toBe(false);
  });

  it('does not put a message back after Start over clears the conversation', async () => {
    const state = { posts: [] as string[][], live: 0, maxLive: 0 };
    vi.stubGlobal('fetch', server(state));
    const session = new AgentSession('g1', host);
    session.open();
    await session.start();

    session.send('make a cat');
    await session.startOver();
    await new Promise((r) => setTimeout(r, 400));

    expect(state.posts).toEqual([]);
    expect(session.getState().chat?.messages ?? []).toEqual([]);
  });

  it('still sends a message typed before the pane closed', async () => {
    const state = { posts: [] as string[][], live: 0, maxLive: 0 };
    vi.stubGlobal('fetch', server(state));
    const session = new AgentSession('g1', host);
    session.open();
    await session.start();

    session.send('make a cat');
    session.close();
    await new Promise((r) => setTimeout(r, 400));

    expect(state.posts[0]).toEqual(['make a cat']);
  });
});
