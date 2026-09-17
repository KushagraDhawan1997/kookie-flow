/**
 * The agent's own choices: which language model plans and builds, and how hard it thinks. After
 * Krea Agent's "Auto · Medium" chip. The agent picks the image and video models itself, so those
 * are never offered here. MOCK: nothing reads these yet.
 */
import type { ProviderId } from './provider-logos';

export interface AgentModel {
  id: string;
  name: string;
  logo?: ProviderId;
}

/** Auto lets Studio choose per task. The rest are the Claude models the server calls. */
export const AGENT_MODELS: AgentModel[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', logo: 'claude' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', logo: 'claude' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', logo: 'claude' },
];

/** The Messages API's effort levels, in its own order. */
export const AGENT_EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
] as const;

export type AgentEffort = (typeof AGENT_EFFORTS)[number]['id'];
