'use client';

import * as React from 'react';
import {
  Button,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Separator,
} from '@kushagradhawan/kookie-ui-react';

import { AGENT_EFFORTS, AGENT_MODEL_GROUPS, AGENT_MODELS, AUTO_MODEL, type AgentSettings } from './agent-models';
import { AutoIcon, CheckIcon, ChevronDownIcon } from './icons';
import { ProviderLogo } from './provider-logos';

/** The last choice, so the box on Home and the panel in a graph start where the person left them. */
const STORAGE_KEY = 'studio:agent-settings';

export function readAgentSettings(fallback: AgentSettings): AgentSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && 'model' in parsed && 'effort' in parsed) {
      const effort = AGENT_EFFORTS.find((e) => e.id === parsed.effort)?.id;
      const model = AGENT_MODELS.find((m) => m.id === parsed.model)?.id;
      if (effort && model) return { model, effort };
    }
  } catch {
    // Private windows and blocked storage: the default stands.
  }
  return fallback;
}

function writeAgentSettings(settings: AgentSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered, which is fine: it is a convenience.
  }
}

interface AgentChoiceProps {
  value: AgentSettings;
  onChange: (value: AgentSettings) => void;
}

/**
 * The agent's brain and effort in one chip, as Krea Agent does it ("Auto · Medium"): a language model
 * from any provider, grouped by maker, and how hard it thinks.
 *
 * The models are rows rather than radio rows on purpose: a radio row spends its head on the dot's
 * gutter, and the maker's mark has to sit there — that mark is what tells the makers apart at a
 * glance, so it replaces the maker headings and carries the chosen state to a tick on the tail.
 * Effort keeps the radio dots, because a scale has nothing to draw.
 */
export function AgentChoice({ value, onChange }: AgentChoiceProps) {
  const model = AGENT_MODELS.find((m) => m.id === value.model) ?? AUTO_MODEL;
  const effortName = AGENT_EFFORTS.find((e) => e.id === value.effort)?.name ?? 'Medium';
  const change = (next: AgentSettings) => {
    writeAgentSettings(next);
    onChange(next);
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            emphasis="medium"
            leading={model.id === AUTO_MODEL.id ? <AutoIcon /> : <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} />}
            trailing={<ChevronDownIcon />}
          />
        }
      >
        {model.name} · {effortName}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem leading={<AutoIcon />} trailing={value.model === AUTO_MODEL.id ? <CheckIcon /> : null} onClick={() => change({ ...value, model: AUTO_MODEL.id })}>
          {AUTO_MODEL.name}
        </MenuItem>
        <Separator />
        {AGENT_MODEL_GROUPS.flatMap((group) => group.models).map((m) => (
          <MenuItem
            key={m.id}
            leading={<ProviderLogo provider={m.logo} maker={m.maker} name={m.name} decorative={false} />}
            trailing={value.model === m.id ? <CheckIcon /> : null}
            onClick={() => change({ ...value, model: m.id })}
          >
            {m.name}
          </MenuItem>
        ))}
        <Separator />
        <MenuGroup>
          <MenuLabel>Effort</MenuLabel>
          <MenuRadioGroup
            value={value.effort}
            onValueChange={(effort) => change({ ...value, effort: AGENT_EFFORTS.find((e) => e.id === effort)?.id ?? 'medium' })}
          >
            {AGENT_EFFORTS.map((e) => (
              <MenuRadioItem key={e.id} value={e.id}>
                {e.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
