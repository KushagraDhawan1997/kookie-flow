/**
 * MOCK PLANS. What the agent would build for each starter ask on Home, so a person sees the harness
 * before it exists: it asks first, tries ideas cheaply, lets you pick, then makes the final with the
 * best model (plans/studio/vision.md). The prices are real: each is the charging code's estimate for
 * that step's settings, with the fee.
 */
import { paidFor, picture } from '../models/models';

export type StepKind = 'ask' | 'prepare' | 'draft' | 'pick' | 'final';

export interface PlanStep {
  kind: StepKind;
  title: string;
  /** A model's slug, or `agent` for the language model that plans. Absent for a logic step. */
  model?: string;
  /** The settings that set the price, as the node would show them. */
  setting?: string;
  /** How many runs, and what one costs you in dollars. A step with no `each` costs nothing. */
  runs?: number;
  each?: number;
}

export interface Starter {
  id: string;
  label: string;
  /** What choosing the starter puts in the box. */
  ask: string;
  steps: PlanStep[];
}

const square = picture(1024, 1024);

const PICK: PlanStep = {
  kind: 'pick',
  title: 'Pick',
};

export const STARTERS: Starter[] = [
  {
    id: 'concept',
    label: 'Concept a product',
    ask: 'Concept art for a controller for a handheld games console',
    steps: [
      { kind: 'ask', title: 'Ask', model: 'agent' },
      {
        kind: 'draft',
        title: 'Drafts',
        model: 'gpt-image-2-5',
        setting: 'Low',
        runs: 4,
        each: paidFor('gpt-image-2.5', { quality: 'low', size: 'square_hd' }),
      },
      PICK,
      {
        kind: 'final',
        title: 'Final',
        model: 'gpt-image-2-5',
        setting: 'High',
        runs: 1,
        each: paidFor('gpt-image-2.5', { quality: 'high', image: square }),
      },
    ],
  },
  {
    id: 'launch',
    label: 'Launch images',
    ask: 'Launch images for a new sneaker, from this product shot',
    steps: [
      { kind: 'ask', title: 'Ask', model: 'agent' },
      {
        kind: 'prepare',
        title: 'Cut out',
        model: 'birefnet',
        setting: 'Light',
        runs: 1,
        each: paidFor('birefnet', {}),
      },
      {
        kind: 'draft',
        title: 'Drafts',
        model: 'gpt-image-2-5',
        setting: 'Low',
        runs: 3,
        each: paidFor('gpt-image-2.5', { quality: 'low', image: square }),
      },
      PICK,
      {
        kind: 'final',
        title: 'Final',
        model: 'gpt-image-2-5',
        setting: 'High',
        runs: 1,
        each: paidFor('gpt-image-2.5', { quality: 'high', image: square }),
      },
    ],
  },
  {
    id: 'animate',
    label: 'Animate a photo',
    ask: 'Animate this photo: mist rolling slowly over the ridge',
    steps: [
      { kind: 'ask', title: 'Ask', model: 'agent' },
      {
        kind: 'draft',
        title: 'Drafts',
        model: 'wan-image-to-video',
        setting: '480p',
        runs: 2,
        each: paidFor('wan-i2v', { resolution: '480p' }),
      },
      PICK,
      {
        kind: 'final',
        title: 'Final',
        model: 'wan-image-to-video',
        setting: '720p',
        runs: 1,
        each: paidFor('wan-i2v', { resolution: '720p' }),
      },
    ],
  },
  {
    id: 'relight',
    label: 'Relight a portrait',
    ask: 'Relight this portrait three ways: golden hour, studio, overcast',
    steps: [
      { kind: 'ask', title: 'Ask', model: 'agent' },
      {
        kind: 'prepare',
        title: 'Cut out',
        model: 'birefnet',
        setting: 'Portrait',
        runs: 1,
        each: paidFor('birefnet', { model: 'Portrait' }),
      },
      {
        kind: 'draft',
        title: 'Drafts',
        model: 'gpt-image-2-5',
        setting: 'Low',
        runs: 3,
        each: paidFor('gpt-image-2.5', { quality: 'low', image: square }),
      },
      PICK,
      {
        kind: 'final',
        title: 'Final',
        model: 'gpt-image-2-5',
        setting: 'High',
        runs: 1,
        each: paidFor('gpt-image-2.5', { quality: 'high', image: square }),
      },
    ],
  },
];

export function planTotal(steps: PlanStep[]): number {
  return steps.reduce((sum, step) => sum + (step.runs ?? 0) * (step.each ?? 0), 0);
}
