'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Composer,
  ComposerInput,
  ComposerRow,
  ComposerSend,
  Flex,
  Heading,
  Menu,
  MenuContent,
  MenuGroup,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Notice,
  Stack,
  Text,
  ToolbarButton,
} from '@kookie-ui/react';

import { AGENT_EFFORTS, AGENT_MODELS, type AgentEffort } from '../../agent-models';
import { CanvasIcon, ChevronDownIcon, PlusIcon, RetryIcon, SendIcon, StopIcon } from '../../icons';
import { ProviderLogo } from '../../provider-logos';
import { AppPane } from '../app-shell';
import { dollars, findModel, fromPrice, MODELS, type Model } from '../models/models';
import { TemplateTile } from '../templates/templates-page';
import { TEMPLATES } from '../templates/templates';
import { planTotal, STARTERS, type PlanStep, type Starter } from './plans';
import '../templates/templates.css';
import './home.css';

/** Make a graph under a name and open it. The mock behind every "start" on Home until the agent exists. */
function useStartGraph() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const start = async (name: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.length > 60 ? `${name.slice(0, 57)}…` : name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      router.push(`/g/${id}`);
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : 'That could not start.');
    }
  };
  return { busy, problem, start };
}

const SEND_ICONS = { ready: <SendIcon />, submitted: <SendIcon />, streaming: <StopIcon />, error: <RetryIcon /> };

/**
 * Home says what Studio is, in as few words as it can (plans/studio/vision.md, home-study.md):
 * one ask becomes a workflow, on every model, at each model's price. It shows rather than tells:
 * the plan for the chosen starter is drawn, not described. Models and curated templates follow.
 *
 * MOCK: asking or building makes a graph under the ask's name, since the agent does not exist yet.
 */
export function HomePage() {
  const { busy, problem, start } = useStartGraph();
  const [starter, setStarter] = React.useState<Starter>(STARTERS[0]);
  const [ask, setAsk] = React.useState('');

  const choose = (next: Starter) => {
    setStarter(next);
    setAsk(next.ask);
  };

  const newGraph = (
    <ToolbarButton leading={<CanvasIcon />} onClick={() => void start('Untitled')}>
      New graph
    </ToolbarButton>
  );

  return (
    <AppPane actions={newGraph}>
      <Stack gap="9" className="kd-home">
        <Stack gap="7" className="kd-home-hero">
          <Heading size="8" render={<h1 />} className="kd-home-title">
            One ask. A whole workflow.
          </Heading>
          <Stack gap="4" align="center">
            <div className="kd-home-ask">
              <Ask ask={ask} onAsk={setAsk} busy={busy} onSubmit={() => void start(ask.trim())} />
            </div>
            <Flex gap="2" wrap="wrap" justify="center" role="group" aria-label="Starters">
              {STARTERS.map((s) => (
                <Button
                  key={s.id}
                  emphasis={s.id === starter.id ? 'medium' : 'quiet'}
                  bordered={s.id !== starter.id}
                  aria-pressed={s.id === starter.id}
                  onClick={() => choose(s)}
                >
                  {s.label}
                </Button>
              ))}
            </Flex>
            {problem && <Notice tone="destructive">{problem}</Notice>}
          </Stack>
          <Plan starter={starter} busy={busy} onBuild={() => void start(starter.ask)} />
        </Stack>

        <ModelsRow />
        <TemplatesRow />
      </Stack>
    </AppPane>
  );
}

interface AskProps {
  ask: string;
  onAsk: (ask: string) => void;
  busy: boolean;
  onSubmit: () => void;
}

function Ask({ ask, onAsk, busy, onSubmit }: AskProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);
  return (
    <Composer
      size="3"
      onFiles={(dropped) => setFiles((current) => [...current, ...dropped])}
      onSubmit={(event) => {
        event.preventDefault();
        if (ask.trim()) onSubmit();
      }}
    >
      <ComposerInput
        aria-label="Describe what you need"
        placeholder="Describe what you need"
        rows={2}
        value={ask}
        onChange={(e) => onAsk(e.target.value)}
      />
      <ComposerRow>
        <Flex gap="2" align="center">
          <Button iconOnly emphasis="quiet" aria-label="Attach pictures" onClick={() => fileInput.current?.click()}>
            <PlusIcon />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? [])])}
          />
          <AgentChoice />
          {files.length > 0 && (
            <Text size="2" emphasis="medium">
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </Text>
          )}
        </Flex>
        <ComposerSend
          status={busy ? 'submitted' : 'ready'}
          disabled={!ask.trim()}
          // Kookie ships no icon set, so the glyph for each state is the app's to give.
          icons={SEND_ICONS}
        />
      </ComposerRow>
    </Composer>
  );
}

/**
 * The agent's brain and effort in one chip, as Krea Agent does it ("Auto · Medium"): a language
 * model and how hard it thinks. Image and video models are the agent's to pick, so they are not here.
 */
