/**
 * What a node's `run` can reach. The app implements these; a test hands in fakes.
 *
 * A node never touches a worker, a fetch or a file. It asks a port, and the port is the one place
 * that knows whether the GPU is in a worker, whether a job goes to fal or to a mock, and where a
 * stored picture ends up.
 */

import type { MediaRef } from './values';

export interface GpuRunOptions {
  width?: number;
  height?: number;
}

export interface GpuPort {
  /** Run one shader op on some inputs and get a GPU-resident result. */
  run(
    op: string,
    params: Record<string, unknown>,
    inputs: readonly MediaRef[],
    options?: GpuRunOptions
  ): Promise<MediaRef>;
  /** Load a picture from a URL or bytes into the GPU and get its reference. */
  load(source: string | Blob): Promise<MediaRef>;
}

export interface MediaPort {
  /** Placeholder until phase 7: video operations through Mediabunny. */
  notYet(): never;
}

export interface JobRequest {
  entityId: string;
  /** The model or task id in the provider registry. */
  model: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  progress?: (fraction: number) => void;
}

export interface JobResult {
  output: Record<string, unknown>;
  cost?: number;
}

export interface JobsPort {
  /** Submit and wait. Resolves with the outputs once the result has been copied to storage. */
  run(request: JobRequest): Promise<JobResult>;
}

export interface AssetsPort {
  /** Store bytes and get a media reference for them. */
  put(blob: Blob, kind?: MediaRef['kind']): Promise<MediaRef>;
}

export interface Ports {
  gpu: GpuPort;
  media: MediaPort;
  jobs: JobsPort;
  assets: AssetsPort;
}

export interface RunContext extends Ports {
  entityId: string;
  /** Aborted when the inputs change mid-run. */
  signal: AbortSignal;
  /** Report 0..1. */
  progress(fraction: number): void;
}

/** The error a port throws for something it cannot do yet. Surfaces as the node's status. */
export class NotAvailableError extends Error {
  constructor(what: string) {
    super(`${what} is not available yet`);
    this.name = 'NotAvailableError';
  }
}
