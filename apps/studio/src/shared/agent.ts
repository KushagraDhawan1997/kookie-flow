/**
 * What the agent's browser tools answer with, shared by the editor that runs them and the route that
 * reads the answers back (the inspect tool turns its answer into a picture for the model there).
 */

export interface ApplyOpsOutput {
  created: string[];
  errors: Array<{ index: number; message: string }>;
}

export interface EstimateOutput {
  nodes: Array<{ id: string; label: string; micros: number; price: string }>;
  totalMicros: number;
  total: string;
}

export interface RunOutput {
  /** The person declined the price; nothing ran. */
  declined?: boolean;
  nodes: Array<{ id: string; label: string; status: string; error?: string }>;
}

export type InspectOutput =
  | { node: string; socket: string; hash: string; mime: string; width: number; height: number }
  | { node: string; error: string };

/** The route's request body beside the chat's own fields. */
export interface AgentRequestBody {
  model: string;
  effort: string;
}

/** Where a message from Home waits for the editor to open, keyed by graph id. */
export function pendingAskKey(graphId: string): string {
  return `studio:agent-ask:${graphId}`;
}

export interface PendingAsk {
  text: string;
  model: string;
  effort: string;
  /** Pictures attached on Home, already stored. */
  pictures: Array<{ hash: string; url: string; mime: string; width: number; height: number }>;
}
