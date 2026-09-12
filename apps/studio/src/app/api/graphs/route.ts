import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createGraph, listGraphs } from '@/server/graphs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ graphs: await listGraphs() });
}

const CreateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

export async function POST(request: Request) {
  const body = CreateBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const row = await createGraph(body.data.name);
  return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
}
