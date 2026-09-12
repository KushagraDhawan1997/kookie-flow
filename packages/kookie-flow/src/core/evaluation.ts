/**
 * The evaluation engine: what runs, in what order, with which inputs, and what happens after.
 *
 * THE LINE IT DOES NOT CROSS. `plans/entity-model.md` is explicit — the library orchestrates and
 * never computes. This file does not know what "blur an image" means. It knows that this entity's
 * inputs changed, that something should re-run it, that the result belongs on these output sockets,
 * and that the three entities downstream are now stale. The one function that computes is the
 * consumer's `onEvaluate`, and everything here exists to call it at the right moment with the
 * right values and to do the right thing with what comes back.
 *
 * WHY IT IS NOT IN THE STORE. Three reasons, in order of weight. First, it must be testable as
 * plain code: the whole lifecycle — dirty, running, cancelled, error, cascade, gate — is a set of
 * ordering claims, and ordering claims are exactly what a unit test pins and a browser test
 * cannot. Second, it holds an `AbortController` per in-flight run, which is not state anyone
 * renders. Third, the store already has the pattern: `cachedAnalysis` lives in the factory
 * closure for the same reason. The store owns the engine the way it owns that cache, and exposes
 * it through actions.
 *
 * WHERE VALUES LIVE. Output values live HERE, keyed `entityId:socketId`, separate from entity
 * data — entity data is configuration (what an entity IS), and a computed value is runtime state
 * that has a different lifetime and is not serialised with the graph. Input values are never
 * stored at all: they are RESOLVED at the moment of a run, which is what makes "connected reads
 * upstream, unconnected reads the widget" a single rule rather than a synchronisation problem.
 *
 * WHY STATUS IS HERE AND NOT ON `entity.data.status`. The component is controlled: `FlowSync`
 * replaces every entity on every prop change, so a status the library wrote into entity data
 * would be erased by the consumer's next echo — which arrives within a frame of any widget edit,
 * the very thing that starts an evaluation. So the engine keeps its own record and the renderer
 * reads `data.status ?? engine status`: the consumer's word wins where they have one, and the
 * engine fills in where they do not.
 *
 * THE INVARIANT THAT KEEPS `markDirty` CHEAP. Downstream of a dirty entity is always dirty,
 * because marking walks the subtree and nothing un-dirties an entity without also re-marking what
 * it feeds. So a mark that lands on an already-dirty entity stops there — its subtree is done —
 * and a slider drag, which marks the same entity on every pointermove, walks nothing after the
 * first move. That early exit is the reason this can sit behind `setWidgetValue`.
 */

import type { Entity, Socket } from '../types';
import { getIncomers, getOutgoers, type AdjacencyIndex } from './graph';

/** The states an entity moves through. `idle` is the state of never having been asked. */
export type EvaluationStatus = 'idle' | 'dirty' | 'running' | 'success' | 'error';

/** How an entity type answers a change in its inputs. */
export type EvaluationMode = 'reactive' | 'manual';

/** What the engine knows about one entity. */
export interface EvaluationRecord {
  status: EvaluationStatus;
  /**
   * When the status was last set, in `performance.now()` milliseconds. A renderer that animates a
   * state — the ring dissolving over the success hold — needs to know how far into it it is, and
   * the engine is the only party that knows when the state began.
   */
  since: number;
  /** The thrown error's message, on `error`. Cleared on the next mark. */
  message?: string;
  /** 0..1 as reported through `ctx.progress`, on `running`. */
  progress?: number;
}

/** What `onEvaluate` receives beside the inputs. */
export interface EvaluationContext {
  /** The entity being evaluated — its sockets, its data, its type — so a consumer switching on
   *  `entityType` alone is not forced to look the entity up again. */
  entity: Entity;
  /**
   * Aborted when the entity's inputs change mid-run. Pass it to a fetch; check it in a loop. A
   * result returned after abort is discarded, so honouring it is an optimisation, not a duty.
   */
  signal: AbortSignal;
  /** Report 0..1. Drives the running indicator; clamped, never required. */
  progress: (fraction: number) => void;
}

