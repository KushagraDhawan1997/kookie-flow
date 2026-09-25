'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { useChat } from '@ai-sdk/react';
import type { Chat } from '@ai-sdk/react';
import { getToolName, isTextUIPart, isToolUIPart, type UIMessage } from 'ai';
import {
  Button,
  Composer,
  ComposerInput,
  ComposerRow,
  ComposerSend,
  Confirmation,
  Flex,
  Link,
  Notice,
  ShellPaneFooter,
  Spinner,
  Stack,
  Text,
} from '@kushagradhawan/kookie-ui-react';

import { AgentChoice } from '@/app/agent-choice';
import { AttachButton } from '@/app/attach-button';
import { Conversation, Pictures, Reply, Step, Steps, Thinking, Turn, UserMessage } from '@/app/conversation';
import { EmptyState } from '@/app/empty-state';
import { ArrowDownIcon, RetryIcon, SendIcon, StopIcon } from '@/app/icons';
import { picturesOf, withoutPictures, type AgentSession, type AgentSessionState, type PendingRun } from './session';
import './agent-panel.css';

const SEND_ICONS = { ready: <SendIcon />, submitted: <SendIcon />, streaming: <StopIcon />, error: <RetryIcon /> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The agent, beside the canvas it builds on (FAUNA's sidebar, Krea's Node Agent). A view of the
 * graph's `AgentSession`: the conversation outlives the panel, so closing the pane or switching to
 * Inspect loses nothing.
 */
export function AgentPanel({ session }: { session: AgentSession }) {
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);

  React.useEffect(() => {
    void session.start();
  }, [session]);

  if (state.loadError) return <EmptyState title="The agent is unavailable" description={state.loadError} />;
  if (!state.chat) {
    return (
      <Flex className="kd-agent-loading" align="center" justify="center">
        <Spinner aria-label="Loading the conversation" />
      </Flex>
    );
  }
  return <AgentChat session={session} state={state} chat={state.chat} />;
}

/** A failed request answers with `{ error }`; the chat hands back the body as the message. */
function readable(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const body: unknown = JSON.parse(error.message);
    if (isRecord(body) && typeof body.error === 'string') return body.error;
  } catch {
    // Not JSON: the message is already words.
  }
  return error.message;
}

function AgentChat({ session, state, chat }: { session: AgentSession; state: AgentSessionState; chat: Chat<UIMessage> }) {
  const { messages, status, error, stop, regenerate } = useChat({ chat });
  const [text, setText] = React.useState('');


  const thinking = status === 'submitted' || status === 'streaming';
  const blocked = thinking || state.running || state.pendingRun !== null;
  // A model reasoning streams nothing to show (Claude and GPT hand back empty or no reasoning text), so
  // the panel says it is thinking until words or a tool call arrive.
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  // A reply whose last block is a run of steps shows its own live line, so "Thinking" would say it twice.
  const stepsLive = thinking && last?.role === 'assistant' && blocksOf(last).at(-1)?.kind === 'steps';
  const quiet =
    !stepsLive &&
    (status === 'submitted' ||
      (status === 'streaming' && (!lastPart || lastPart.type === 'step-start' || lastPart.type === 'reasoning')));
  const send = () => {
    if (!text.trim() || blocked) return;
    session.send(text);
    setText('');
  };
  const problem = readable(error);

  return (
    <>
      {/* The transcript follows its live edge and anchors each new ask near the top, as chats do; the
          scroller fades under the floating tabs above and at the end below. */}
      <Conversation
        pane
        aria-label="Conversation"
        jumpLabel="Jump to the latest"
        jumpIcon={<ArrowDownIcon />}
        empty={
          <EmptyState
            size="3"
            title="Ask the agent"
            description={state.mode === 'mock' ? 'Scripted replies. Add a model key for the real agent.' : undefined}
          />
        }
      >
        {messages.map((message) => (
          <Turn key={message.id} id={message.id} from={message.role === 'user' ? 'person' : 'agent'}>
            <Message message={message} live={stepsLive && message === last} />
          </Turn>
        ))}
        {quiet && (
          <Turn>
            <Thinking>Thinking</Thinking>
          </Turn>
        )}
      </Conversation>
      <ShellPaneFooter float>
        <Composer
          size="3"
          // The pane is solid; the composer floats over the chat, so it states the glass itself.
          backdrop
          notices={
            state.pendingRun || problem ? (
              <>
                {problem && (
                  <Notice tone="destructive" action={<Button onClick={() => void regenerate()}>Try again</Button>}>
                    {problem}
                  </Notice>
                )}
                {state.pendingRun && (
                  <RunApproval run={state.pendingRun} running={state.running} onDecide={(approve) => void session.decide(approve)} />
                )}
              </>
            ) : undefined
          }
          onFiles={(files) => void session.attach(files)}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <ComposerInput
            aria-label="Message the agent"
            placeholder="Describe what you need"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ComposerRow>
            <Flex gap="1" align="center" className="kd-agent-tools">
              <AttachButton onFiles={(files) => void session.attach(files)} />
              <AgentChoice value={state.settings} onChange={(next) => session.setSettings(next)} />
              {(state.attached.length > 0 || state.uploading) && (
                <Text size="2" emphasis="medium">
                  {state.uploading ? 'Adding…' : `${state.attached.length} ${state.attached.length === 1 ? 'picture' : 'pictures'}`}
                </Text>
              )}
            </Flex>
            <ComposerSend
              status={status === 'streaming' ? 'streaming' : status === 'submitted' ? 'submitted' : 'ready'}
              onStop={() => void stop()}
              disabled={thinking ? false : !text.trim() || blocked}
              icons={SEND_ICONS}
            />
          </ComposerRow>
        </Composer>
      </ShellPaneFooter>
    </>
  );
}

