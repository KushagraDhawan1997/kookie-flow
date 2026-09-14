'use client';

import * as React from 'react';
import { ToolbarButton } from '@kookie-ui/react';
import type { EntityTypeDefinition, KookieFlowInstance, ToolbarRenderFn } from '@kushagradhawan/kookie-flow';

import { RunIcon } from '@/app/icons';
import type { EditorBus } from './editor-bus';

type FlowRef = React.RefObject<KookieFlowInstance | null>;

/**
 * The type table, with a Run button in the toolbar over a selected generation node.
 *
 * Manual types only: a generation costs money, so a changed input stops at it and Run is the only
 * thing that starts it. Every other node has already re-run by the time it is selected.
 *
 * One node at a time, as the inspector's Run is. `evaluate` starts a node on the inputs it has
 * now, so Run on two selected nodes that form a chain would pay for the second on the picture the
 * first is about to replace. The header's Run is the one that orders a batch.
 */
export function withRunToolbar(
  types: Record<string, EntityTypeDefinition>,
  flowRef: FlowRef,
  bus: EditorBus
): Record<string, EntityTypeDefinition> {
  const toolbar: ToolbarRenderFn = ({ entities }) =>
    entities.length === 1 ? <RunButton id={entities[0].id} flowRef={flowRef} bus={bus} /> : null;
  const out: Record<string, EntityTypeDefinition> = {};
  for (const [type, def] of Object.entries(types)) {
    out[type] = def.evaluation === 'manual' ? { ...def, toolbar } : def;
  }
  return out;
}

/**
 * Spins while its node runs. The bus wakes it when the selected node's status changes, and the
 * button only shows for a lone selection, so that node is this one.
 */
function RunButton({ id, flowRef, bus }: { id: string; flowRef: FlowRef; bus: EditorBus }) {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => bus.subscribe(bump), [bus]);
  const running = flowRef.current?.getEvaluationStatus(id) === 'running';

  const run = () => {
    const flow = flowRef.current;
    // `evaluate` on a running node cancels the run and starts it again, and a double click lands
    // its second press before the spinner has had a frame to block it.
    if (!flow || flow.getEvaluationStatus(id) === 'running') return;
    void flow.evaluate(id);
  };

  return (
    <ToolbarButton emphasis="loud" tone="accent" leading={<RunIcon />} loading={running} onClick={run}>
      Run
    </ToolbarButton>
  );
}
