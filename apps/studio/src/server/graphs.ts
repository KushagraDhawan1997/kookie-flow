import { and, desc, eq, sql } from 'drizzle-orm';
import { emptyDocument, parseDocument, type GraphDocument } from 'studio-core';
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

/**
 * Write a graph, optionally only if it is still at the revision the caller loaded.
 *
 * The precondition and the bump are one statement, so two writers cannot both pass it.
 */
export async function updateGraph(
  id: string,
  patch: { name?: string; doc?: GraphDocument },
  expectedRevision?: number,
  workspaceId = LOCAL_WORKSPACE
): Promise<UpdateResult> {
  const db = await getDb();
  const where =
    expectedRevision === undefined
      ? and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId))
      : and(eq(graphs.id, id), eq(graphs.workspaceId, workspaceId), eq(graphs.revision, expectedRevision));

  const [row] = await db
    .update(graphs)
    .set({ ...patch, revision: sql`${graphs.revision} + 1`, updatedAt: new Date() })
    .where(where)
    .returning({ revision: graphs.revision, updatedAt: graphs.updatedAt });

  if (row) return { kind: 'updated', revision: row.revision, updatedAt: row.updatedAt };

  // Nothing was written: either the graph is gone, or it is no longer at that revision.
  const current = await getGraph(id, workspaceId);
  return current ? { kind: 'stale', revision: current.revision } : { kind: 'missing' };
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
