/**
 * The job pipeline: one ask becomes one row, the row is asked about until it is done, and a
 * finished row's files are copied into storage and written back as references.
 *
 * NOTHING THE BROWSER HOLDS MATTERS. The row carries what the provider needs (`provider_state`),
 * what the node asked for (`input`), and what came back (`output`). A tab that refreshes, closes
 * or crashes mid-job loses nothing: the same ask finds the same row by `key`, and the next poll
 * carries on from wherever the provider is. A server that restarts mid-job loses nothing either,
 * for the same reason.
 *
 * THE SAME ASK IS FREE. `key` is the hash of the provider, the task, the model and the inputs'
 * identities — a picture counts by its hash, not its bytes or its URL. A queued, running or
 * finished row with that key answers the next ask; a failed or cancelled one does not, so a retry
 * is a fresh submission. That is what makes opening a graph, which runs every node, cost nothing
 * for what was already made.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  canonicalJson,
  estimateModelMicros,
  isMediaRef,
  probeMedia,
  sha256,
  withFee,
  type MediaRef,
} from 'studio-core';
import type { JobStatus, JobView } from '@/shared/jobs';
import { billingEnabled, hold, settle } from './billing';
import { getDb, type Db } from './db';
import { assets, jobs, LOCAL_WORKSPACE, type JobRow } from './db/schema';
import { getProvider, providerById } from './providers';
import {
  JobFailed,
  type ProducedFile,
  type Provider,
  type ProviderJob,
} from './providers/provider';
import { getStorage, storageKey } from './storage';

/** A provider's file can be as large as an upload may be. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** The caller's ask was wrong, not the world: answered 400 rather than 500. */
export class BadJobRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadJobRequest';
  }
}

export interface JobAsk {
  task: string;
  input: Record<string, unknown>;
  nodeId?: string;
  graphId?: string;
}

/** The identity of a value for the key: a picture is its kind and hash, anything else is itself. */
export function identityOf(value: unknown): unknown {
  if (isMediaRef(value)) return `${value.kind}:${value.hash}`;
  if (Array.isArray(value)) return value.map(identityOf);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = identityOf(v);
    return out;
  }
  return value;
}

/** What makes two asks the same ask. sha-256, since a collision would hand someone the wrong picture. */
export function jobKey(
  provider: string,
  task: string,
  model: string,
  input: Record<string, unknown>
): Promise<string> {
  return sha256(
    new TextEncoder().encode(canonicalJson({ provider, task, model, input: identityOf(input) }))
  );
}

function jobId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function asProviderJob(row: JobRow): ProviderJob {
  return {
    id: row.id,
    task: row.task ?? '',
    model: row.model,
    input: row.input,
    providerId: row.providerId,
    state: row.providerState,
    createdAt: row.createdAt,
  };
}

export function toView(row: JobRow, progress?: number): JobView {
  const view: JobView = { id: row.id, status: row.status };
  if (progress !== undefined) view.progress = progress;
  if (row.output) view.output = row.output;
  if (row.error) view.error = row.error;
  if (row.cost !== null) view.cost = row.cost;
  if (row.modelMicros !== null && row.feeMicros !== null) {
    view.charge = {
      model: row.modelMicros,
      fee: row.feeMicros,
      total: row.modelMicros + row.feeMicros,
    };
  }
  return view;
}

/**
 * Move a row, and settle its money when the move ends it. Every ending passes through here — a
 * refused submission, a failure the provider reports, a cancel, a finished result — so no ending
 * can leave a hold behind.
 */
async function setStatus(
  db: Db,
  row: JobRow,
  patch: Partial<
    Pick<JobRow, 'status' | 'output' | 'error' | 'cost' | 'providerId' | 'providerState'>
  >
): Promise<JobRow> {
  const [updated] = await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.id, row.id))
    .returning();
  const next = updated ?? { ...row, ...patch };
  return next.billing === 'held' ? settle(db, next) : next;
}

export async function getJob(id: string, workspaceId = LOCAL_WORKSPACE): Promise<JobRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/**
 * The row already answering an ask — queued, running or finished — or null. Never submits: this is
 * what a graph opening asks, so it gets back what was made and pays for nothing.
 */
export async function findJob(ask: JobAsk, workspaceId = LOCAL_WORKSPACE): Promise<JobRow | null> {
  return (await lookUp(ask, workspaceId)).found;
}

async function lookUp(ask: JobAsk, workspaceId: string) {
  const provider = getProvider();
  const model = provider.model(ask.task, ask.input);
  if (!model) throw new BadJobRequest(`${provider.id} cannot run ${ask.task || '(no task)'}`);
  const key = await jobKey(provider.id, ask.task, model, ask.input);

  const db = await getDb();
  const [found] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.key, key),
        inArray(jobs.status, ['queued', 'running', 'succeeded'] satisfies JobStatus[])
      )
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return { provider, model, key, db, found: found ?? null };
}

/**
 * The row that answers an ask: the one already holding its key, else a new one submitted now.
 *
 * A submission that fails is a failed row, not a thrown request: the failure is the job's, it is
 * recorded where the next ask can see it, and the browser reads it off the status like any other.
 *
 * With billing on, the estimate plus the fee is held in the same transaction as the insert, and a
 * balance that cannot cover it throws `InsufficientBalance` with no row written. An ask answered
 * by an existing row holds nothing: it was already paid for.
 */
