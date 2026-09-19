import { NextResponse } from 'next/server';
import { clearConversation, loadConversation } from '@/server/agent/conversation';
import { agentMode } from '@/server/agent/model';
import { getGraph } from '@/server/graphs';
import { currentUser, signInRequired } from '@/server/session';

export const dynamic = 'force-dynamic';

/** A graph's conversation, and whether a real model or the mock answers. */
export async function GET(_request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const { graphId } = await params;
  if (!(await getGraph(graphId, user.id))) return NextResponse.json({ error: 'That graph does not exist.' }, { status: 404 });
  return NextResponse.json({ messages: await loadConversation(graphId, user.id), mode: agentMode() });
}

/** Start the conversation over. The graph and what the agent built on it stay. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const { graphId } = await params;
  await clearConversation(graphId, user.id);
  return new NextResponse(null, { status: 204 });
}
