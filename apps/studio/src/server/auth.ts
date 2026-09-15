/**
 * Sign-in: Better Auth, email and password, on the app's own database.
 *
 * WHO MAY SIGN UP. The first account is the owner's and always allowed. After that only emails
 * listed in `STUDIO_SIGNUP_EMAILS` (comma-separated) can make an account, so a server that is
 * reachable does not turn into a stranger's route to the owner's provider bill.
 *
 * THE FIRST ACCOUNT INHERITS THE INSTALL. Everything made before sign-in existed sits under the
 * `local` workspace; the first account to be created takes it over, so the owner signs up and finds
 * their graphs and pictures where they left them.
 *
 * Built lazily because the database opens asynchronously, and held on `globalThis` for the same
 * reason the database handle is: a dev reload must not build a second one.
 */

import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { count, eq } from 'drizzle-orm';
import { getDb, type Db } from './db';
import {
  assets,
  authAccount,
  authSession,
  authUser,
  authVerification,
  graphs,
  jobs,
  ledger,
  LOCAL_WORKSPACE,
} from './db/schema';

function invited(): Set<string> {
  return new Set(
    (process.env.STUDIO_SIGNUP_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function trustedOrigins(): string[] {
  const listed = (process.env.STUDIO_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
  return ['http://127.0.0.1:3002', 'http://localhost:3002', ...listed].filter(Boolean);
}

async function userCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(authUser);
  return Number(row?.n ?? 0);
}

/** Hand everything made before sign-in to the account that now owns the install. */
async function claimLocal(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [graphs, jobs, assets, ledger]) {
      await tx.update(table).set({ workspaceId: userId }).where(eq(table.workspaceId, LOCAL_WORKSPACE));
    }
  });
}

function build(db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 10 },
    trustedOrigins: trustedOrigins(),
    databaseHooks: {
      user: {
        create: {
          before: async (candidate) => {
            if ((await userCount(db)) === 0) return;
            if (invited().has(candidate.email.toLowerCase())) return;
            throw new APIError('FORBIDDEN', {
              message: 'Sign-ups are closed. Ask the owner to add your email.',
            });
          },
          after: async (created) => {
            if ((await userCount(db)) === 1) await claimLocal(db, created.id);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof build>;

declare global {
  var __studioAuth: Promise<Auth> | undefined;
}

export function getAuth(): Promise<Auth> {
  if (!globalThis.__studioAuth) {
    globalThis.__studioAuth = getDb()
      .then(build)
      .catch((error: unknown) => {
        globalThis.__studioAuth = undefined;
        throw error;
      });
  }
  return globalThis.__studioAuth;
}