export async function findOrSubmit(ask: JobAsk, workspaceId = LOCAL_WORKSPACE): Promise<JobRow> {
  const { provider, model, key, db, found } = await lookUp(ask, workspaceId);
  if (found) return found;

  const values = {
    id: jobId(),
    workspaceId,
    graphId: ask.graphId ?? null,
    nodeId: ask.nodeId ?? null,
    provider: provider.id,
    task: ask.task,
    model,
    key,
    status: 'queued' as const,
    input: ask.input,
  };

  let row: JobRow | undefined;
  if (billingEnabled()) {
    const estimate = estimateModelMicros(ask.task, ask.input);
    if (estimate === undefined) throw new BadJobRequest(`${ask.task} has no price yet, so it cannot run`);
    const charge = withFee(estimate);
    row = await db.transaction(async (tx) => {
      await hold(tx, workspaceId, values.id, charge);
      const [inserted] = await tx
        .insert(jobs)
        .values({ ...values, billing: 'held', holdMicros: charge.total })
        .returning();
      return inserted;
    });
  } else {
    [row] = await db.insert(jobs).values(values).returning();
  }
  if (!row) throw new Error('insert returned nothing');

  try {
    const submission = await provider.submit(asProviderJob(row));
    return await setStatus(db, row, {
      providerId: submission.providerId,
      providerState: submission.state ?? null,
    });
  } catch (error) {
    return setStatus(db, row, { status: 'failed', error: messageOf(error) });
  }
}

/**
 * Bring a row up to date with its provider. Nothing to do for a settled row. A pending one is
 * asked about, and a done one is finished here and now — its files fetched, stored and written
 * back — so that the poll which sees the end is the poll that delivers the result.
 */
export async function refresh(row: JobRow): Promise<{ row: JobRow; progress?: number }> {
  if (row.status !== 'queued' && row.status !== 'running') return { row };
  const provider = providerById(row.provider);
  const db = await getDb();
  if (!provider)
    return {
      row: await setStatus(db, row, { status: 'failed', error: `no provider ${row.provider}` }),
    };

  const job = asProviderJob(row);
  let status;
  try {
    status = await provider.status(job);
  } catch (error) {
    if (error instanceof JobFailed)
      return { row: await setStatus(db, row, { status: 'failed', error: error.message }) };
    throw error;
  }

  switch (status.kind) {
    case 'queued':
      return {
        row: row.status === 'queued' ? row : await setStatus(db, row, { status: 'queued' }),
      };
    case 'running':
      return {
        row: row.status === 'running' ? row : await setStatus(db, row, { status: 'running' }),
        progress: status.progress,
      };
    case 'failed':
      return { row: await setStatus(db, row, { status: 'failed', error: status.error }) };
    case 'done':
      return { row: await finish(db, row, provider, job) };
  }
}

async function finish(db: Db, row: JobRow, provider: Provider, job: ProviderJob): Promise<JobRow> {
  try {
    const { files, cost } = await provider.result(job);
    const output: Record<string, unknown> = {};
    for (const file of files) output[file.name] = await store(db, file, row.workspaceId);
    return await setStatus(db, row, { status: 'succeeded', output, cost: cost ?? null });
  } catch (error) {
    if (error instanceof JobFailed)
      return setStatus(db, row, { status: 'failed', error: error.message });
    // Transient: the row stays running and the next poll tries again.
    throw error;
  }
}

/** The bytes of a produced file: the ones it carries, else the ones at its URL. */
async function bytesOf(file: ProducedFile): Promise<Uint8Array<ArrayBuffer>> {
  if (file.bytes) return file.bytes;
  if (!file.url) throw new JobFailed(`the ${file.name} came with neither bytes nor a URL`);
  const res = await fetch(file.url);
  if (!res.ok) {
    const message = `fetching the ${file.name} answered ${res.status}`;
    throw res.status >= 400 && res.status < 500 ? new JobFailed(message) : new Error(message);
  }
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES)
    throw new JobFailed(`the ${file.name} is too large to store`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new JobFailed(`the ${file.name} is too large to store`);
  return bytes;
}

/**
 * Copy one produced file into storage and describe it. The bytes decide the type and the size
 * where they can — a provider's word about its own file is taken only where the header says
 * nothing, as a clip's does not for frames a second.
 */
async function store(db: Db, file: ProducedFile, workspaceId: string): Promise<MediaRef> {
  const bytes = await bytesOf(file);
  const probe = probeMedia(bytes);
  const mime = probe?.mime ?? file.mime ?? 'application/octet-stream';
  const width = probe?.width || file.width || 0;
  const height = probe?.height || file.height || 0;
  const duration = probe?.duration ?? file.duration;

  const hash = await sha256(bytes);
  const key = storageKey(hash, mime);
  const storage = getStorage();
  await storage.put(key, bytes, mime);
  await db
    .insert(assets)
    .values({
      id: hash,
      workspaceId,
      key,
      mime,
      bytes: bytes.byteLength,
      width,
      height,
      duration: duration ?? null,
    })
    .onConflictDoNothing();

  const url = storage.url(key);
  const ref: MediaRef = { kind: file.kind, hash, width, height, url, preview: url, mime };
  if (duration !== undefined) ref.duration = duration;
  if (file.fps !== undefined) ref.fps = file.fps;
  return ref;
}

/** Stop a pending job at the provider and say so on the row. A settled row is left as it is. */
export async function cancel(row: JobRow): Promise<JobRow> {
  if (row.status !== 'queued' && row.status !== 'running') return row;
  const db = await getDb();
  const provider = providerById(row.provider);
  if (provider) await provider.cancel(asProviderJob(row));
  return setStatus(db, row, { status: 'cancelled' });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
