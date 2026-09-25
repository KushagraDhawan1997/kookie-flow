'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { Flex, Heading, Page, Stack, Text } from '@kushagradhawan/kookie-ui-react';

import { ArrowRightIcon } from '../../icons';
import { ProviderLogo } from '../../provider-logos';
import { AppPane } from '../app-shell';
import { fromPrice, HOSTS, MODEL_KIND_LABEL, MODELS, type Model, type ModelKind } from './models';
import './models-page.css';

/**
 * Every model, a list after Krea's library: grouped by what it makes, one plain line each. What runs
 * today shows its cheapest run; what does not says "Soon" and is not a link.
 */
export function ModelsPage() {
  const kinds = Object.keys(MODEL_KIND_LABEL) as ModelKind[];
  return (
    <AppPane>
      <Page
        title="Models"
        description="Pay per run. No subscription."
      >
        <Stack gap="8">
          {kinds.map((kind) => {
            const models = MODELS.filter((m) => m.kind === kind);
            if (models.length === 0) return null;
            return (
              <Stack key={kind} gap="3">
                <Heading size="6" render={<h2 />}>
                  {MODEL_KIND_LABEL[kind]}
                </Heading>
                <div className="kd-models-list">
                  {models.map((model) => (
                    <ModelRow key={model.slug} model={model} />
                  ))}
                </div>
              </Stack>
            );
          })}
        </Stack>
      </Page>
    </AppPane>
  );
}

export function ModelRow({ model }: { model: Model }) {
  const words = (
    <Stack gap="1" className="kd-models-words">
      <Flex gap="2" align="center">
        {/* The mark names the maker, so the words do not repeat it. */}
        <ProviderLogo provider={model.logo} maker={model.maker} name={model.name} decorative={false} />
        <Text size="3" weight="medium">
          {model.name}
        </Text>
      </Flex>
      <Text size="2" emphasis="medium">
        {model.summary}
      </Text>
      <Text size="2" emphasis={model.price ? undefined : 'medium'} className="kd-num">
        {model.price ? fromPrice(model.price) : 'Soon'}
        {/* Where it runs, on the list as well as the page: OpenRouter and Vercel list providers per model. */}
        {model.source && ` · Served by ${HOSTS[model.source.host].name}`}
      </Text>
    </Stack>
  );
  return model.price ? (
    <NextLink href={`/models/${model.slug}`} className="kd-models-row">
      {words}
      <span className="kd-models-arrow" aria-hidden>
        <ArrowRightIcon />
      </span>
    </NextLink>
  ) : (
    <div className="kd-models-row" data-soon>
      {words}
    </div>
  );
}
