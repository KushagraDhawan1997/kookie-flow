import { NextResponse } from 'next/server';
import { z } from 'zod';
import { InsufficientBalance } from '@/server/billing';
import { BadJobRequest, findJob, findOrSubmit, refresh, toView } from '@/server/jobs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({
  task: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).default({}),
  entityId: z.string().max(64).optional(),
  graphId: z.string().max(64).optional(),
  restore: z.boolean().optional(),
});

/**
 * Ask for a job. Answers at once with the row that holds the ask — a new submission, or the one
 * already made for the same inputs — and never waits for the provider: the browser polls
 * `GET /api/jobs/:id` until the status settles. A found row is brought up to date first, so an
 * ask for something already finished comes back with its output in the same breath.
 *
 * With `restore`, nothing is submitted: the row already made for the ask, or 204 when there is
 * none. A graph opening asks this way.
 *
 * A balance that cannot cover a new run is 402, with the amounts in the message the node shows.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { task, input, entityId, graphId, restore } = body.data;

  try {
    const ask = { task, input, nodeId: entityId, graphId };
    const row = restore ? await findJob(ask, user.id) : await findOrSubmit(ask, user.id);
    if (!row) return new NextResponse(null, { status: 204 });
    const fresh = await refresh(row);
    return NextResponse.json(toView(fresh.row, fresh.progress));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof InsufficientBalance)
      return NextResponse.json({ error: message }, { status: 402 });
    if (error instanceof BadJobRequest)
      return NextResponse.json({ error: message }, { status: 400 });
    console.error('[studio] job request failed', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
