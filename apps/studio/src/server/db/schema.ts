/**
 * The tables. `workspace_id` is on every one from day one and is the constant `local` until sign-in
 * lands, so auth is a value that changes rather than a column that is added.
 */

import { index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { GraphDocument } from 'studio-core';
import type { JobStatus } from '@/shared/jobs';

export const LOCAL_WORKSPACE = 'local';

export const graphs = pgTable(
  'graphs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().default(LOCAL_WORKSPACE),
    name: text('name').notNull().default('Untitled'),
    doc: jsonb('doc').$type<GraphDocument>().notNull(),
    /**
     * Bumped by every write. A client sends the revision it loaded, and a write whose revision
     * no longer matches is refused rather than applied: a save is the whole document, so without
     * this the last writer wins and a second tab's work disappears with no sign.
     */
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('graphs_workspace_updated_idx').on(t.workspaceId, t.updatedAt)]
);

/** Stored bytes, content-addressed: the id is the sha-256 of the file. */
export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().default(LOCAL_WORKSPACE),
    /** The storage key, `<hash>.<ext>`. */
    key: text('key').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Seconds; video only. */
    duration: real('duration'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_workspace_idx').on(t.workspaceId, t.createdAt)]
);

export type { JobStatus };

/**
 * One provider call. The row is what survives the tab: the provider keeps working whether or not
 * anyone is watching, and the next status poll — from this tab after a refresh, or from the next
 * one to open the graph — finishes it from here.
 *
 * `key` is what makes a repeat free. It names the provider, the model and the inputs' identities,
 * and the same ask again finds this row instead of paying for a second run.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().default(LOCAL_WORKSPACE),
    graphId: text('graph_id'),
    nodeId: text('node_id'),
    provider: text('provider').notNull(),
    /** What the node asked for: `text-to-image` and so on. Absent on rows from before it existed. */
    task: text('task'),
    /** The provider's model or endpoint, which is the provider's choice for the task. */
    model: text('model').notNull(),
    /** The provider's own id for the request, for status and cancel. */
    providerId: text('provider_id'),
    /** What the provider needs to ask about the request later: fal's status, result and cancel URLs. */
    providerState: jsonb('provider_state').$type<Record<string, unknown>>(),
    /** sha-256 over provider, task, model and the inputs' identities. Absent on rows from before it existed. */
    key: text('key'),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: text('error'),
    /** In credits, once known. */
    cost: real('cost'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_workspace_status_idx').on(t.workspaceId, t.status),
    index('jobs_provider_id_idx').on(t.provider, t.providerId),
    index('jobs_workspace_key_idx').on(t.workspaceId, t.key),
  ]
);

export type JobRow = typeof jobs.$inferSelect;