function Message({ message, live }: { message: UIMessage; live: boolean }) {
  if (message.role === 'user') {
    const pictures = picturesOf(message);
    return (
      <UserMessage
        attachments={
          pictures.length > 0
            ? pictures.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" />
              ))
            : undefined
        }
      >
        {withoutPictures(message.parts.filter(isTextUIPart).map((p) => p.text).join('\n'))}
      </UserMessage>
    );
  }
  const blocks = blocksOf(message);
  return (
    <Stack gap="5">
      {blocks.map((block, i) =>
        block.kind === 'text' ? (
          <Reply key={block.key}>{block.text}</Reply>
        ) : (
          <Stack key={block.key} gap="5">
            <Run parts={block.parts} live={live && i === blocks.length - 1} />
            {block.pictures.length > 0 && (
              <Pictures>
                {block.pictures.map((picture) => (
                  // A plain img: a stored file, shown small.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={picture.node} src={picture.url} alt="" />
                ))}
              </Pictures>
            )}
          </Stack>
        )
      )}
    </Stack>
  );
}

type ToolPart = Parameters<typeof getToolName>[0];

type Block =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'steps'; key: string; parts: ToolPart[]; pictures: Array<{ node: string; url: string }> };

/**
 * A reply as the panel reads it: words, and runs of tool calls between them. A run folds to one row
 * (the conversation block's Steps), and the pictures its looks returned are lifted out beside it,
 * since they are the work's result and the steps are only how it got there.
 */
function blocksOf(message: UIMessage): Block[] {
  const blocks: Block[] = [];
  for (const part of message.parts) {
    if (isTextUIPart(part)) {
      if (part.text.trim()) blocks.push({ kind: 'text', key: `t${blocks.length}`, text: part.text });
      continue;
    }
    if (!isToolUIPart(part)) continue;
    // A run waiting for the person's yes is the approval card's to say; a step saying it too is the
    // same sentence twice.
    if (getToolName(part) === 'run' && isPending(part)) continue;
    const last = blocks.at(-1);
    const run = last?.kind === 'steps' ? last : { kind: 'steps' as const, key: part.toolCallId, parts: [], pictures: [] };
    if (run !== last) blocks.push(run);
    run.parts.push(part);
    const url = pictureOf(part);
    if (url) {
      const node = isRecord(part.input) ? String(part.input.node ?? '') : '';
      const seen = run.pictures.find((p) => p.node === node);
      if (seen) seen.url = url;
      else run.pictures.push({ node, url });
    }
  }
  return blocks;
}

