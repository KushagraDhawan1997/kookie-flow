/**
 * One database handle for the process.
 *
 * `DATABASE_URL` set: Postgres, through postgres-js. Unset: PGlite, an embedded Postgres kept in
 * `.data/pg` — so a single-user self-host, and this app in development, need no database server.
 * The same Drizzle schema and the same migrations run on both, so moving to a hosted database is
 * one environment variable.
 *
 * Held on `globalThis` because Next's dev server re-evaluates modules on every edit, and a second
 * PGlite on the same directory would fight the first for its lock.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { dataDir } from '../paths';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

declare global {
  var __studioDb: Promise<Db> | undefined;
}

export function getDb(): Promise<Db> {
  if (!globalThis.__studioDb) {
    globalThis.__studioDb = open().catch((error: unknown) => {
      // A failed open must not be cached as a forever-rejected promise.
      globalThis.__studioDb = undefined;
      throw error;
    });
  }
  return globalThis.__studioDb;
}

async function open(): Promise<Db> {
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, { migrate }, { default: postgres }] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('drizzle-orm/postgres-js/migrator'),
      import('postgres'),
    ]);
    const client = postgres(url, { max: 5, prepare: false });
    try {
      const db = drizzle(client, { schema });
      await migrate(db, { migrationsFolder });
      return db;
    } catch (error) {
      // Let the connection go before the caller retries, or a migration that fails on existing
      // rows leaves one pool per request behind it.
      await client.end({ timeout: 5 }).catch(() => {});
      throw error;
    }
  }

  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  const dir = path.join(dataDir(), 'pg');
  await fs.mkdir(dir, { recursive: true });
  const client = await PGlite.create(dir);
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return db;
  } catch (error) {
    // The same rule, and it matters more here: every abandoned PGlite holds the data directory
    // open, and a second one on the same directory can corrupt it.
    await client.close().catch(() => {});
    throw error;
  }
}

export { schema };
