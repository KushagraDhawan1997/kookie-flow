import { and, desc, eq, sql } from 'drizzle-orm';
import { documentFingerprint, emptyDocument, parseDocument, type GraphDocument } from 'studio-core';
import { getDb } from './db';
import { graphs, LOCAL_WORKSPACE } from './db/schema';

export interface GraphSummary {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
}

export async function listGraphs(workspaceId = LOCAL_WORKSPACE): Promise<GraphSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: graphs.id,
      name: graphs.name,
      updatedAt: graphs.updatedAt,
      // Counted in the database: the list showed node counts by parsing every stored document,
      // so opening the list read every graph in full.
      nodeCount: sql<number>`coalesce(jsonb_array_length(case when jsonb_typeof(${graphs.doc} -> 'entities') = 'array' then ${graphs.doc} -> 'entities' end), 0)`,
    })
    .from(graphs)
    .where(eq(graphs.workspaceId, workspaceId))
    .orderBy(desc(graphs.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nodeCount: Number(r.nodeCount),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getGraph(id: string, workspaceId = LOCAL_WORKSPACE) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(graphs)
    .where(and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function createGraph(name = 'Untitled', workspaceId = LOCAL_WORKSPACE) {
  const db = await getDb();
  const id = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(graphs)
    .values({ id, workspaceId, name, doc: emptyDocument() })
    .returning();
  if (!row) throw new Error('insert returned nothing');
  return row;
}

export type UpdateResult =
  | { kind: 'updated'; revision: number; updatedAt: Date }
  /** The row moved on: someone else wrote it since the revision the caller loaded. */
  | { kind: 'stale'; revision: number }
  | { kind: 'missing' };

/** What a write expects of the row it lands on. */
export interface WritePrecondition {
  /** The revision the caller loaded. Omitted means "write regardless", for a first save. */
  revision?: number;
  /**
   * Fingerprints of documents the caller sent and never heard back about. A write based on an
   * older revision still lands when the row holds one of them: the change it missed was its own.
   */
  supersedes?: readonly string[];
}

/**
 * Write a graph, optionally only if it is still at the revision the caller loaded.
 *
 * The precondition and the bump are one statement, so two writers cannot both pass it.
 *
 * A STALE WRITE CAN STILL BE THE CALLER'S OWN. A reloaded page is rendered before the old page's
 * last save arrives, so its first write is based on the revision that save moved past. When the row
 * holds exactly a document the caller names as sent without an answer, nobody else has written, and
 * the write goes ahead — conditional again, on the revision just read, so a writer landing in
 * between still wins. Any other document is someone else's work, and it stands.
 */
export async function updateGraph(
  id: string,
  patch: { name?: string; doc?: GraphDocument },
  expected: WritePrecondition = {},
  workspaceId = LOCAL_WORKSPACE
): Promise<UpdateResult> {
  const db = await getDb();
  const write = (revision: number | undefined) =>
    db
      .update(graphs)
      .set({ ...patch, revision: sql`${graphs.revision} + 1`, updatedAt: new Date() })
      .where(
        revision === undefined
          ? and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId))
          : and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId), eq(graphs.revision, revision))
      )
      .returning({ revision: graphs.revision, updatedAt: graphs.updatedAt });

  const [row] = await write(expected.revision);
  if (row) return { kind: 'updated', revision: row.revision, updatedAt: row.updatedAt };

  // Nothing was written: either the graph is gone, or it is no longer at that revision.
  const current = await getGraph(id, workspaceId);
  if (!current) return { kind: 'missing' };

  if (expected.supersedes && expected.supersedes.length > 0) {
    const stored = parseDocument(current.doc);
    if (stored && expected.supersedes.includes(documentFingerprint(stored))) {
      const [again] = await write(current.revision);
      if (again) return { kind: 'updated', revision: again.revision, updatedAt: again.updatedAt };
    }
  }
  return { kind: 'stale', revision: current.revision };
}

export async function deleteGraph(id: string, workspaceId = LOCAL_WORKSPACE): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(graphs)
    .where(and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId)))
    .returning({ id: graphs.id });
  return rows.length > 0;
}

export { parseDocument };
