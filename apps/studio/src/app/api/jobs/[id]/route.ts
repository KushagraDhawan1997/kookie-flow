import { NextResponse } from 'next/server';
import { cancel, getJob, refresh, toView } from '@/server/jobs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Where a job is. A pending row is checked with its provider on the way out, and a row the
 * provider has finished is finished here, files and all — so this is the whole of what a browser
 * does to follow a job, and a browser that was not there when it ended catches up on its next ask.
 *
 * A fault reaching the provider is a 502 and changes nothing on the row; the browser asks again.
 */
export async function GET(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const { id } = await params;
  const row = await getJob(id, user.id);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    const fresh = await refresh(row);
    return NextResponse.json(toView(fresh.row, fresh.progress));
  } catch (error) {
    console.error('[studio] job status failed', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Stop a pending job. A settled one is answered as it stands. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const { id } = await params;
  const row = await getJob(id, user.id);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    return NextResponse.json(toView(await cancel(row)));
  } catch (error) {
    console.error('[studio] job cancel failed', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