function pictureOf(part: ToolPart): string | undefined {
  if (getToolName(part) !== 'inspect' || part.state !== 'output-available' || !isRecord(part.output)) return undefined;
  return typeof part.output.url === 'string' ? part.output.url : undefined;
}

function isPending(part: ToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available';
}

/** A run of tool calls. Live, its row is the step happening now; done, how many there were. */
function Run({ parts, live }: { parts: ToolPart[]; live: boolean }) {
  const current = parts.at(-1);
  if (!current) return null;
  if (parts.length === 1 && !live) {
    const words = stepWords(current, isPending(current));
    return <Step title={typeof words === 'string' ? words : undefined}>{words}</Step>;
  }
  return (
    <Steps summary={live ? stepWords(current, true) : `${parts.length} steps`} live={live}>
      {parts.map((part) => {
        const pending = isPending(part);
        const words = stepWords(part, pending);
        return (
          <Step key={part.toolCallId} pending={pending} title={typeof words === 'string' ? words : undefined}>
            {words}
          </Step>
        );
      })}
    </Steps>
  );
}

function stepWords(part: ToolPart, pending: boolean): React.ReactNode {
  const name = getToolName(part);
  if (part.state === 'output-error') return part.errorText ?? 'That step failed';
  const input = isRecord(part.input) ? part.input : {};
  const out = part.state === 'output-available' && isRecord(part.output) ? part.output : {};

  switch (name) {
    case 'read_graph':
      return pending ? 'Reading the graph' : 'Read the graph';
    case 'search_nodes':
      return `${pending ? 'Looking up' : 'Looked up'} “${String(input.query ?? '')}”`;
    case 'list_graphs':
      return pending ? 'Checking your graphs' : 'Checked your graphs';
    case 'create_graph':
      return typeof out.url === 'string' ? (
        <>
          Started “{String(out.name ?? 'a new graph')}” · <Link render={<NextLink href={out.url} />}>Open</Link>
        </>
      ) : (
        'Starting a new graph'
      );
    case 'apply_ops': {
      if (pending) return 'Changing the graph';
      const created = strings(out.created).length;
      const refused = Array.isArray(out.errors) ? out.errors.length : 0;
      const ops = Array.isArray(input.ops) ? input.ops.length : 0;
      const onlyArrange = Array.isArray(input.ops) && input.ops.length > 0 && input.ops.every((op) => isRecord(op) && op.op === 'arrange');
      if (onlyArrange && !refused) return 'Arranged the graph';
      return [created ? `Added ${created} ${created === 1 ? 'node' : 'nodes'}` : `Made ${ops} ${ops === 1 ? 'change' : 'changes'}`, refused ? `${refused} refused` : '']
        .filter(Boolean)
        .join(' · ');
    }
    case 'estimate':
      return pending ? 'Pricing' : `Priced at ${String(out.total ?? '')}`;
    case 'run': {
      if (pending) return 'Waiting to run';
      if (out.declined) return 'Not run';
      const nodes = Array.isArray(out.nodes) ? out.nodes.filter(isRecord) : [];
      const failed = nodes.filter((n) => n.status === 'error' || n.status === 'blocked');
      if (!failed.length) return `Ran ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'}`;
      const first = failed[0];
      return `${failed.length} of ${nodes.length} failed · ${String(first?.error ?? first?.status ?? '')}`;
    }
    case 'inspect':
      if (pending) return 'Looking';
      return typeof out.error === 'string' ? out.error : `Looked at ${String(input.node ?? '')}`;
    default:
      return name;
  }
}

/** The price, and the only way anything costly starts: FAUNA's assist mode, Krea's plan-first gate. */
function RunApproval({ run, running, onDecide }: { run: PendingRun; running: boolean; onDecide: (approve: boolean) => void }) {
  const count = run.estimate.nodes.length;
  return (
    <Confirmation
      confirmLabel="Run"
      cancelLabel="Not now"
      busy={running}
      onConfirm={() => onDecide(true)}
      onCancel={() => onDecide(false)}
    >
      Run {count} {count === 1 ? 'node' : 'nodes'} for <span className="kd-num">{run.estimate.total}</span>?
    </Confirmation>
  );
}
