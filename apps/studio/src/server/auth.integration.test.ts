/**
 * Who may make an account, on a throwaway database: the first account is always allowed and takes
 * over everything made before sign-in existed; after it, only invited emails get in.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Next cookie plugin reaches for the request's cookie jar, which a test has none of.
vi.mock('better-auth/next-js', () => ({ nextCookies: () => ({ id: 'next-cookies' }) }));

let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-auth-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-long-enough-for-better-auth';
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3002';
  process.env.STUDIO_SIGNUP_EMAILS = 'friend@example.com';
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('sign-up', () => {
  it('lets the first account in and hands it what was made before sign-in', async () => {
    const { createGraph, listGraphs } = await import('./graphs');
    const { getAuth } = await import('./auth');
    const made = await createGraph('Before sign-in');

    const auth = await getAuth();
    const owner = await auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'a long password', name: 'Owner' },
    });
    expect(owner.user.email).toBe('owner@example.com');

    expect((await listGraphs(owner.user.id)).map((g) => g.id)).toContain(made.id);
    expect(await listGraphs()).toHaveLength(0);
  });

  it('refuses a stranger after the first account, and lets an invited email in', async () => {
    const { getAuth } = await import('./auth');
    const auth = await getAuth();

    await expect(
      auth.api.signUpEmail({ body: { email: 'stranger@example.com', password: 'a long password', name: 'S' } })
    ).rejects.toThrow(/closed/i);

    const friend = await auth.api.signUpEmail({
      body: { email: 'friend@example.com', password: 'a long password', name: 'Friend' },
    });
    expect(friend.user.email).toBe('friend@example.com');
  });
});
