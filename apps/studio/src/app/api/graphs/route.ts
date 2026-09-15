import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createGraph, duplicateGraph, listGraphs } from '@/server/graphs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return signInRequired();
  return NextResponse.json({ graphs: await listGraphs(user.id) });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** Copy this graph instead of starting empty. */
  from: z.string().min(1).max(64).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const body = CreateBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  if (body.data.from) {
    const copy = await duplicateGraph(body.data.from, user.id);
    if (!copy) return NextResponse.json({ error: 'That graph does not exist.' }, { status: 404 });
    return NextResponse.json({ id: copy.id, name: copy.name }, { status: 201 });
  }
  const row = await createGraph(body.data.name, user.id);
  return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
}
