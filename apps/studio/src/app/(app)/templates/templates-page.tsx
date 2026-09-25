'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { Flex, Page, SegmentedControl, SegmentedItem, Stack, Text } from '@kushagradhawan/kookie-ui-react';

import { AppPane } from '../app-shell';
import { KIND_LABEL, TEMPLATES, type Template, type TemplateKind } from './templates';
import './templates.css';

type Filter = 'all' | TemplateKind;

/**
 * Every template, filterable. Each is a graph that already works, told as what goes in and what comes
 * out. Mock data for now (see templates.ts).
 */
export function TemplatesPage() {
  const [filter, setFilter] = React.useState<Filter>('all');
  const shown = filter === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.kind === filter);

  return (
    <AppPane>
      <Page title="Templates" description="Graphs that already work. Open one to see what goes in and what comes out.">
        <Stack gap="6">
          <Flex>
            <SegmentedControl value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Show">
              <SegmentedItem value="all">All</SegmentedItem>
              {(Object.keys(KIND_LABEL) as TemplateKind[]).map((kind) => (
                <SegmentedItem key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </SegmentedItem>
              ))}
            </SegmentedControl>
          </Flex>
          <div className="kd-templates-grid">
            {shown.map((template) => (
              <TemplateTile key={template.slug} template={template} />
            ))}
          </div>
        </Stack>
      </Page>
    </AppPane>
  );
}

/** The picture, then what it is called and the one sentence that says what it does. The whole tile is the link. */
export function TemplateTile({ template, summary = true }: { template: Template; summary?: boolean }) {
  return (
    <NextLink href={`/templates/${template.slug}`} className="kd-template-tile">
      <div className="kd-template-cover" aria-hidden />
      <Stack gap="0" className="kd-template-words">
        <Text size="2" weight="medium">
          {template.title}
        </Text>
        {summary && (
          <Text size="2" emphasis="medium" className="kd-template-summary">
            {template.summary}
          </Text>
        )}
      </Stack>
    </NextLink>
  );
}
