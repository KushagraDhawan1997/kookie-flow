/**
 * The tables. `workspace_id` is on every one from day one and is the constant `local` until sign-in
 * lands, so auth is a value that changes rather than a column that is added.
 */

import { index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { GraphDocument } from 'studio-core';

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

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** One provider call. Survives the tab: the webhook or the next status poll finishes it. */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().default(LOCAL_WORKSPACE),
    graphId: text('graph_id'),
    nodeId: text('node_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** The provider's own id for the request, for status and cancel. */
    providerId: text('provider_id'),
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
  ]
);
