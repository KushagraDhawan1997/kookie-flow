import type { EvaluationStatus } from '@kushagradhawan/kookie-flow';

/**
 * What the panes need to know about the canvas that is not graph data: which nodes are selected,
 * and what the engine last said about each node. Both live in the flow store and the engine, not
 * in React state, and both change often — selection on every click, status on every node of a
 * cascade.
 *
 * IT WAKES A PANE ONLY FOR WHAT THAT PANE SHOWS. The inspector reads one node, so a cascade
 * through fifty others is none of its business: a slider drag feeding a chain used to re-render
 * the inspector sixty times a second for a node nobody was looking at. Every status is still
 * recorded — the pane must be right the moment a different node is selected — but only a change
 * to the selected node's own status, or to the selection itself, is worth a frame.
 */
export class EditorBus {
  private readonly listeners = new Set<() => void>();
  private readonly messages = new Map<string, string>();
  private readonly statuses = new Map<string, EvaluationStatus>();
  private frame = 0;
  /** Selected entity ids, in the store's order. The array is replaced, never mutated. */
  selected: readonly string[] = [];

  /** The engine's `onStatusChange`. Cheap: two map writes and, rarely, one RAF request. */
  readonly onStatusChange = (entityId: string, status: EvaluationStatus, message?: string): void => {
    const hadStatus = this.statuses.get(entityId);
    const hadMessage = this.messages.get(entityId);
    this.statuses.set(entityId, status);
    if (status === 'error' && message) this.messages.set(entityId, message);
    else if (status !== 'error') this.messages.delete(entityId);
    if (entityId !== this.selected[0]) return;
    if (status === hadStatus && this.messages.get(entityId) === hadMessage) return;
    this.schedule();
  };

  /** The store's selection, from the bridge inside the canvas. */
  setSelection(ids: Iterable<string>): void {
    const next = [...ids];
    if (next.length === this.selected.length && next.every((id, i) => id === this.selected[i])) return;
    this.selected = next;
    this.schedule();
  }

  /** Drop what is remembered about nodes that no longer exist. */
  forget(ids: Iterable<string>): void {
    for (const id of ids) {
      this.messages.delete(id);
      this.statuses.delete(id);
    }
  }

  message(entityId: string): string | undefined {
    return this.messages.get(entityId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      for (const l of this.listeners) l();
    });
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.listeners.clear();
  }
}
