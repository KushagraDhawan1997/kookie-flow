/**
 * A graph's conversation with the agent, kept as the chat's own message list so reopening a graph
 * shows it as it was. Written once per step, when the step's stream ends.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { conversations } from '../db/schema';

export async function loadConversation(graphId: string, workspaceId: string): Promise<unknown[]> {
  const db = await getDb();
  const [row] = await db
    .select({ messages: conversations.messages })
    .from(conversations)
    .where(and(eq(conversations.graphId, graphId), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return row?.messages ?? [];
}

export async function saveConversation(graphId: string, workspaceId: string, messages: unknown[]): Promise<void> {
  const db = await getDb();
  await db
    .insert(conversations)
    .values({ graphId, workspaceId, messages, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: conversations.graphId,
      set: { messages, updatedAt: new Date() },
      // A graph id is only ever this workspace's; the condition keeps it so if that ever changes.
      setWhere: eq(conversations.workspaceId, workspaceId),
    });
}

export async function clearConversation(graphId: string, workspaceId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(conversations)
    .where(and(eq(conversations.graphId, graphId), eq(conversations.workspaceId, workspaceId)));
}