function AgentChoice() {
  const [model, setModel] = React.useState('auto');
  const [effort, setEffort] = React.useState<AgentEffort>('medium');
  const modelName = AGENT_MODELS.find((m) => m.id === model)?.name ?? 'Auto';
  const effortName = AGENT_EFFORTS.find((e) => e.id === effort)?.name ?? 'Medium';
  return (
    <Menu>
      <MenuTrigger render={<Button emphasis="quiet" trailing={<ChevronDownIcon />} />}>
        {modelName} · {effortName}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuGroup>
          <MenuLabel>Model</MenuLabel>
          <MenuRadioGroup value={model} onValueChange={(value) => setModel(String(value))}>
            {AGENT_MODELS.map((m) => (
              <MenuRadioItem key={m.id} value={m.id}>
                {m.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <MenuLabel>Effort</MenuLabel>
          <MenuRadioGroup value={effort} onValueChange={(value) => setEffort(AGENT_EFFORTS.find((e) => e.id === value)?.id ?? 'medium')}>
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

/**
 * The workflow the agent would build for the chosen starter, drawn as a graph reads: left to right,
 * each step a picture of what it makes, with its model and what it costs.
 */
function Plan({ starter, busy, onBuild }: { starter: Starter; busy: boolean; onBuild: () => void }) {
  const video = starter.steps.some((step) => findModel(step.model ?? '')?.kind === 'video');
  return (
    <Stack gap="4" render={<section />} aria-label="The agent's plan">
      <ol className="kd-plan" data-video={video || undefined}>
        {starter.steps.map((step, i) => (
          <PlanNode key={`${starter.id}-${i}`} starter={starter.id} step={step} />
        ))}
      </ol>
      <Flex justify="space-between" align="center" gap="4">
        <Text size="3" weight="medium" className="kd-num">
          About {roughly(planTotal(starter.steps))}
        </Text>
        <Button loading={busy} onClick={onBuild}>
          Build this
        </Button>
      </Flex>
    </Stack>
  );
}

/** A total said with "about": cents are enough once it passes a dime. */
function roughly(amount: number): string {
  return amount >= 0.1 ? `$${amount.toFixed(2)}` : dollars(amount);
}

function PlanNode({ starter, step }: { starter: string; step: PlanStep }) {
  const model = step.model && step.model !== 'agent' ? findModel(step.model) : undefined;
  const price = step.each !== undefined ? (step.runs ?? 1) * step.each : undefined;
  return (
    <li className="kd-plan-step" data-kind={step.kind}>
      <PlanPicture starter={starter} step={step} />
      <Stack gap="1">
        <Text size="2" weight="medium">
          {step.title}
        </Text>
        <Flex justify="space-between" align="center" gap="2">
          <Flex gap="2" align="center" className="kd-plan-model">
            {step.model === 'agent' && (
              <>
                <ProviderLogo provider="claude" maker="Anthropic" name="Claude" />
                <Text size="2" emphasis="medium">
                  Claude
                </Text>
              </>
            )}
            {model && (
              <>
                <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} />
                <Text size="2" emphasis="medium" className="kd-plan-name">
                  {model.name}
                </Text>
              </>
            )}
          </Flex>
          {price !== undefined && (
            <Text size="2" className="kd-num kd-plan-price">
              {dollars(price)}
            </Text>
          )}
        </Flex>
      </Stack>
    </li>
  );
}

/**
 * The picture of what the step makes. It loads `public/home/<starter>/<step>.webp` and stays a plain
 * grey slot until that file exists (plans/studio/home-images.md lists them).
 */
function PlanPicture({ starter, step }: { starter: string; step: PlanStep }) {
  const [missing, setMissing] = React.useState(false);
  return (
    <div className="kd-plan-picture">
      {!missing && (
        // A plain img: a missing file must fall back to the slot, which next/image cannot do quietly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/home/${starter}/${step.kind}.webp`}
          alt=""
          // A 404 can land before hydration, when onError is not yet listening.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setMissing(true);
          }}
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}

function SectionHead({ title, href }: { title: string; href: string }) {
  return (
    <Flex justify="space-between" align="center" gap="4">
      <Heading size="6" render={<h2 />}>
        {title}
      </Heading>
      <Button render={<NextLink href={href} />}>See all</Button>
    </Flex>
  );
}

function ModelsRow() {
  return (
    <Stack gap="4">
      <SectionHead title="Models" href="/models" />
      <div className="kd-home-row kd-home-row-wide">
        {MODELS.filter((m) => m.price).map((model) => (
          <ModelCard key={model.slug} model={model} />
        ))}
      </div>
    </Stack>
  );
}

function TemplatesRow() {
  return (
    <Stack gap="4">
      <SectionHead title="Templates" href="/templates" />
      <div className="kd-home-row">
        {TEMPLATES.map((template) => (
          <TemplateTile key={template.slug} template={template} summary={false} />
        ))}
      </div>
    </Stack>
  );
}

/** A model to try: its mark, its name, its cheapest run. */
function ModelCard({ model }: { model: Model }) {
  return (
    <NextLink href={`/models/${model.slug}`} className="kd-home-model">
      <span className="kd-home-model-logo">
        <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} />
      </span>
      <Stack gap="1">
        <Heading size="5" render={<span />}>
          {model.name}
        </Heading>
        {model.price && (
          <Text size="2" emphasis="medium" className="kd-num">
            {fromPrice(model.price)}
          </Text>
        )}
      </Stack>
    </NextLink>
  );
}
