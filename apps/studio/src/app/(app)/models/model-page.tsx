'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Flex,
  Heading,
  Link,
  Notice,
  Page,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  ToolbarButton,
} from '@kookie-ui/react';

import { CopyIcon, ExternalIcon } from '../../icons';
import { ProviderLogo } from '../../provider-logos';
import { AppPane } from '../app-shell';
import { ModelRow } from './models-page';
import {
  columnDollars,
  dollars,
  findModel,
  fromPrice,
  gptPicturePrice,
  HOSTS,
  modelSockets,
  MODELS,
  priceSheet,
  type Model,
  type SocketRow,
} from './models';
import './model-page.css';

/**
 * One model, laid out after the model pages that already do this well:
 *
 * - the facts under the title, labelled, in one row (OpenRouter's strip, Replicate's meta line);
 * - examples before anything technical (fal and Replicate lead with output);
 * - prices as a table of the choices that move them (OpenRouter's pricing table, fal's one-line rule);
 * - who runs it, with the endpoint and the host's terms (OpenRouter's and Vercel's Providers);
 * - every input with its type and default (fal's Schema, Replicate's API inputs);
 * - similar models last (Vercel's Similar).
 *
 * MOCK: the examples are grey boxes, and "Try in a graph" makes an empty graph under the model's name.
 */
export function ModelPage({ slug }: { slug: string }) {
  const router = useRouter();
  const model = findModel(slug);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  if (!model) return null;

  const tryIt = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model.name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      router.push(`/g/${id}`);
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : 'The graph could not be created.');
    }
  };

  const action = model.price ? (
    <ToolbarButton emphasis="loud" tone="accent" loading={busy} onClick={() => void tryIt()}>
      Try in a graph
    </ToolbarButton>
  ) : undefined;

  const { inputs, outputs } = modelSockets(model);
  const similar = MODELS.filter((m) => m.kind === model.kind && m.slug !== model.slug);

  return (
    <AppPane actions={action} back={{ href: '/models', label: 'Back to models' }}>
      <Page title={model.name} description={model.summary}>
        <Stack gap="9">
          {problem && <Notice tone="destructive">{problem}</Notice>}
          <Facts model={model} />
          <Examples model={model} />
          <Pricing model={model} />
          <ServedBy model={model} />
          {inputs.length > 0 && <Sockets title="Inputs" rows={inputs} withDefault />}
          {outputs.length > 0 && <Sockets title="Outputs" rows={outputs} />}
          {similar.length > 0 && (
            <Section title="Similar models">
              <div className="kd-models-list">
                {similar.map((m) => (
                  <ModelRow key={m.slug} model={m} />
                ))}
              </div>
            </Section>
          )}
        </Stack>
      </Page>
    </AppPane>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Stack gap="4" render={<section />}>
      <Stack gap="1">
        <Heading size="6" render={<h2 />}>
          {title}
        </Heading>
        {description && (
          <Text size="2" emphasis="medium">
            {description}
          </Text>
        )}
      </Stack>
      {children}
    </Stack>
  );
}

function Facts({ model }: { model: Model }) {
  const host = model.source ? HOSTS[model.source.host] : undefined;
  return (
    <dl className="kd-model-facts">
      <Fact label="Made by">
        <Flex gap="2" align="center">
          <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} />
          {model.maker}
        </Flex>
      </Fact>
      <Fact label="Served by">
        {host ? (
          <Flex gap="2" align="center">
            <ProviderLogo provider={host.logo} maker={host.name} name={host.name} />
            {host.name}
          </Flex>
        ) : (
          'Not yet'
        )}
      </Fact>
      <Fact label="Price">{model.price ? fromPrice(model.price) : 'Soon'}</Fact>
      {model.source && <Fact label="Commercial use">{model.source.commercial ? 'Allowed' : 'Not allowed'}</Fact>}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kd-model-fact">
      <dt>
        <Text size="2" emphasis="medium">
          {label}
        </Text>
      </dt>
      <dd>
        <Text size="3" weight="medium" render={<div />} className="kd-num">
          {children}
        </Text>
      </dd>
    </div>
  );
}

function Examples({ model }: { model: Model }) {
  return (
    <Section title="Examples">
      <div className="kd-model-examples" data-kind={model.kind}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="kd-model-example" aria-hidden />
        ))}
      </div>
    </Section>
  );
}

