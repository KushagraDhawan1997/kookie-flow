'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Carousel,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRail,
  Composer,
  ComposerInput,
  ComposerRow,
  ComposerSend,
  Flex,
  Heading,
  Notice,
  Stack,
  Text,
  ToolbarButton,
} from '@kushagradhawan/kookie-ui-react';

import { AgentChoice, readAgentSettings } from '../../agent-choice';
import { AttachButton } from '../../attach-button';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../../agent-models';
import { ArrowRightIcon, BackIcon, CanvasIcon, RetryIcon, SendIcon, StopIcon } from '../../icons';
import { ProviderLogo } from '../../provider-logos';
import { ports } from '@/runtime/ports';
import { pendingAskKey, type PendingAsk } from '@/shared/agent';
import { AppPane } from '../app-shell';
import { fromPrice, MODELS, type Model } from '../models/models';
import { TemplateTile } from '../templates/templates-page';
import { TEMPLATES } from '../templates/templates';
import { STARTERS } from './starters';
import '../templates/templates.css';
import './home.css';

async function createGraph(name: string): Promise<string> {
  const res = await fetch('/api/graphs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.length > 60 ? `${name.slice(0, 57)}…` : name }),
  });
  if (!res.ok) throw new Error(await res.text());
  const body: unknown = await res.json();
  if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('The graph could not be created.');
  }
  return body.id;
}

const SEND_ICONS = { ready: <SendIcon />, submitted: <SendIcon />, streaming: <StopIcon />, error: <RetryIcon /> };

/**
 * Home says what Studio is in as few words as it can (plans/studio/vision.md, home-study.md): ask
 * the agent, with starters under the box as Manus has them, then the models and curated templates.
 * No fixed plan is shown: the agent decides the workflow after it has asked its questions.
 *
 * An ask opens a new graph named after it, with the agent's panel open and the ask already sent:
 * the conversation happens beside the canvas the agent builds on.
 */
export function HomePage() {
  const router = useRouter();
  const [ask, setAsk] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [settings, setSettings] = React.useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => setSettings(readAgentSettings(DEFAULT_AGENT_SETTINGS)), []);

  const open = async (name: string, pending: Omit<PendingAsk, 'pictures'> | null) => {
    setBusy(true);
    setProblem(null);
    try {
      // Pictures first: an upload that fails should stop here, before a graph exists for nothing.
      const pictures = pending
        ? await Promise.all(
            files
              .filter((f) => f.type.startsWith('image/'))
              .map(async (f) => {
                const ref = await ports.assets.put(f, 'image');
                return { hash: ref.hash, url: ref.url ?? '', mime: ref.mime ?? f.type, width: ref.width, height: ref.height };
              })
          )
        : [];
      const id = await createGraph(name);
      if (pending) {
        const value: PendingAsk = { ...pending, pictures };
        window.sessionStorage.setItem(pendingAskKey(id), JSON.stringify(value));
      }
      router.push(`/g/${id}`);
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : 'That could not start.');
    }
  };

  const send = () => {
    const text = ask.trim();
    if (!text) return;
    void open(text, { text, model: settings.model, effort: settings.effort });
  };

  const newGraph = (
    <ToolbarButton leading={<CanvasIcon />} onClick={() => void open('Untitled', null)}>
      New graph
    </ToolbarButton>
  );

  return (
    <AppPane actions={newGraph}>
      <Stack gap="9" className="kd-home">
        <Stack gap="7" className="kd-home-hero">
          <Heading size="9" render={<h1 />} className="kd-home-title">
            One ask. A whole workflow.
          </Heading>
          <Stack gap="4" align="center">
            <div className="kd-home-ask">
              <Composer
                size="3"
                onFiles={(dropped) => setFiles((current) => [...current, ...dropped])}
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <ComposerInput
                  aria-label="Ask the agent"
                  placeholder="I need to generate a gaming controller"
                  className="kd-home-ask-input"
                  rows={4}
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                />
                <ComposerRow>
                  <Flex gap="2" align="center">
                    <AttachButton onFiles={(picked) => setFiles((current) => [...current, ...picked])} />
                    <AgentChoice value={settings} onChange={setSettings} />
                    {files.length > 0 && (
                      <Text size="2" emphasis="medium">
                        {files.length} {files.length === 1 ? 'picture' : 'pictures'}
                      </Text>
                    )}
                  </Flex>
                  <ComposerSend status={busy ? 'submitted' : 'ready'} disabled={!ask.trim()} icons={SEND_ICONS} />
                </ComposerRow>
              </Composer>
            </div>
            <Flex gap="2" wrap="wrap" justify="center" role="group" aria-label="Starters">
              {STARTERS.map((s) => (
                <Button key={s.id} emphasis="quiet" bordered onClick={() => setAsk(s.ask)}>
                  {s.label}
                </Button>
              ))}
            </Flex>
            {problem && <Notice tone="destructive">{problem}</Notice>}
          </Stack>
        </Stack>

        <ModelsRow />
        <TemplatesRow />
      </Stack>
    </AppPane>
  );
}

/**
 * A row's head: its name, the two ways to move it, and the way to the whole list. The buttons sit
 * here rather than over the cards because the row bleeds to the pane's edges, where an overlaid
 * button would cover a cover.
 */
function SectionHead({ title, href }: { title: string; href: string }) {
  return (
    <Flex justify="space-between" align="center" gap="4">
      <Heading size="6" render={<h2 />}>
        {title}
      </Heading>
      <Flex gap="2" align="center">
        <CarouselPrevious aria-label={`Previous ${title.toLowerCase()}`}>
          <BackIcon />
        </CarouselPrevious>
        <CarouselNext aria-label={`Next ${title.toLowerCase()}`}>
          <ArrowRightIcon />
        </CarouselNext>
        <Button render={<NextLink href={href} />}>See all</Button>
      </Flex>
    </Flex>
  );
}

function ModelsRow() {
  return (
    <Carousel aria-label="Models">
      <Stack gap="4">
        <SectionHead title="Models" href="/models" />
        <CarouselRail fade className="kd-home-scroll">
          <div className="kd-home-row kd-home-row-wide">
            {MODELS.filter((m) => m.price).map((model) => (
              <CarouselItem key={model.slug}>
                <ModelCard model={model} />
              </CarouselItem>
            ))}
          </div>
        </CarouselRail>
      </Stack>
    </Carousel>
  );
}

function TemplatesRow() {
  return (
    <Carousel aria-label="Templates">
      <Stack gap="4">
        <SectionHead title="Templates" href="/templates" />
        <CarouselRail fade className="kd-home-scroll">
          <div className="kd-home-row">
            {TEMPLATES.map((template) => (
              <CarouselItem key={template.slug}>
                <TemplateTile template={template} summary={false} />
              </CarouselItem>
            ))}
          </div>
        </CarouselRail>
      </Stack>
    </Carousel>
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
