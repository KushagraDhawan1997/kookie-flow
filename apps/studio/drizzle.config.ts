import { defineConfig } from 'drizzle-kit';

/**
 * `pnpm --filter studio db:generate` writes SQL migrations to `drizzle/` from the schema. The app
 * applies them itself on first database access (src/server/db/index.ts), against PGlite or
 * Postgres alike, so no separate migrate step exists.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
});
