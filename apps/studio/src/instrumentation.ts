/**
 * Runs once when the server starts, before any request.
 *
 * The Node-only work lives in `instrumentation-node.ts`. It is imported inside an inline
 * `=== 'nodejs'` test, because Next compiles this file for the edge runtime as well. That compile
 * inlines `NEXT_RUNTIME` and drops the import only when the test wraps it. An early return does
 * not get the same treatment, and the edge build then tried to bundle Drizzle's migrator and
 * failed on `node:crypto`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
