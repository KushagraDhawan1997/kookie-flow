'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Link,
  Notice,
  Stack,
  Text,
} from '@kookie-ui/react';

import type { GraphSummary } from '@/server/graphs';
import { AppearanceToggle } from './appearance-toggle';
import { PlusIcon, TrashIcon } from './icons';

/**
 * The stored time, shown in the reader's own locale.
 *
 * The server and the reader are rarely in the same zone, and the server cannot know the reader's.
 * So the first paint carries the plain stored time and the browser replaces it once it is running
 * — which is also why this is not a hydration mismatch waiting to happen.
 */
function LocalTime({ iso }: { iso: string }) {
  const [shown, setShown] = React.useState(iso.slice(0, 16).replace('T', ' '));
  React.useEffect(() => {
    setShown(new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  }, [iso]);
  return <time dateTime={iso}>{shown}</time>;
}

export function GraphList({ initial }: { initial: GraphSummary[] }) {
  const router = useRouter();
  const [graphs, setGraphs] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  // The browser's back button restores this page from its cache, so what was rendered on the
  // server can be minutes old: a graph renamed since then, or one deleted in another tab, would
  // sit in the list until a reload.
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/graphs');
        if (!res.ok) return;
        const body = (await res.json()) as { graphs: GraphSummary[] };
        if (!cancelled) setGraphs(body.graphs);
      } catch {
        // An offline list is the one that was rendered; nothing to say about it.
      }
    };
    void load();
    addEventListener('pageshow', load);
    return () => {
      cancelled = true;
      removeEventListener('pageshow', load);
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      // Deliberately still busy: the navigation is under way and this component is about to go.
      // Clearing it here let a second click make a second, orphaned graph.
      router.push(`/g/${id}`);
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : 'the graph could not be created');
    }
  };

  const remove = async (id: string, name: string) => {
    setProblem(null);
    try {
      const res = await fetch(`/api/graphs/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      setGraphs((g) => g.filter((x) => x.id !== id));
    } catch (error) {
      setProblem(`${name} could not be deleted: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  return (
    <Flex justify="center">
      <Box p="6" width="min(720px, 100%)">
        <Stack gap="6">
          <Flex justify="space-between" align="center">
            <Heading size="6">Graphs</Heading>
            <Flex gap="2" align="center">
              <AppearanceToggle />
              <Button emphasis="loud" tone="accent" leading={<PlusIcon />} loading={busy} onClick={create}>
                New graph
              </Button>
            </Flex>
          </Flex>

          {problem && <Notice tone="destructive">{problem}</Notice>}

          {graphs.length === 0 ? (
            <Text emphasis="medium">No graphs yet. Make one.</Text>
          ) : (
            <Stack gap="3">
              {graphs.map((g) => (
                <Card key={g.id} size="2">
                  <Flex justify="space-between" align="center" gap="4">
                    <Stack gap="1">
                      <Link render={<NextLink href={`/g/${g.id}`} />} weight="medium">
                        {g.name}
                      </Link>
                      <Text size="1" emphasis="medium">
                        {g.nodeCount} {g.nodeCount === 1 ? 'node' : 'nodes'} · <LocalTime iso={g.updatedAt} />
                      </Text>
                    </Stack>
                    {/* Deleting is permanent and there is no copy anywhere else, so it asks. */}
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button iconOnly emphasis="quiet" tone="destructive" aria-label={`Delete ${g.name}`}>
                            <TrashIcon />
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogTitle>Delete “{g.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The graph and everything in it goes for good. There is no copy.
                        </AlertDialogDescription>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(g.id, g.name)}>Delete</AlertDialogAction>
                      </AlertDialogContent>
                    </AlertDialog>
                  </Flex>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Box>
    </Flex>
  );
}
