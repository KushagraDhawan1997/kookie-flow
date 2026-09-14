/**
 * What a provider is, from the job pipeline's side.
 *
 * The pipeline owns the row, the storage and the answer to the browser. A provider owns only the
 * conversation with the service that makes the picture: hand it a job, ask how it is going, take
 * the files it made, tell it to stop. It never touches the database and never sees a MediaRef;
 * it describes the files it made and the pipeline stores them and writes the references.
 */

export type OutputKind = 'image' | 'mask' | 'video';

/** One file a job produced, before it is copied into storage. */
export interface ProducedFile {
  /** The output socket it lands on. */
  name: string;
  kind: OutputKind;
  /** Where the bytes are: a URL to fetch, or the bytes themselves. One of the two. */
  url?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  /** What the provider says about the file. What it leaves out is read from the bytes. */
  mime?: string;
  width?: number;
  height?: number;
  /** Seconds; video only. */
  duration?: number;
  fps?: number;
}

export type ProviderStatus =
  | { kind: 'queued'; position?: number }
  | { kind: 'running'; progress?: number }
  | { kind: 'done' }
  | { kind: 'failed'; error: string };

export interface Submission {
  /** The provider's own id for the request. */
  providerId: string;
  /** What the provider needs to be asked about the request later. Kept on the row. */
  state?: Record<string, unknown>;
}

/** A job as a provider sees it: the row's identity and what it remembers of the submission. */
export interface ProviderJob {
  id: string;
  task: string;
  model: string;
  input: Record<string, unknown>;
  providerId: string | null;
  state: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Provider {
  readonly id: string;
  /** The model or endpoint that answers a task with these inputs, or undefined for a task it cannot do. */
  model(task: string, input: Record<string, unknown>): string | undefined;
  submit(job: ProviderJob): Promise<Submission>;
  status(job: ProviderJob): Promise<ProviderStatus>;
  /** The files the job made. Only after `status` said done. */
  result(job: ProviderJob): Promise<{ files: ProducedFile[]; cost?: number }>;
  cancel(job: ProviderJob): Promise<void>;
}

/**
 * The job is over and asking again will not help: the provider refused the inputs, or has lost
 * the request. Anything else a provider throws is taken as passing — a network fault, a gateway
 * having a moment — and the row is left as it was for the next poll to try again.
 */
export class JobFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobFailed';
  }
}
