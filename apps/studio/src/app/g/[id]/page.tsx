import { notFound } from 'next/navigation';
import { Box, Card, Code, Flex, Heading, Link, Stack, Text } from '@kookie-ui/react';
import NextLink from 'next/link';
import { parseDocument } from 'studio-core';
import { getGraph } from '@/server/graphs';
import { Editor } from '@/editor/editor';

export const dynamic = 'force-dynamic';

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getGraph(id);
  if (!row) notFound();
  const doc = parseDocument(row.doc);

  // A stored document that cannot be read is NOT opened as an empty canvas. Doing that armed
  // autosave with nothing in it, and the first edit replaced whatever was really in the row.
  if (!doc) {
    return (
      <Flex justify="center">
        <Box p="6" width="min(640px, 100%)">
          <Card size="3">
            <Stack gap="3">
              <Heading size="5">This graph cannot be opened</Heading>
              <Text size="2" emphasis="medium">
                What is stored under <Code size="1">{row.id}</Code> is not a graph document, so the editor will not
                open it. Nothing has been changed — the stored copy is exactly as it was.
              </Text>
              <Link render={<NextLink href="/" />}>All graphs</Link>
            </Stack>
          </Card>
        </Box>
      </Flex>
    );
  }

  return <Editor id={row.id} name={row.name} initial={doc} revision={row.revision} />;
}
