'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, Flex, Heading, Notice, Page, Stack, Text, ToolbarButton } from '@kushagradhawan/kookie-ui-react';
import { formatUsd, MICROS_PER_DOLLAR } from 'studio-core';

import { RunIcon } from '../../icons';
import { AppPane } from '../app-shell';
import { findTemplate, KIND_LABEL, type TemplateInput, type TemplateOutput } from './templates';
import './templates.css';

/**
 * One template, read top to bottom the way a person decides: what it needs beside what it gives,
 * then how it gets there and what a run costs. No hero picture: the outputs are what it makes.
 * The slug is passed rather than the template, since the data holds nothing a server has to send.
 */
export function TemplatePage({ slug }: { slug: string }) {
  const router = useRouter();
  const template = findTemplate(slug);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  if (!template) return null;

  // Mock: a graph under the template's name, empty until templates carry real documents.
  const use = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: template.title }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      router.push(`/g/${id}`);
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : 'The graph could not be created.');
    }
  };

  const action = (
    <ToolbarButton emphasis="loud" tone="accent" loading={busy} onClick={() => void use()}>
      Use template
    </ToolbarButton>
  );

  return (
    <AppPane actions={action} back={{ href: '/templates', label: 'Back to templates' }}>
      <Page title={template.title} description={template.summary}>
        <Stack gap="8">
          {problem && <Notice tone="destructive">{problem}</Notice>}

          <div className="kd-template-io">
            <Stack gap="4">
              <SectionHeading title="Input" count={template.inputs.length} />
              <Stack gap="3">
                {template.inputs.map((input) => (
                  <InputField key={input.label} input={input} />
                ))}
              </Stack>
            </Stack>
            <Stack gap="4">
              <SectionHeading title="Output" count={template.outputs.length} />
              <div className="kd-template-outputs" data-count={Math.min(template.outputs.length, 4)}>
                {template.outputs.map((output) => (
                  <OutputPicture key={output.label} output={output} />
                ))}
              </div>
            </Stack>
          </div>

          <Stack gap="4">
            <SectionHeading title="How it works" />
            <ol className="kd-template-steps">
              {template.steps.map((step, i) => (
                <li key={step.node + i}>
                  <span className="kd-template-step-n" aria-hidden>
                    {i + 1}
                  </span>
                  <Stack gap="0">
                    <Text size="2" weight="medium">
                      {step.node}
                    </Text>
                    <Text size="2" emphasis="medium">
                      {step.does}
                    </Text>
                  </Stack>
                </li>
              ))}
            </ol>
            <Text size="2" emphasis="medium">
              {KIND_LABEL[template.kind]} ·{' '}
              {template.price === 0
                ? 'Free to run: no model is called.'
                : `About ${formatUsd(Math.round(template.price * MICROS_PER_DOLLAR))} a run.`}
            </Text>
          </Stack>
        </Stack>
      </Page>
    </AppPane>
  );
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <Flex gap="2" align="baseline">
      <Heading size="6" render={<h2 />}>
        {title}
      </Heading>
      {count !== undefined && (
        <Text size="2" emphasis="medium" className="kd-num">
          {count}
        </Text>
      )}
    </Flex>
  );
}

/** An input as it would sit in its field: the label, then the words or the picture. A card, because it contains one value. */
function InputField({ input }: { input: TemplateInput }) {
  return (
    <Card size="2">
      <Stack gap="2">
        <Text size="2" emphasis="medium">
          {input.label}
        </Text>
        {input.text ? <Text size="2">{input.text}</Text> : <div className="kd-template-input-image" aria-hidden />}
      </Stack>
    </Card>
  );
}

/** An output: a box at the picture's shape, and its name under it, as a tile carries its name. */
function OutputPicture({ output }: { output: TemplateOutput }) {
  return (
    <figure className="kd-template-output">
      <div className="kd-template-output-box" style={output.ratio ? { aspectRatio: output.ratio } : undefined}>
        {output.video && (
          <span className="kd-template-play" aria-label="Video">
            <RunIcon />
          </span>
        )}
      </div>
      <figcaption>
        <Text size="2" emphasis="medium">
          {output.label}
        </Text>
      </figcaption>
    </figure>
  );
}