/** The consumer's one function. Return outputs keyed by output socket id, or nothing. */
export type OnEvaluate = (
  entityId: string,
  entityType: string,
  inputs: Record<string, unknown>,
  ctx: EvaluationContext
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

export type OnStatusChange = (entityId: string, status: EvaluationStatus, message?: string) => void;

/**
 * What the engine needs from whoever owns the graph. The store implements this; a test hands in a
 * literal. Every method is a read — the engine never writes to the graph.
 */
export interface EvaluationHost {
  getEntity(id: string): Entity | undefined;
  /** Every entity id in the graph, for `evaluateAll`. */
  entityIds(): Iterable<string>;
  index(): AdjacencyIndex;
  isMuted(id: string): boolean;
  evaluationMode(entity: Entity): EvaluationMode;
  /**
   * The value an UNCONNECTED input has: the widget's, or the socket's default. Owned by the host
   * because the local-override rule for widgets (utils/widget-values.ts) is the host's to apply.
   */
  readInputValue(entity: Entity, socket: Socket): unknown;
  /** Called after any change to a record or a value, so a renderer can notice. */
  onChange(): void;
}

/**
 * How long `success` shows before the record returns to `idle`.
 *
 * A held green ring on every entity that ever finished is noise on a board of a hundred nodes;
 * the flash says "that just ran" and then gets out of the way. Long enough to be seen at a glance,
 * short enough that a slider drag's cascade reads as activity rather than as a board turning
 * green and staying there.
 */
export const SUCCESS_HOLD_MS = 1500;

/** Monotonic milliseconds where the platform has them; wall-clock where it does not (SSR, old jsdom). */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Key for a stored output value. Same shape `connectedSockets` and `widgetKey` use. */
export function socketValueKey(entityId: string, socketId: string): string {
  return `${entityId}:${socketId}`;
}

interface Run {
  controller: AbortController;
  /** Monotonic per entity, so a result from a superseded run can be told from the current one. */
  id: number;
}

export class Evaluator {
  /** Output values by `entityId:socketId`. Read by anything that shows a computed value. */
  readonly socketValues = new Map<string, unknown>();
  /** One record per entity the engine has been told about. Absent means `idle`. */
  readonly records = new Map<string, EvaluationRecord>();

  private readonly host: EvaluationHost;
  private onEvaluate: OnEvaluate | null;
  private onStatusChange: OnStatusChange | null;

  private readonly dirty = new Set<string>();
  private readonly runs = new Map<string, Run>();
  private readonly holds = new Map<string, ReturnType<typeof setTimeout>>();
  private runCounter = 0;
  private scheduled = false;
  private disposed = false;
  /** Resolvers waiting for the engine to go quiet. See `settled`. */
  private waiters: Array<() => void> = [];

  constructor(host: EvaluationHost, onEvaluate?: OnEvaluate, onStatusChange?: OnStatusChange) {
    this.host = host;
    this.onEvaluate = onEvaluate ?? null;
    this.onStatusChange = onStatusChange ?? null;
  }

  /** The consumer's callbacks can change between renders; the engine does not rebuild for that. */
  setHandlers(onEvaluate?: OnEvaluate, onStatusChange?: OnStatusChange): void {
    // Handlers arriving mean a live consumer, so a disposed engine comes back. React's strict
    // mode runs every effect's cleanup and then the effect again on mount, and the flow's
    // cleanup is `dispose()`: without this, every development build with strict mode on had an
    // engine that answered nothing from its first frame (found 2026-09-12, from the studio).
    //
    // Lifting the flag is the whole revival, and only because `dispose` keeps the queue. It was
    // not enough on its own: the queue was cleared there, and an entity whose record already
    // reads dirty cannot be marked again, so a graph opened under strict mode sat stale with
    // every Run doing nothing. See `dispose` for why the note outlives the disposal.
    this.disposed = false;
    this.onEvaluate = onEvaluate ?? null;
    this.onStatusChange = onStatusChange ?? null;
    // Handlers arriving can change the answer for something already dirty: a graph mounted
    // before onEvaluate existed sat honestly stale, and a type table that just turned a gate
    // reactive has released it. A pass is due either way; it is a no-op if nothing is ready.
    this.schedule();
  }

  status(id: string): EvaluationStatus {
    return this.records.get(id)?.status ?? 'idle';
  }

  record(id: string): EvaluationRecord | undefined {
    return this.records.get(id);
  }

  getSocketValue(entityId: string, socketId: string): unknown {
    return this.socketValues.get(socketValueKey(entityId, socketId));
  }

  /**
   * Inject an output value from outside — a loaded result, a value from another system. The
   * entity itself is NOT re-run (it did not compute this); what it feeds is marked stale.
   */
  setSocketValue(entityId: string, socketId: string, value: unknown): void {
    this.socketValues.set(socketValueKey(entityId, socketId), value);
    this.markDirty(getOutgoers(this.host.index(), entityId));
    this.host.onChange();
  }

  /**
   * An entity's inputs changed. Marks it and everything downstream stale, cancels any run in
   * flight on any of them, and schedules a pass.
   */
  markDirty(ids: string | readonly string[]): void {
    if (this.disposed) return;
    const list = typeof ids === 'string' ? [ids] : ids;
    const index = this.host.index();
    let changed = false;

    // A manual stack rather than the generator in graph.ts, because this runs on every
    // pointermove of a slider drag and a generator allocates per step.
    const stack: string[] = [];
    for (const id of list) stack.push(id);

    while (stack.length > 0) {
      const id = stack.pop() as string;
      const rec = this.records.get(id);
      const status = rec?.status ?? 'idle';

      if (status === 'dirty') continue; // subtree already marked — the invariant
      if (status === 'running') {
        // Inputs changed under a run: the result would be for values that no longer exist.
        // Then on into its subtree like any other mark. A run started by `evaluate(id)` from a
        // settled state was never dirty, so its subtree was never marked, and stopping here left
        // downstream showing fresh on a stale input.
        this.abort(id);
      }

      this.setStatus(id, 'dirty');
      changed = true;
      for (const next of getOutgoers(index, id)) stack.push(next);
    }

    if (changed) this.schedule();
  }

  /**
   * Run one entity now, whatever its mode, with its inputs as they currently resolve. Then let
   * reactive entities downstream cascade. This is the manual trigger — "Run" on a generate node.
   */
  async evaluate(id: string): Promise<void> {
    if (this.disposed) return;
    const entity = this.host.getEntity(id);
    if (!entity) return;
    this.dirty.delete(id);
    await this.start(entity, true);
  }

  /** Run every dirty entity, manual gates included, and wait for the graph to go quiet. */
  async evaluateDirty(): Promise<void> {
    if (this.disposed) return;
    const gates: string[] = [];
    for (const id of this.dirty) {
      const entity = this.host.getEntity(id);
      if (entity && this.host.evaluationMode(entity) === 'manual') gates.push(id);
    }
    // Opening every gate at once is correct: each waits for its own upstream to settle in
    // `flush`, and the gates themselves are what `evaluateDirty` exists to open.
    for (const id of gates) this.forced.add(id);
    this.schedule();
    await this.settled();
  }

  /** Mark the whole graph stale and run all of it. */
  async evaluateAll(): Promise<void> {
    if (this.disposed) return;
    const all: string[] = [];
    for (const id of this.host.entityIds()) all.push(id);
    this.markDirty(all);
    await this.evaluateDirty();
  }

  /**
   * Resolve the inputs an entity would be evaluated with right now.
   *
   * Connected → the upstream output. Unconnected → the host's answer (widget, then default). An
   * input with several incoming edges takes the first; a value arriving through two wires at
   * once is a graph the consumer's validation should have refused.
   */
  resolveInputs(entity: Entity): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const sockets = entity.inputs;
    if (!sockets) return inputs;
    const incoming = this.host.index().incoming.get(entity.id);
    for (const socket of sockets) {
      const edges = incoming?.get(socket.id);
      const edge = edges && edges.length > 0 ? edges[0] : undefined;
      if (edge && edge.sourceSocket !== undefined) {
        inputs[socket.id] = this.socketValues.get(socketValueKey(edge.source, edge.sourceSocket));
      } else {
        inputs[socket.id] = this.host.readInputValue(entity, socket);
      }
    }
    return inputs;
  }

  /** A promise that resolves once nothing is running and nothing runnable is waiting. */
  settled(): Promise<void> {
    if (this.quiet()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Cancel everything in flight and drop every timer. The store calls this on unmount.
   *
   * WHAT IT KEEPS, AND WHY. The queue of stale entities survives, and a run that was abandoned
   * goes back into it. `disposed` is what stops work from starting; `dirty` is only the note of
   * what to do when that lifts, and the note cannot be rewritten later — `markDirty` stops at a
   * record that already reads dirty (the invariant that makes a slider drag cheap), so anything
   * cleared here could never be marked again. React's strict mode disposes and revives this
   * engine between a mark and the microtask that would have acted on it, which is exactly that
   * case: with the queue dropped, every node of a freshly opened graph sat stale for good and
   * Run did nothing.
   *
   * An abandoned run is demoted rather than left running. Its result is discarded when it
   * arrives (`start` checks `runs`), so the entity is stale again, not finished — and a record
   * left `running` blocks everything downstream of it through `upstreamSettled`. The demotion
   * comes after the abort, because `abort` only drops the run and `setStatus('dirty')` is what
   * puts the entity back in the queue.
   */
  dispose(): void {
    for (const id of [...this.runs.keys()]) {
      this.abort(id);
      this.setStatus(id, 'dirty');
    }
    this.disposed = true;
    for (const t of this.holds.values()) clearTimeout(t);
    this.holds.clear();
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /**
   * Entities that are gone: their runs stopped, their records and output values dropped. Kept, a
   * node that produced a picture and was then deleted held that picture for the life of the store.
   */
  forget(ids: Iterable<string>): void {
    const prefixes: string[] = [];
    for (const id of ids) {
      this.abort(id);
      this.clearHold(id);
      this.dirty.delete(id);
      this.forced.delete(id);
      this.records.delete(id);
      prefixes.push(socketValueKey(id, ''));
    }
    if (prefixes.length === 0) return;
    for (const key of this.socketValues.keys()) {
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          this.socketValues.delete(key);
          break;
        }
      }
    }
    this.notifyIfQuiet();
  }

  /**
   * A pass, though nothing new was marked. For a change to what GATES a pass rather than to what
   * is stale: a type table that turned a manual type reactive has released entities that are
   * already dirty, and marking them again is the no-op the invariant promises.
   */
  wake(): void {
    this.schedule();
  }

  // ── Internals ────────────────────────────────────────────────────────

  /** Manual entities `evaluateDirty` has opened; consumed by `flush`. */
  private readonly forced = new Set<string>();

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    // A microtask, so a burst of marks in one event — a paste, a batch of edge changes — is
    // one pass, and a run never starts inside the store mutation that made it necessary.
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /**
   * Start every dirty entity whose inputs are settled and whose mode allows it.
   *
   * Order is not needed: readiness gating enforces it. An entity starts only when nothing it
   * reads from is dirty or running, so a chain runs front to back by construction and siblings
   * run at once. Iterating the dirty set rather than the topological order keeps a pass
   * proportional to what is stale, not to the graph.
   */
  private flush(): void {
    if (this.disposed) return;
    const index = this.host.index();
    const ready: Entity[] = [];

    for (const id of this.dirty) {
      const entity = this.host.getEntity(id);
      if (!entity) {
        // Deleted while dirty.
        this.dirty.delete(id);
        this.records.delete(id);
        continue;
      }
      const forced = this.forced.has(id);
      if (!forced && this.host.evaluationMode(entity) === 'manual') continue; // a gate
      if (!this.upstreamSettled(index, id)) continue;
      ready.push(entity);
    }

    for (const entity of ready) {
      const forced = this.forced.delete(entity.id);
      void this.start(entity, forced);
    }

    this.notifyIfQuiet();
  }

  /**
   * Whether everything an entity reads from has a value it can trust.
   *
   * Dirty or running upstream: no — wait. Error upstream: also no. Running a node on the stale
   * output of a node that just failed produces a result that looks fine and is wrong; the failed
   * node holds the chain until it is fixed, and its downstream stays visibly stale meanwhile.
   */
  private upstreamSettled(index: AdjacencyIndex, id: string): boolean {
    for (const up of getIncomers(index, id)) {
      const s = this.status(up);
      if (s === 'dirty' || s === 'running' || s === 'error') return false;
    }
    return true;
  }

  private async start(entity: Entity, _forced: boolean): Promise<void> {
    const id = entity.id;
    this.dirty.delete(id);
    this.abort(id);
    this.clearHold(id);

    // A muted entity is a wire: inputs pass straight to outputs by position, no consumer call,
    // no async, no error. The graph engine already treats muted ids as pass-through when it
    // orders execution; this is the value-level half of the same rule.
    if (this.host.isMuted(id)) {
      const inputs = this.resolveInputs(entity);
      const inSockets = entity.inputs ?? [];
      const outSockets = entity.outputs ?? [];
      const n = Math.min(inSockets.length, outSockets.length);
      for (let i = 0; i < n; i++) {
        this.socketValues.set(socketValueKey(id, outSockets[i].id), inputs[inSockets[i].id]);
      }
      this.finish(id, 'success');
      this.propagate(id);
      return;
    }

    if (!this.onEvaluate) {
      // No consumer function: there is nothing to run. Stay dirty so the indicator is honest —
      // the inputs did change and nothing has answered — but do not spin.
      this.setStatus(id, 'dirty');
      this.dirty.add(id);
      this.notifyIfQuiet();
      return;
    }

    const run: Run = { controller: new AbortController(), id: ++this.runCounter };
    this.runs.set(id, run);
    this.setStatus(id, 'running');

    const inputs = this.resolveInputs(entity);
    const ctx: EvaluationContext = {
      entity,
      signal: run.controller.signal,
      progress: (fraction) => {
        if (this.runs.get(id) !== run) return;
        const rec = this.records.get(id);
        if (rec) rec.progress = Math.min(1, Math.max(0, fraction));
        this.host.onChange();
      },
    };

    let outputs: Record<string, unknown> | void;
    try {
      outputs = await this.onEvaluate(id, entity.type, inputs, ctx);
    } catch (err) {
      if (this.runs.get(id) !== run) return; // superseded; the newer run owns the record
      this.runs.delete(id);
      this.finish(id, 'error', err instanceof Error ? err.message : String(err));
      this.notifyIfQuiet();
      return;
    }

    if (this.runs.get(id) !== run) return; // inputs changed mid-run; result discarded
    this.runs.delete(id);

    if (outputs) {
      for (const key of Object.keys(outputs)) {
        this.socketValues.set(socketValueKey(id, key), outputs[key]);
      }
    }
    this.finish(id, 'success');
    this.propagate(id);
  }

  /** After a run lands, what this entity feeds is stale and a pass is due. */
  private propagate(id: string): void {
    const outgoers = getOutgoers(this.host.index(), id);
    // Downstream was marked dirty when this entity was; marking again is the no-op the invariant
    // promises. What matters is the schedule: with this entity settled, they may now be ready.
    if (outgoers.length > 0) this.markDirty(outgoers);
    this.schedule();
  }

  private finish(id: string, status: 'success' | 'error', message?: string): void {
    this.setStatus(id, status, message);
    if (status === 'success') {
      this.holds.set(
        id,
        setTimeout(() => {
          this.holds.delete(id);
          if (this.status(id) === 'success') this.setStatus(id, 'idle');
        }, SUCCESS_HOLD_MS)
      );
    }
  }

  private setStatus(id: string, status: EvaluationStatus, message?: string): void {
    let rec = this.records.get(id);
    if (!rec) {
      // Born idle, then transitioned, so the FIRST change on an entity is reported like every
      // other. Creating the record already holding the new status made prev === status below
      // and swallowed the initial `dirty` for every entity in the graph.
      rec = { status: 'idle', since: 0 };
      this.records.set(id, rec);
    }
    const prev = rec.status;
    rec.status = status;
    rec.since = now();
    rec.message = message;
    if (status !== 'running') rec.progress = undefined;

    if (status === 'dirty') this.dirty.add(id);
    else this.dirty.delete(id);
    if (status !== 'success') this.clearHold(id);

    if (prev !== status || message !== undefined) {
      this.onStatusChange?.(id, status, message);
    }
    this.host.onChange();
  }

  private abort(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    this.runs.delete(id);
    run.controller.abort();
  }

  private clearHold(id: string): void {
    const t = this.holds.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.holds.delete(id);
    }
  }

  /** Nothing running, nothing scheduled, and nothing dirty that a pass could start. */
  private quiet(): boolean {
    if (this.runs.size > 0 || this.scheduled) return false;
    // Dirty entities that are gated or blocked are quiet: nothing will move without a new event.
    return true;
  }

  private notifyIfQuiet(): void {
    if (!this.quiet() || this.waiters.length === 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}
