import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/auth';

export const dynamic = 'force-dynamic';

/** Better Auth's own routes: sign up, sign in, sign out, session. Built on first use. */
export async function GET(request: Request) {
  return toNextJsHandler(await getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(await getAuth()).POST(request);
}
