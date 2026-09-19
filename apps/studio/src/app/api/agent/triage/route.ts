import { NextResponse } from 'next/server';
import { z } from 'zod';
import { tokenMicros, TRIAGE_MODEL } from 'studio-core';
import { agentMode } from '@/server/agent/model';
import { triage, triageEnabled, triageTokens } from '@/server/agent/triage';
import { closeTurn, InsufficientBalance, openTurn } from '@/server/billing';
import { getDb } from '@/server/db';
import { getGraph } from '@/server/graphs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

/** A triage that has not answered in this long is not worth the wait: the message goes without it. */
const TRIAGE_TIMEOUT_MS = 4_000;

/** The message about to be sent, and the canvas as the browser sees it. */
const Body = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(20_000),
  canvas: z.string().max(20_000).default(''),
});

/**
 * Read one message before it is sent. Answers `{ triage }` with the answers to keep on the message,
 * or `{ triage: null }` when there are none: triage is off, the model did not answer in time, or the
 * balance could not cover it. None of those stops the message; it goes to the agent without the hint.
 *
 * In gateway mode a triage is a turn of its own, held and charged like an agent step, so the ledger
 * says what it cost; the mock is neither held nor charged.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { id: graphId, text, canvas } = body.data;

  const graph = await getGraph(graphId, user.id);
  if (!graph) return NextResponse.json({ error: 'That graph does not exist.' }, { status: 404 });
  if (!triageEnabled()) return NextResponse.json({ triage: null });

  const billed = agentMode() === 'gateway';
  const db = await getDb();
  let turnId: string | null = null;
  if (billed) {
    try {
      const estimate = tokenMicros(TRIAGE_MODEL, {
        input: triageTokens(text, canvas),
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
      turnId = (
        await openTurn(db, {
          workspaceId: user.id,
          graphId,
          model: TRIAGE_MODEL.id,
          estimateMicros: estimate,
        })
      ).id;
    } catch (error) {
      if (error instanceof InsufficientBalance) return NextResponse.json({ triage: null });
      throw error;
    }
  }

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TRIAGE_TIMEOUT_MS)]);
    const result = await triage(text, canvas, signal);
    if (turnId)
      await closeTurn(db, turnId, {
        input: result.inputTokens,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
    return NextResponse.json({ triage: result.answers });
  } catch (error) {
    console.warn('[studio] triage skipped', error);
    if (turnId)
      await closeTurn(
        db,
        turnId,
        null,
        error instanceof Error ? error.message : String(error)
      ).catch(() => null);
    return NextResponse.json({ triage: null });
  }
}
