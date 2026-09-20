/**
 * A graph's conversation with the agent, alive for as long as the editor is.
 *
 * WHY NOT IN THE PANEL. The panel comes and goes: the pane closes, the person switches to Inspect. A
 * chat held by the panel would lose a reply mid-stream and, worse, a run waiting for approval, which
 * leaves the model waiting on a tool answer that never comes. So the chat, the approval and the
 * attachments live here, outside React, and the panel subscribes to what it shows. Nothing here
 * touches the editor's state, so the canvas never re-renders for the agent.
 */

import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { isBrowserTool, isTriageAnswers, type GraphOp, type TriageAnswers } from 'studio-core';

import { readAgentSettings } from '@/app/agent-choice';
import { AGENT_EFFORTS, DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@/app/agent-models';
import { ports } from '@/runtime/ports';
import { announceBalanceChange } from '@/shared/billing';
import { pendingAskKey, type EstimateOutput, type PendingAsk } from '@/shared/agent';
import type { AgentHost } from './host';

export interface PendingRun {
  toolCallId: string;
  nodes: string[];
  estimate: EstimateOutput;
}

export interface AgentSessionState {
  chat: Chat<UIMessage> | null;
  mode: 'gateway' | 'mock';
  loadError: string | null;
  settings: AgentSettings;
  pendingRun: PendingRun | null;
  running: boolean;
  /** Picture node ids attached since the last message. */
  attached: string[];
  uploading: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is UIMessage => isRecord(m) && typeof m.id === 'string' && typeof m.role === 'string' && Array.isArray(m.parts)
  );
}

function asPendingAsk(value: unknown): PendingAsk | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const pictures = Array.isArray(value.pictures)
    ? value.pictures.flatMap((p) =>
        isRecord(p) && typeof p.hash === 'string' && typeof p.width === 'number' && typeof p.height === 'number'
          ? [{ hash: p.hash, url: String(p.url ?? ''), mime: String(p.mime ?? 'image/png'), width: p.width, height: p.height }]
          : []
      )
    : [];
  return { text: value.text, model: String(value.model ?? ''), effort: String(value.effort ?? ''), pictures };
}

/**
 * The longest side a picture is shown to the model at. Enough to judge a draft. A 4000px original is
 * shrunk by the provider anyway, and one over 5MB is refused, so it is shrunk here, once, and stored
 * like any other file (plans/studio/agent-plan.md, step 6).
 */
const LOOK_SIZE = 1024;

type InspectAnswer = ReturnType<AgentHost['inspect']>;

