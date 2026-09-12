import path from 'node:path';

/**
 * Where this install keeps what it cannot lose: the database and the stored files.
 *
 * `STUDIO_DATA_DIR` is the answer for anything real. Without it the default is `.data` beside the
 * app, which is right for `next dev` and for a self-host started from the app directory — and is
 * the reason the variable exists: a standalone server can be started from anywhere, and a data
 * directory that resolved inside `.next` would be deleted by the next build.
 */
export function dataDir(): string {
  const stated = process.env.STUDIO_DATA_DIR;
  return stated ? path.resolve(stated) : path.resolve(process.cwd(), '.data');
}
