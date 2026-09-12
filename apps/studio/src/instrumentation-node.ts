/**
 * Server startup, Node runtime only. Imported by `instrumentation.ts`.
 *
 * It opens the database here so that no page render ever does the cold open. The first open
 * loads PGlite's WASM and runs migrations. Done inside a server component's render, it failed
 * the first response of every fresh dev server with "ArrayBuffer is not detachable" while the
 * stream was piped. Every request after it was fine. The handle is held on `globalThis`
 * (server/db/index.ts), so the renders that follow reuse this one.
 */
import { getDb } from './server/db';

try {
  await getDb();
} catch (error) {
  // A failed open is retried by the first request that needs the database. Report it here,
  // where the person starting the server is looking.
  console.error('[studio] database did not open at startup', error);
}
