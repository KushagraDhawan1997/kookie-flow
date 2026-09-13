import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { assets, jobs, LOCAL_WORKSPACE } from '@/server/db/schema';
import { mockFixture } from '@/server/mock-provider';
import { getStorage, storageKey } from '@/server/storage';

export const dynamic = 'force-dynamic';

/**
 * One provider call.
 *
 * The mock does the whole job inside the request: pick the file, store it, record it, answer. A
 * real provider will not — it will submit, save a `provider_id`, and be finished by a poll or a
 * webhook — which is why the row is written either way. The row is the thing that survives the
 * tab closing, and building the pipeline around it now means the fal adapter is a swap and not a
 * rewrite.
 */

type OutputKind = 'image' | 'mask' | 'video';

const MODELS: Record<string, Array<{ name: string; kind: OutputKind }>> = {
  'mock/text-to-image': [{ name: 'image', kind: 'image' }],
  'mock/edit-image': [{ name: 'image', kind: 'image' }],
  'mock/upscale': [{ name: 'image', kind: 'image' }],
  'mock/remove-background': [
    { name: 'image', kind: 'image' },
    { name: 'mask', kind: 'mask' },
  ],
  'mock/image-to-video': [{ name: 'video', kind: 'video' }],
};

function jobId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    entityId?: unknown;
    model?: unknown;
    input?: unknown;
  } | null;

  const model = typeof body?.model === 'string' ? body.model : '';
  const outputs = MODELS[model];
  if (!outputs) return NextResponse.json({ error: `unknown model ${model || '(none)'}` }, { status: 400 });

  const input =
    body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? (body.input as Record<string, unknown>)
      : {};
  const nodeId = typeof body?.entityId === 'string' ? body.entityId : null;

  const db = await getDb();
  const id = jobId();
  await db.insert(jobs).values({
    id,
    workspaceId: LOCAL_WORKSPACE,
    nodeId,
    provider: 'mock',
    model,
    status: 'running',
    input,
  });

  try {
    const storage = getStorage();
    const output: Record<string, unknown> = {};

    for (const out of outputs) {
      // A clip for anything that moves, the photograph for everything else.
      const fixture = await mockFixture(out.kind === 'video' ? 'video' : 'image');
      const key = storageKey(fixture.hash, fixture.mime);
      await storage.put(key, fixture.bytes, fixture.mime);
      await db
        .insert(assets)
        .values({
          id: fixture.hash,
          workspaceId: LOCAL_WORKSPACE,
          key,
          mime: fixture.mime,
          bytes: fixture.bytes.byteLength,
          width: fixture.width,
          height: fixture.height,
          duration: fixture.duration ?? null,
        })
        .onConflictDoNothing();

      const url = storage.url(key);
      output[out.name] = {
        kind: out.kind,
        hash: fixture.hash,
        width: fixture.width,
        height: fixture.height,
        url,
        preview: url,
        mime: fixture.mime,
        ...(fixture.duration !== undefined ? { duration: fixture.duration, fps: fixture.fps } : {}),
      };
    }

    await db
      .update(jobs)
      .set({ status: 'succeeded', output, cost: 0, updatedAt: new Date() })
      .where(eq(jobs.id, id));
    return NextResponse.json({ id, output, cost: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(jobs)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(jobs.id, id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
