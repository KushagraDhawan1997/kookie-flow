'use client';

import { createAuthClient } from 'better-auth/react';

/** Talks to `/api/auth` on this same origin. */
export const authClient = createAuthClient();
