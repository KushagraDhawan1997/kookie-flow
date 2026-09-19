/**
 * The agent's menu: the language models from `studio-core`'s list, grouped by maker, and the effort
 * scale. After Krea Agent's "Auto · Medium" chip. The agent picks image and video models itself, so
 * those are never offered here.
 */
import { AGENT_EFFORTS, AGENT_MODELS as CORE_MODELS, AUTO_AGENT_MODEL, type AgentEffort } from 'studio-core';
import type { ProviderId } from './provider-logos';

export interface AgentModelChoice {
  id: string;
  name: string;
  /** The maker's name: the mark's accessible name, and the fallback initial's source. */
  maker: string;
  logo?: ProviderId;
}

export interface AgentModelGroup {
  maker: string;
  models: AgentModelChoice[];
}

export const AUTO_MODEL: AgentModelChoice = { id: AUTO_AGENT_MODEL, name: 'Auto', maker: 'Studio' };

const LOGO: Record<string, ProviderId> = { anthropic: 'claude', openai: 'openai' };

export const AGENT_MODEL_GROUPS: AgentModelGroup[] = [...new Set(CORE_MODELS.map((m) => m.maker))].map((maker) => ({
  maker,
  models: CORE_MODELS.filter((m) => m.maker === maker).map((m) => ({ id: m.id, name: m.name, maker, logo: LOGO[m.provider] })),
}));

export const AGENT_MODELS: AgentModelChoice[] = [AUTO_MODEL, ...AGENT_MODEL_GROUPS.flatMap((g) => g.models)];

export { AGENT_EFFORTS, type AgentEffort };

export interface AgentSettings {
  model: string;
  effort: AgentEffort;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { model: AUTO_MODEL.id, effort: 'medium' };