async function smallCopy(answer: InspectAnswer): Promise<InspectAnswer> {
  if (!('hash' in answer) || !answer.url) return answer;
  // A JPEG within the size is small enough already. A PNG is not, whatever its size: a 1024×768
  // photo-like PNG is over a megabyte, and three of them went to the model whole (2026-09-17).
  if (answer.mime === 'image/jpeg' && Math.max(answer.width, answer.height) <= LOOK_SIZE) return answer;
  const res = await fetch(answer.url);
  if (!res.ok) throw new Error(`the picture did not load (${res.status})`);
  const scale = Math.min(1, LOOK_SIZE / Math.max(answer.width, answer.height));
  const bitmap = await createImageBitmap(await res.blob(), {
    resizeWidth: Math.max(1, Math.round(answer.width * scale)),
    resizeHeight: Math.max(1, Math.round(answer.height * scale)),
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas');
  // JPEG has no transparency: white, not black, behind a cut-out.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const small = await ports.assets.put(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), 'image');
  // The size stays the original's: it is what the node made, and what the model is told.
  return { ...answer, hash: small.hash, mime: small.mime ?? 'image/jpeg' };
}

/**
 * How long a message waits for its triage before going without it. A triage answers in well under a
 * second; the message must not sit behind a slow one.
 */
const TRIAGE_TIMEOUT_MS = 3_000;

/** A message's words, with the pictures it attached named by node so the agent can wire them. */
export function withPictures(text: string, ids: readonly string[]): string {
  if (ids.length === 0) return text;
  return `${text}\n\n(Attached ${ids.length === 1 ? 'a picture' : `${ids.length} pictures`}, on the canvas as ${ids.join(', ')}.)`;
}

const PICTURES_NOTE = /\n\n\(Attached (?:a picture|\d+ pictures), on the canvas as [^)]*\.\)$/;

/** The words the person typed, without the note `withPictures` adds for the model. */
export function withoutPictures(text: string): string {
  return text.replace(PICTURES_NOTE, '');
}

/** The addresses of the pictures a message attached, which it carries in its metadata for the panel. */
export function picturesOf(message: UIMessage): string[] {
  return isRecord(message.metadata) ? strings(message.metadata.pictures) : [];
}

export class AgentSession {
  private state: AgentSessionState;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private starting: Promise<void> | null = null;
  /** The attached pictures' addresses, beside `state.attached`, so the sent message can show them. */
  private attachedUrls: string[] = [];

  constructor(
    private readonly graphId: string,
    private readonly host: AgentHost
  ) {
    this.state = {
      chat: null,
      mode: 'gateway',
      loadError: null,
      settings: DEFAULT_AGENT_SETTINGS,
      pendingRun: null,
      running: false,
      attached: [],
      uploading: false,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): AgentSessionState => this.state;

  private set(patch: Partial<AgentSessionState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Load the conversation, make the chat, and send an ask waiting from Home. Once, however often asked. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.load();
    return this.starting;
  }

  private async load(): Promise<void> {
    if (this.state.chat) return;
    this.set({ settings: readAgentSettings(DEFAULT_AGENT_SETTINGS) });
    let messages: UIMessage[] = [];
    try {
      const res = await fetch(`/api/agent/${this.graphId}`);
      const body: unknown = await res.json();
      if (!res.ok || !isRecord(body)) {
        throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : 'The conversation did not load.');
      }
      messages = asMessages(body.messages);
      this.set({ mode: body.mode === 'mock' ? 'mock' : 'gateway' });
    } catch (error) {
      this.set({ loadError: error instanceof Error ? error.message : 'The conversation did not load.' });
      return;
    }
    if (this.disposed) return;

    const chat: Chat<UIMessage> = new Chat<UIMessage>({
      id: this.graphId,
      messages,
      transport: new DefaultChatTransport({ api: '/api/agent/step', body: () => ({ ...this.state.settings }) }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onFinish: () => announceBalanceChange(),
      onToolCall: ({ toolCall }) => {
        if (toolCall.dynamic || !isBrowserTool(toolCall.toolName)) return;
        this.answerTool(chat, toolCall.toolName, toolCall.toolCallId, isRecord(toolCall.input) ? toolCall.input : {});
      },
    });
    this.set({ chat });
    this.sendPendingAsk(chat);
    void this.resumeUnanswered(chat);
  }

  /**
   * Browser tools the model called before a reload and nobody answered. The server stores the
   * model's side of a step when it ends; the answers the browser adds come back on the next
   * request, so a reload between the two leaves the calls open and the panel showing "Looking" for
   * good (found 2026-09-17). Reading, pricing and looking are answered again; a run waits for
   * approval again; an edit is not applied twice, so it is answered with a note to read the graph.
   */
  private async resumeUnanswered(chat: Chat<UIMessage>): Promise<void> {
    const last = chat.messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    const open = last.parts.filter(
      (part) => isToolUIPart(part) && !part.type.startsWith('tool-dynamic') && (part.state === 'input-available' || part.state === 'input-streaming')
    );
    if (open.length === 0) return;
    await this.host.ready();
    if (this.disposed || this.state.chat !== chat) return;
    for (const part of open) {
      if (!isToolUIPart(part)) continue;
      const tool = getToolName(part);
      if (!isBrowserTool(tool)) continue;
      if (tool === 'apply_ops') {
        void chat.addToolOutput({
          tool,
          toolCallId: part.toolCallId,
          state: 'output-error',
          errorText: 'The page was reloaded before this was recorded. Call read_graph to see what is on the canvas.',
        });
        continue;
      }
      this.answerTool(chat, tool, part.toolCallId, isRecord(part.input) ? part.input : {});
    }
  }

  private answerTool(chat: Chat<UIMessage>, tool: string, toolCallId: string, input: Record<string, unknown>): void {
    const answer = (output: unknown) => void chat.addToolOutput({ tool, toolCallId, output });
    switch (tool) {
      case 'read_graph':
        return answer(this.host.readGraph(strings(input.focus)));
      case 'apply_ops': {
        const ops = Array.isArray(input.ops) ? input.ops.filter((op): op is GraphOp => isRecord(op) && typeof op.op === 'string') : [];
        return answer(this.host.applyOps(ops));
      }
      case 'estimate':
        return answer(this.host.estimate(strings(input.nodes)));
      case 'inspect': {
        const found = this.host.inspect(String(input.node ?? ''), typeof input.socket === 'string' ? input.socket : undefined);
        void smallCopy(found)
          .catch((error: unknown) => {
            console.warn('[studio] the picture could not be shrunk for the agent; sending it whole', error);
            return found;
          })
          .then(answer);
        return;
      }
      case 'run': {
        // Nothing is spent until the person says so: the call waits here for Run or Not now.
        const nodes = strings(input.nodes);
        this.set({ pendingRun: { toolCallId, nodes, estimate: this.host.estimate(nodes) } });
        return;
      }
      default:
        return;
    }
  }

  private sendPendingAsk(chat: Chat<UIMessage>): void {
    const key = pendingAskKey(this.graphId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return;
    window.sessionStorage.removeItem(key);
    let pending: PendingAsk | null = null;
    try {
      pending = asPendingAsk(JSON.parse(raw));
    } catch (error) {
      console.warn('[studio] an ask from Home could not be read', error);
    }
    if (!pending) return;
    const effort = AGENT_EFFORTS.find((e) => e.id === pending.effort)?.id ?? this.state.settings.effort;
    this.set({ settings: { model: pending.model || this.state.settings.model, effort } });
    const ids = this.host.addPictures(pending.pictures);
    void this.deliver(chat, withPictures(pending.text, ids), pending.pictures.map((p) => p.url).filter(Boolean));
  }

  /**
   * Ask the server to read the message before it goes (`/api/agent/triage`), and send it with the
   * answers on its metadata, where the step route turns them into a line for the model and the panel
   * ignores them. A triage that fails, or takes too long, is a message sent without one.
   */
  private async deliver(chat: Chat<UIMessage>, text: string, pictures: string[]): Promise<void> {
    const triage = await this.triage(text);
    if (this.disposed || this.state.chat !== chat) return;
    void chat.sendMessage({ text, metadata: { pictures, ...(triage ? { triage } : {}) } });
  }

  private async triage(text: string): Promise<TriageAnswers | null> {
    try {
      const res = await fetch('/api/agent/triage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: this.graphId, text, canvas: this.host.readGraph([]) }),
        signal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return isRecord(body) && isTriageAnswers(body.triage) ? body.triage : null;
    } catch (error) {
      console.warn('[studio] the message went without triage', error);
      return null;
    }
  }

  setSettings(settings: AgentSettings): void {
    this.set({ settings });
  }

  send(text: string): void {
    const chat = this.state.chat;
    const words = text.trim();
    if (!chat || !words) return;
    const message = withPictures(words, this.state.attached);
    const pictures = this.attachedUrls;
    this.attachedUrls = [];
    this.set({ attached: [] });
    void this.deliver(chat, message, pictures);
  }

  async decide(approve: boolean): Promise<void> {
    const { chat, pendingRun } = this.state;
    if (!chat || !pendingRun) return;
    if (!approve) {
      this.set({ pendingRun: null });
      void chat.addToolOutput({ tool: 'run', toolCallId: pendingRun.toolCallId, output: { declined: true, nodes: [] } });
      return;
    }
    this.set({ running: true });
    try {
      const output = await this.host.run(pendingRun.nodes);
      void chat.addToolOutput({ tool: 'run', toolCallId: pendingRun.toolCallId, output });
    } catch (error) {
      void chat.addToolOutput({
        tool: 'run',
        toolCallId: pendingRun.toolCallId,
        state: 'output-error',
        errorText: error instanceof Error ? error.message : 'The run failed.',
      });
    } finally {
      this.set({ running: false, pendingRun: null });
      announceBalanceChange();
    }
  }

  async attach(files: File[]): Promise<void> {
    const pictures = files.filter((f) => f.type.startsWith('image/'));
    if (!pictures.length) return;
    this.set({ uploading: true });
    try {
      const stored = await Promise.all(pictures.map((f) => ports.assets.put(f, 'image')));
      const ids = this.host.addPictures(
        stored.map((ref) => ({ hash: ref.hash, url: ref.url ?? '', mime: ref.mime ?? 'image/png', width: ref.width, height: ref.height }))
      );
      this.attachedUrls = [...this.attachedUrls, ...stored.map((ref) => ref.url ?? '').filter(Boolean)];
      this.set({ attached: [...this.state.attached, ...ids] });
    } finally {
      this.set({ uploading: false });
    }
  }

  async startOver(): Promise<void> {
    const { chat } = this.state;
    if (!chat) return;
    await chat.stop();
    chat.messages = [];
    this.attachedUrls = [];
    this.set({ pendingRun: null, attached: [] });
    await fetch(`/api/agent/${this.graphId}`, { method: 'DELETE' });
  }

  /**
   * The editor mounting and unmounting it. Not a one-way dispose: React's strict mode unmounts and
   * mounts again at once, and a session that stayed disposed would never load.
   */
  open(): void {
    this.disposed = false;
  }

  close(): void {
    this.disposed = true;
    void this.state.chat?.stop();
  }
}
