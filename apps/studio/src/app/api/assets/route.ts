import { NextResponse } from 'next/server';
import { sha256 } from 'studio-core';
import { getDb } from '@/server/db';
import { assets, LOCAL_WORKSPACE } from '@/server/db/schema';
import { getStorage, storageKey } from '@/server/storage';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/** A dimension is a count of pixels, and it has to fit in the column it is stored in. */
function dimension(form: FormData, name: string): number | null {
  const raw = form.get(name);
  if (typeof raw !== 'string' || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
}

function seconds(form: FormData, name: string): number | null {
  const raw = form.get(name);
  if (typeof raw !== 'string' || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

/**
 * Store an uploaded file and answer with a reference to it. The browser measures the picture — it
 * has a decoder and this server does not — and sends the size along.
 *
 * THE SIZE IS CHECKED BEFORE THE BODY IS READ, when the sender declares one. Reading first and
 * checking after meant an oversized upload was already resident in memory by the time it was
 * refused, several times over for a handful of concurrent requests.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `unsupported type ${file.type}` }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  const key = storageKey(hash, file.type);
  const width = dimension(form, 'width');
  const height = dimension(form, 'height');
  const duration = seconds(form, 'duration');

  const storage = getStorage();
  await storage.put(key, bytes, file.type);
  const db = await getDb();
  await db
    .insert(assets)
    .values({
      id: hash,
      workspaceId: LOCAL_WORKSPACE,
      key,
      mime: file.type,
      bytes: bytes.byteLength,
      width,
      height,
      duration,
    })
    .onConflictDoNothing();

  return NextResponse.json({
    hash,
    url: storage.url(key),
    mime: file.type,
    bytes: bytes.byteLength,
    width,
    height,
    duration,
  });
}
