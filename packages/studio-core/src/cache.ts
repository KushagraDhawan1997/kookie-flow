/**
 * Hashing and cache keys.
 *
 * Two hashes for two jobs. `hashString` is FNV-1a, synchronous and cheap, for cache keys built
 * from canonical JSON on every run. `sha256` is the content hash of real bytes — a file someone
 * uploaded, a picture a provider returned — and is async because the platform's digest is.
 * Neither is for security.
 */

/** JSON with sorted keys and no undefined, so equal values give equal strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Two FNV-1a 32-bit passes with different seeds, as 16 hex characters. */
export function hashString(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193);
    b ^= c;
    b = Math.imul(b, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The key a node's result is cached under: what it is, which version of it, and exactly what
 * it was given. A picture input contributes its hash, never its bytes (see `valueIdentity`).
 */
export function cacheKey(
  type: string,
  version: number,
  inputs: Record<string, unknown>,
  extra?: Record<string, unknown>
): string {
  return hashString(canonicalJson({ type, version, inputs, extra }));
}

/** A small LRU, keyed by string. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly limit = 200) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Re-insert so the most recent read is the last to be evicted.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
