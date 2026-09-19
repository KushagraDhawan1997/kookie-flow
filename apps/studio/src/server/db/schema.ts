/**
 * The tables. `workspace_id` is on every one from day one and is the constant `local` until sign-in
 * lands, so auth is a value that changes rather than a column that is added.
 */

import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
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
    /** Unused since billing moved to micros; kept so old rows still read. */
    cost: real('cost'),
    /**
     * Where the job's money stands: `held` from submission until it ends, then `charged` or
     * `released`, once. Null for a job run with billing off, or from before billing existed.
     */
    billing: text('billing').$type<JobBilling>(),
    /** What was held at submission, in micros: the estimate plus the fee. */
    holdMicros: bigint('hold_micros', { mode: 'number' }),
    /** What was charged, in micros, split as shown: the model's price and the fee on it. */
    modelMicros: bigint('model_micros', { mode: 'number' }),
    feeMicros: bigint('fee_micros', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_workspace_status_idx').on(t.workspaceId, t.status),
    index('jobs_provider_id_idx').on(t.provider, t.providerId),
    index('jobs_workspace_key_idx').on(t.workspaceId, t.key),
  ]
);

export type JobBilling = 'held' | 'charged' | 'released';

export type JobRow = typeof jobs.$inferSelect;

export type LedgerKind = 'topup' | 'hold' | 'release' | 'charge' | 'adjust';

/**
 * Every change to a workspace's balance, in millionths of a dollar: positive adds, negative spends.
 * Rows are only ever added. The balance is their sum. See `server/billing.ts`.
 */
export const ledger = pgTable(
  'ledger',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    kind: text('kind').$type<LedgerKind>().notNull(),
    amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
    jobId: text('job_id'),
    /** The agent turn a hold, release or charge belongs to; a row names a job or a turn, never both. */
    turnId: text('turn_id'),
    /** The Checkout session a top-up came from; unique, so a repeated webhook credits once. */
    stripeSessionId: text('stripe_session_id').unique(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ledger_workspace_created_idx').on(t.workspaceId, t.createdAt)]
);

// The agent ----------------------------------------------------------------------------------------

export type TurnBilling = 'held' | 'charged' | 'released';

/**
 * One step request to the agent: a call, or a few while server tools answer inside it. Held before
 * the model is asked, charged on the tokens the model reports, like a job. The token counts are kept
 * so a charge can be explained line by line.
 */
export const agentTurns = pgTable(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    graphId: text('graph_id'),
    /** The gateway slug the turn thought with. */
    model: text('model').notNull(),
    /** Null for a turn run with billing off. */
    billing: text('billing').$type<TurnBilling>(),
    holdMicros: bigint('hold_micros', { mode: 'number' }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    modelMicros: bigint('model_micros', { mode: 'number' }),
    feeMicros: bigint('fee_micros', { mode: 'number' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_turns_workspace_created_idx').on(t.workspaceId, t.createdAt)]
);

export type AgentTurnRow = typeof agentTurns.$inferSelect;

/**
 * A graph's conversation with the agent, as the chat's own message list. One per graph: the agent
 * works above graphs, but a conversation is about the canvas it was started on.
 */
export const conversations = pgTable('conversations', {
  graphId: text('graph_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  messages: jsonb('messages').$type<unknown[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Sign-in (Better Auth) ---------------------------------------------------------------------------
// The adapter maps by these property names, which are Better Auth's field names; the tables carry
// an `auth_` prefix so `user`, a reserved word in Postgres, is never a table name.

export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (t) => [index('auth_session_user_idx').on(t.userId)]
);

export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_account_user_idx').on(t.userId)]
);

export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)]
);
