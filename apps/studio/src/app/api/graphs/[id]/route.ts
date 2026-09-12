import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseDocument, type GraphDocument } from 'studio-core';
import { deleteGraph, getGraph, updateGraph } from '@/server/graphs';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const row = await getGraph(id);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    id: row.id,
    name: row.name,
    doc: row.doc,
    revision: row.revision,
    updatedAt: row.updatedAt,
  });
}

const PutBody = z.object({
  name: z.string().optional(),
  doc: z.unknown().optional(),
  /** The revision the client loaded. Omitted means "write regardless", for a first save. */
  revision: z.number().int().positive().optional(),
});

/**
 * A name and a document are judged separately.
 *
 * They arrive together because they change together, but a bad name must not throw away a good
 * document: clearing the name field to retype it used to fail every save that followed, and the
 * editing done in the meantime went with them. An unusable name is simply not applied; the
 * document still lands.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = PutBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const patch: { name?: string; doc?: GraphDocument } = {};
  const name = body.data.name?.trim();
  if (name) patch.name = name.slice(0, 120);

  if (body.data.doc !== undefined) {
    const doc = parseDocument(body.data.doc);
    if (!doc) return NextResponse.json({ error: 'doc is not a graph document' }, { status: 400 });
    patch.doc = doc;
  }

  if (patch.name === undefined && patch.doc === undefined) {
    return NextResponse.json({ error: 'nothing to write' }, { status: 400 });
  }

  const result = await updateGraph(id, patch, body.data.revision);
  if (result.kind === 'missing') return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (result.kind === 'stale') {
    // Someone else wrote this graph since the client loaded it. Refusing is the whole point:
    // applying it would erase their work.
    return NextResponse.json(
      { error: 'the graph changed elsewhere', revision: result.revision },
      { status: 409 }
    );
  }
  return NextResponse.json({ id, revision: result.revision, updatedAt: result.updatedAt });
}

/** `sendBeacon` on unload can only POST, so the last save of a closing tab arrives here. */
export const POST = PUT;

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const gone = await deleteGraph(id);
  return gone
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: 'not found' }, { status: 404 });
}
