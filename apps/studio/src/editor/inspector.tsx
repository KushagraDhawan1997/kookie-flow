'use client';

import * as React from 'react';
import {
  Button,
  Code,
  Field,
  FieldLabel,
  Flex,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  ShellPaneFooter,
  ShellScroll,
  Slider,
  Stack,
  Switch,
  Text,
  TextArea,
  TextField,
} from '@kookie-ui/react';
import type { Edge, Entity, EvaluationStatus, KookieFlowInstance, WidgetType } from '@kushagradhawan/kookie-flow';
import {
  estimateModelMicros,
  formatUsd,
  isMediaRef,
  registry,
  SOCKET_TYPES,
  TASK_BY_NODE_TYPE,
  valueBag,
  withFee,
  type SocketSpec,
} from 'studio-core';

import { EmptyState } from '@/app/empty-state';
import { RunIcon, TrashIcon } from '@/app/icons';
import type { EditorBus } from './editor-bus';

interface InspectorProps {
  entities: Entity[];
  edges: Edge[];
  flowRef: React.RefObject<KookieFlowInstance | null>;
  bus: EditorBus;
  onValues: (id: string, values: Record<string, unknown>) => void;
  onLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}

function widgetFor(spec: SocketSpec): WidgetType | false {
  if (spec.widget !== undefined) return spec.widget;
  return SOCKET_TYPES[spec.type].widget ?? false;
}

const STATUS_WORDS: Record<EvaluationStatus, string> = {
  idle: 'Not run yet',
  dirty: 'Needs a run',
  running: 'Running',
  success: 'Done',
  error: 'Failed',
};

export function Inspector({ entities, edges, flowRef, bus, onValues, onLabel, onRemove }: InspectorProps) {
  // Selection, status and outputs live in the store and the engine, not in React. The bus taps
  // once per animation frame when the selected node's own state moves, and only this pane
  // re-renders for it.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => bus.subscribe(bump), [bus]);

  const selectedId = bus.selected[0];
  const entity = selectedId ? (entities.find((e) => e.id === selectedId) ?? null) : null;

  // One pass over the edges per selection change, not per status notification.
  const wired = React.useMemo(() => {
    const map = new Map<string, Edge>();
    if (!entity) return map;
    for (const e of edges) if (e.target === entity.id && e.targetSocket) map.set(e.targetSocket, e);
    return map;
  }, [edges, entity]);

  // The two emptinesses read differently, as the builder's Layers panel's do: telling someone to
  // click a node on a graph with none sends them looking for something that is not there. Neither
  // has an action, because what fills this pane happens on the canvas. Straight in the pane rather
  // than in a scroller, whose content has no height, so the state centres in the pane's.
  if (!entity) {
    return entities.length === 0 ? (
      <EmptyState title="No nodes yet" description="Press + beside the canvas to add one." />
    ) : (
      <EmptyState title="Nothing selected" description="Click a node on the canvas to see its settings." />
    );
  }

  const def = registry.get(entity.type);
  const flow = flowRef.current;
  const engineStatus = flow?.getEvaluationStatus(entity.id) ?? 'idle';
  const outputs = def ? Object.keys(def.outputs).map((id) => [id, flow?.getSocketValue(entity.id, id)] as const) : [];
  // The engine returns a settled node to `idle` a moment after it succeeds, so `idle` alone
  // cannot tell "never run" from "ran a second ago". Having produced a value is what tells them
  // apart, and it is what the reader actually wants to know.
  const ran = outputs.some(([, value]) => value !== undefined);
  const status = engineStatus === 'idle' && ran ? 'success' : engineStatus;
  const message = bus.message(entity.id);
  const values = valueBag(entity);

  // The price of pressing Run, quoted with the same table the server charges from. Inputs resolve as
  // the engine resolves them: a wired one reads what its source holds, the rest their own value.
  const task = TASK_BY_NODE_TYPE[entity.type];
  let quote: ReturnType<typeof withFee> | null = null;
  if (def && task) {
    const resolved: Record<string, unknown> = {};
    for (const [id, spec] of Object.entries(def.inputs)) {
      const edge = wired.get(id);
      resolved[id] =
        edge && edge.sourceSocket ? flow?.getSocketValue(edge.source, edge.sourceSocket) : (values[id] ?? spec.default);
    }
    const model = estimateModelMicros(task, resolved);
    if (model !== undefined) quote = withFee(model);
  }

  return (
    <>
      <ShellScroll>
        <Stack gap="5">
          <Stack gap="1">
            <Heading size="4">{def?.label ?? 'Unknown node'}</Heading>
            {/* The summary, not the description: that one is written for the agent. */}
            <Text size="2" emphasis="medium">
              {def?.summary ?? 'This node type no longer exists.'}
            </Text>
          </Stack>

          <Field>
            <FieldLabel>Label</FieldLabel>
            <TextField
              value={typeof entity.data.label === 'string' ? entity.data.label : ''}
              placeholder={def?.label}
              maxLength={120}
              onChange={(e) => onLabel(entity.id, e.target.value)}
            />
          </Field>

          {def && (
            <Stack gap="3">
              {Object.entries(def.inputs).map(([id, spec]) => {
                const edge = wired.get(id);
                const label = spec.label ?? id.replace(/^\w/, (c) => c.toUpperCase());
                if (edge) {
                  return (
                    <Stack key={id} gap="1">
                      <Text size="2" weight="medium">{label}</Text>
                      <Text size="1" emphasis="medium">
                        from {edge.source}.{edge.sourceSocket}
                      </Text>
                    </Stack>
                  );
                }
                const widget = widgetFor(spec);
                if (widget === false) return null;
                return (
                  <ParamControl
                    key={`${entity.id}:${id}`}
                    label={label}
                    spec={spec}
                    widget={widget}
                    value={values[id] ?? spec.default}
                    onChange={(v) => onValues(entity.id, { [id]: v })}
                  />
                );
              })}
            </Stack>
          )}

          <Stack gap="2">
            <Text size="2" weight="medium">
              {STATUS_WORDS[status]}
            </Text>
            {message && (
              <Text size="1" tone="destructive">
                {message}
              </Text>
            )}
            {outputs.map(([id, value]) => (
              <OutputRow key={id} id={id} value={value} />
            ))}
          </Stack>
        </Stack>
      </ShellScroll>
      <ShellPaneFooter>
        {quote && (
          <Text size="1" emphasis="medium" style={{ display: 'block', marginBlockEnd: 'var(--space-2)' }}>
            About {formatUsd(quote.total)} to run
          </Text>
        )}
        <Flex justify="space-between" align="center" gap="2">
          <Button
            emphasis="loud"
            tone="accent"
            leading={<RunIcon />}
            onClick={() => void flowRef.current?.evaluate(entity.id)}
          >
            Run
          </Button>
          <Button iconOnly emphasis="quiet" tone="destructive" aria-label="Delete node" onClick={() => onRemove(entity.id)}>
            <TrashIcon />
          </Button>
        </Flex>
      </ShellPaneFooter>
    </>
  );
}

