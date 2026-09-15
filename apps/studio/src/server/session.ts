/**
 * Who is asking. Every route and page that reads or writes a workspace's data starts here; the
 * proxy only turns away requests with no session cookie at all, which a forged cookie passes.
 *
 * The workspace is the user's id: one person, one workspace, until teams exist.
 */

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getAuth } from './auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function currentUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export function signInRequired(): NextResponse {
  return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
}
