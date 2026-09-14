import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BadJobRequest, findOrSubmit, refresh, toView } from '@/server/jobs';

export const dynamic = 'force-dynamic';

const Body = z.object({
  task: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).default({}),
  entityId: z.string().max(64).optional(),
  graphId: z.string().max(64).optional(),
});

/**
 * Ask for a job. Answers at once with the row that holds the ask — a new submission, or the one
 * already made for the same inputs — and never waits for the provider: the browser polls
 * `GET /api/jobs/:id` until the status settles. A found row is brought up to date first, so an
 * ask for something already finished comes back with its output in the same breath.
 */
export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { task, input, entityId, graphId } = body.data;

  try {
    const row = await findOrSubmit({ task, input, nodeId: entityId, graphId });
    const fresh = await refresh(row);
    return NextResponse.json(toView(fresh.row, fresh.progress));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadJobRequest)
      return NextResponse.json({ error: message }, { status: 400 });
    console.error('[studio] job request failed', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
