/**
 * Where bytes go. Content-addressed: the key is the file's hash plus an extension, so the same
 * picture stored twice is stored once and a URL can be cached forever.
 *
 * `local` writes under the data directory and serves through `/api/blob/<key>`; it is what
 * development and a single-machine self-host use. `r2` (phase 9) presigns uploads and hands out a
 * public bucket URL. Chosen by environment, never by the caller.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dataDir } from './paths';

/** A stored file, ready to be sent: its size and type, and its bytes on demand. */
export interface OpenFile {
  size: number;
  mime: string;
  /**
   * The bytes, as a stream. `start` and `end` are inclusive byte offsets, as an HTTP range is.
   * A stream rather than a buffer because a video is served by the piece: a reader seeking in a
   * long clip asks for a window of it, and reading the whole file to answer that puts the file
   * in memory once per request.
   */
  body(start?: number, end?: number): ReadableStream<Uint8Array>;
}

/**
 * Bytes going IN are `Uint8Array<ArrayBuffer>`, not the looser `Uint8Array`, so a caller does not
 * have to assert the type away: a `SharedArrayBuffer` cannot back a response body, and the wide
 * type admits one.
 */
export interface Storage {
  put(key: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<void>;
  open(key: string): Promise<OpenFile | null>;
  /** A URL a browser can fetch. */
  url(key: string): string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'application/json': 'json',
  'text/plain': 'txt',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime])
);

function extensionFor(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

function mimeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1);
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function storageKey(hash: string, mime: string): string {
  return `${hash}.${extensionFor(mime)}`;
}

/** Keys are `<hex>.<ext>`; anything else is not ours and never touches the filesystem. */
export function isStorageKey(key: string): boolean {
  return /^[0-9a-f]{16,64}\.[a-z0-9]{1,5}$/.test(key);
}

class LocalStorage implements Storage {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    if (!isStorageKey(key)) throw new Error(`bad storage key: ${key}`);
    return path.join(this.dir, key);
  }

  /**
   * Write, then make it durable, then put it in place.
   *
   * The rename is what makes the file appear whole — a reader never sees a half-written one — but
   * a rename alone is not durability: after a power cut the name can exist with none of the bytes
   * behind it. So the data is flushed before the rename, and the directory is flushed after it, so
   * the name itself survives. The file is content-addressed, so the alternative to this care is a
   * corrupt file trusted forever under a hash that says it is fine.
   */
  async put(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const target = this.file(key);
    try {
      const stat = await fsp.stat(target);
      // The right length under a content hash is the right file; existence alone is not enough,
      // because a half-written file from a killed process would be trusted for good.
      if (stat.size === bytes.byteLength) return;
    } catch {
      // Not there yet: write it.
    }

    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      const handle = await fsp.open(tmp, 'w');
      try {
        await handle.write(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsp.rename(tmp, target);
      const dir = await fsp.open(this.dir, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (error) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async open(key: string): Promise<OpenFile | null> {
    let size: number;
    const file = this.file(key);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) return null;
      size = stat.size;
    } catch {
      return null;
    }
    return {
      size,
      mime: mimeFor(key),
      body: (start, end) => Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>,
    };
  }

  url(key: string): string {
    return `/api/blob/${key}`;
  }
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  if (!storage) {
    // R2 arrives with launch; until then everything is local.
    storage = new LocalStorage(path.join(dataDir(), 'blobs'));
  }
  return storage;
}
