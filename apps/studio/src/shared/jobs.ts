/**
 * A job as the browser sees it. The wire shape of `/api/jobs`, shared by the route that writes
 * it and the port that reads it, and nothing else: the row has more, and the browser needs none
 * of it.
 */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobView {
  id: string;
  status: JobStatus;
  /** 0..1 while running, when the provider says how far along it is. */
  progress?: number;
  /** The outputs, keyed by output socket, on `succeeded`. */
  output?: Record<string, unknown>;
  /** What went wrong, on `failed`. */
  error?: string;
  /** In credits, once known. */
  cost?: number;
}

/** Still going: worth asking again. */
export function isPending(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}