function Pricing({ model }: { model: Model }) {
  const sheet = priceSheet(model);
  if (!model.price || !sheet) return null;
  const note =
    model.slug === 'gpt-image-2-5'
      ? `${model.price.note} Each picture you connect adds ${dollars(gptPicturePrice())}.`
      : model.price.note;
  const money = columnDollars(sheet.rows.flatMap((row) => row.prices));
  return (
    <Section title="Pricing" description={note}>
      <Table className="kd-model-table">
          <TableHeader>
            <TableRow>
              <TableHead>{sheet.corner}</TableHead>
              {sheet.columns.map((column) => (
                <TableHead key={column} align="end" className="kd-num">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>
                  <Text size="2" className="kd-num">
                    {row.label}
                  </Text>
                </TableCell>
                {row.prices.map((price, i) => (
                  <TableCell key={sheet.columns[i]} align="end">
                    <Text size="2" className="kd-num">
                      {money(price)}
                    </Text>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </Section>
  );
}

/**
 * The host, laid out as Vercel's and OpenRouter's provider rows are: the name, with its legal
 * links quiet under it, and each endpoint as plain mono text with a copy button. The row
 * top-aligns, so the name and the first endpoint share a line however many endpoints follow.
 */
function ServedBy({ model }: { model: Model }) {
  if (!model.source) return null;
  const { source } = model;
  const host = HOSTS[source.host];
  return (
    <Section
      title="Served by"
      description={`Every run of this model goes to ${host.name}. Using it means you agree to ${host.name}'s terms, listed under Legal.`}
    >
      <Table className="kd-model-table kd-model-served">
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>{source.endpoints.length > 1 ? 'Endpoints' : 'Endpoint'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>
              <Flex gap="3" align="start">
                <Text size="2" render={<span />} className="kd-model-host-logo">
                  <ProviderLogo provider={host.logo} maker={host.name} name={host.name} />
                </Text>
                <Stack gap="1">
                  <Text size="2" weight="medium" className="kd-model-line">
                    <Link href={source.page} target="_blank" rel="noreferrer" tone="neutral">
                      {host.name}
                    </Link>
                    <span className="kd-model-external" aria-hidden>
                      <ExternalIcon />
                    </span>
                  </Text>
                  <Text size="2" emphasis="medium">
                    Legal:{' '}
                    <Link href={host.terms} target="_blank" rel="noreferrer" tone="neutral">
                      Terms
                    </Link>
                    {' · '}
                    <Link href={host.privacy} target="_blank" rel="noreferrer" tone="neutral">
                      Privacy
                    </Link>
                  </Text>
                </Stack>
              </Flex>
            </TableCell>
            <TableCell>
              <Stack gap="2">
                {source.endpoints.map((endpoint) => (
                  <Endpoint key={endpoint} id={endpoint} />
                ))}
              </Stack>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Section>
  );
}

/** How long the tick stays after a copy: long enough to see, short enough to copy again. */
const COPIED_MS = 1500;

function Endpoint({ id }: { id: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch (error) {
      console.error('Could not copy the endpoint', error);
    }
  };
  return (
    <Flex gap="1" align="center" className="kd-model-line">
      <Text size="2" className="kd-mono">
        {id}
      </Text>
      <Button
        iconOnly
        emphasis="quiet"
        done={copied}
        aria-label={copied ? 'Copied' : `Copy ${id}`}
        onClick={() => void copy()}
      >
        <CopyIcon />
      </Button>
    </Flex>
  );
}

function Sockets({ title, rows, withDefault = false }: { title: string; rows: SocketRow[]; withDefault?: boolean }) {
  return (
    <Section title={title}>
      <Table className="kd-model-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              {withDefault && <TableHead>Default</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>
                  <Stack gap="0">
                    <Text size="2" weight="medium">
                      {row.name}
                    </Text>
                    {row.about && (
                      <Text size="2" emphasis="medium">
                        {row.about}
                      </Text>
                    )}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Text size="2">{row.type}</Text>
                </TableCell>
                {withDefault && (
                  <TableCell>
                    <Text size="2" emphasis={row.fallback ? undefined : 'medium'}>
                      {row.fallback ?? '—'}
                    </Text>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </Section>
  );
}