function OutputRow({ id, value }: { id: string; value: unknown }) {
  let shown: React.ReactNode;
  if (value === undefined) shown = <Text size="1" emphasis="quiet">–</Text>;
  else if (isMediaRef(value) && value.url) {
    shown = (
      // `--radius-surface-1`, not `--radius-2`: the radius scale is split by role, and at the
      // `full` level every control token is the 9999px pill sentinel. A picture is a surface, and
      // read off the control half it came out a circle.
      <img
        src={value.url}
        alt=""
        style={{
          maxInlineSize: '100%',
          // A flex item's automatic minimum size is its CONTENT's size, so a 768px picture refuses
          // to shrink and runs off the panel however small `max-inline-size` says it may be.
          minInlineSize: 0,
          blockSize: 'auto',
          borderRadius: 'var(--radius-surface-1, 6px)',
        }}
      />
    );
  } else if (typeof value === 'object') shown = <Code size="1">{JSON.stringify(value)}</Code>;
  else shown = <Code size="1">{String(value)}</Code>;
  return (
    <Flex gap="2" align="start">
      <Text size="1" emphasis="medium" style={{ minInlineSize: 64 }}>
        {id}
      </Text>
      {shown}
    </Flex>
  );
}

interface ParamControlProps {
  label: string;
  spec: SocketSpec;
  widget: WidgetType;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * One input's control.
 *
 * IT COMMITS WHEN THE EDIT ENDS, not while it is happening. Every commit is a graph operation:
 * the whole entity list is rebuilt, the store re-resolves, both quadtrees are rebuilt and every
 * GL buffer is re-uploaded. Done per pointer move, a two-second slider drag did that work about
 * a hundred and twenty times; done per keystroke, typing a number did it per character. The
 * in-flight value lives here until the gesture or the field is finished, which is also what lets
 * a number field hold "-" or "" for a moment without being corrected.
 */
function ParamControl({ label, spec, widget, value, onChange }: ParamControlProps) {
  const [draft, setDraft] = React.useState<string | number | null>(null);

  const commit = (next: unknown) => {
    setDraft(null);
    onChange(next);
  };

  let control: React.ReactNode;
  switch (widget) {
    case 'slider': {
      const type = SOCKET_TYPES[spec.type];
      const live = typeof draft === 'number' ? draft : typeof value === 'number' ? value : Number(value ?? 0);
      const step = spec.step ?? type.step ?? 0.01;
      control = (
        <Flex gap="3" align="center">
          <Slider
            aria-label={label}
            value={Number.isFinite(live) ? live : 0}
            min={spec.min ?? type.min ?? 0}
            max={spec.max ?? type.max ?? 1}
            step={step}
            onValueChange={(v) => setDraft(Array.isArray(v) ? (v[0] ?? 0) : v)}
            onValueCommitted={(v) => commit(Array.isArray(v) ? (v[0] ?? 0) : v)}
            style={{ flexGrow: 1 }}
          />
          <Code size="1">{Number.isFinite(live) ? (step >= 1 ? live.toFixed(0) : live.toFixed(3)) : '–'}</Code>
        </Flex>
      );
      break;
    }
    case 'number': {
      // The socket type's range belongs to the slider, not here: a float field inheriting 0..1
      // refused every larger number, and inheriting step 0.01 refused every other one.
      const shown = draft !== null ? String(draft) : value === undefined || value === null ? '' : String(value);
      const commitText = (text: string) => {
        const n = Number(text);
        if (text.trim() === '' || !Number.isFinite(n)) setDraft(null);
        else commit(n);
      };
      control = (
        <TextField
          type="number"
          value={shown}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText(e.currentTarget.value);
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      );
      break;
    }
    case 'checkbox':
      control = <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} />;
      break;
    case 'select':
      control = (
        <Select
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(v) => v !== null && onChange(v)}
          items={spec.optionLabels}
        >
          <SelectTrigger placeholder="Choose" />
          <SelectContent>
            {(spec.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {spec.optionLabels?.[o] ?? o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'textarea':
      control = (
        <TextArea
          rows={spec.rows ?? 3}
          value={draft !== null ? String(draft) : typeof value === 'string' ? value : ''}
          placeholder={spec.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
        />
      );
      break;
    case 'color':
    case 'text':
    default:
      control = (
        <TextField
          value={draft !== null ? String(draft) : typeof value === 'string' ? value : value === undefined ? '' : String(value)}
          placeholder={spec.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      );
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {control}
    </Field>
  );
}
