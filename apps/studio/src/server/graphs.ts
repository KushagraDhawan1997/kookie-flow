import { and, desc, eq, sql } from 'drizzle-orm';
import { documentFingerprint, emptyDocument, parseDocument, registry, type GraphDocument } from 'studio-core';
import { getDb } from './db';
import { graphs, jobs, LOCAL_WORKSPACE } from './db/schema';

export interface GraphSummary {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  /** The newest picture a run in this graph made, for the card. Null until one has. */
  cover: string | null;
  /** Where the nodes sit and how they are wired, so a graph with no picture yet shows its shape. */
  layout: GraphLayout;
}

export interface GraphLayout {
  /** `media` marks a node with a picture band, drawn as a tinted top. */
  nodes: { x: number; y: number; w: number; h: number; media: boolean }[];
  /** From a source's right edge to a target's left edge, as the canvas draws them. */
  wires: { x1: number; y1: number; x2: number; y2: number }[];
}

/** Node boxes kept per card: enough to read the graph's shape, small enough to stay cheap. */
const LAYOUT_LIMIT = 48;
const WIRE_LIMIT = 96;

/**
 * A saved node drops a size that equals its type's own (`stripResolved`), so the size comes back
 * from the type table here. Heights are not in the table — the canvas measures them — so a node is
 * drawn at a typical height: taller with a picture band, since the band is most of such a node.
 */
const FALLBACK_WIDTH = 220;
const PLAIN_HEIGHT = 120;
const MEDIA_HEIGHT = 260;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The database hands back `[id, type, x, y, w, h]` node rows and `[source, target]` wire rows;
 * anything without a finite position is dropped, and a wire whose end was dropped goes with it.
 */
function readLayout(rawNodes: unknown, rawWires: unknown): GraphLayout {
  const types = registry.entityTypes();
  const byId = new Map<string, GraphLayout['nodes'][number]>();
  if (Array.isArray(rawNodes)) {
    for (const row of rawNodes) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const x = num(row[2]);
      const y = num(row[3]);
      if (x === null || y === null) continue;
      const type = typeof row[1] === 'string' ? types[row[1]] : undefined;
      const media = type?.preview !== undefined;
      byId.set(row[0], {
        x,
        y,
        w: num(row[4]) ?? type?.defaultWidth ?? FALLBACK_WIDTH,
        h: num(row[5]) ?? type?.defaultHeight ?? (media ? MEDIA_HEIGHT : PLAIN_HEIGHT),
        media,
      });
    }
  }
  const wires: GraphLayout['wires'] = [];
  if (Array.isArray(rawWires)) {
    for (const row of rawWires) {
      if (!Array.isArray(row)) continue;
      const a = typeof row[0] === 'string' ? byId.get(row[0]) : undefined;
      const b = typeof row[1] === 'string' ? byId.get(row[1]) : undefined;
      if (!a || !b) continue;
      wires.push({ x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 });
    }
  }
  return { nodes: [...byId.values()], wires };
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
      // Only the boxes leave the database, never the document: the same reason as the count.
      layout: sql<unknown>`(
        select coalesce(jsonb_agg(jsonb_build_array(e -> 'id', e -> 'type', e -> 'position' -> 'x', e -> 'position' -> 'y', e -> 'width', e -> 'height')), '[]'::jsonb)
        from (
          select e from jsonb_array_elements(
            case when jsonb_typeof("graphs"."doc" -> 'entities') = 'array' then "graphs"."doc" -> 'entities' else '[]'::jsonb end
          ) e
          limit ${sql.raw(String(LAYOUT_LIMIT))}
        ) s
      )`,
      wires: sql<unknown>`(
        select coalesce(jsonb_agg(jsonb_build_array(e -> 'source', e -> 'target')), '[]'::jsonb)
        from (
          select e from jsonb_array_elements(
            case when jsonb_typeof("graphs"."doc" -> 'edges') = 'array' then "graphs"."doc" -> 'edges' else '[]'::jsonb end
          ) e
          limit ${sql.raw(String(WIRE_LIMIT))}
        ) s
      )`,
      // THE OUTER COLUMNS ARE SPELLED OUT. In a single-table select Drizzle writes `${graphs.id}`
      // as a bare "id", which inside this subquery resolves to the job's own id and never matches.
      cover: sql<string | null>`(
        select v.value ->> 'url'
        from ${jobs} j, jsonb_each(j.output) v
        where j.graph_id = "graphs"."id"
          and j.workspace_id = "graphs"."workspace_id"
          and j.status = 'succeeded'
          and v.value ->> 'kind' = 'image'
          and v.value ->> 'url' is not null
        order by j.updated_at desc
        limit 1
      )`,
    })
    .from(graphs)
    .where(eq(graphs.workspaceId, workspaceId))
    .orderBy(desc(graphs.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nodeCount: Number(r.nodeCount),
    updatedAt: r.updatedAt.toISOString(),
    cover: r.cover,
    layout: readLayout(r.layout, r.wires),
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

/** A new graph, empty unless a document is given (the agent builds one before it is ever opened). */
export async function createGraph(name = 'Untitled', workspaceId = LOCAL_WORKSPACE, doc: GraphDocument = emptyDocument()) {
  const db = await getDb();
  const id = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(graphs)
    .values({ id, workspaceId, name, doc })
    .returning();
  if (!row) throw new Error('insert returned nothing');
  return row;
}

/** A copy of a graph under a new id. Its runs stay with the original: they were paid for there. */
export async function duplicateGraph(sourceId: string, workspaceId: string) {
  const source = await getGraph(sourceId, workspaceId);
  if (!source) return null;
  const db = await getDb();
  const id = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(graphs)
    .values({ id, workspaceId, name: `${source.name} copy`.slice(0, 120), doc: source.doc })
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
