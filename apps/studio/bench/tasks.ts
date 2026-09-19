/**
 * The scenes. Twenty asks, with what a good answer looks like written as checks a machine can make.
 *
 * WHERE THEY COME FROM: Home's four starters, the two asks the owner really sent (2026-09-17), the
 * failures already in the database (an empty prompt ran 24 times; a picture under the model's minimum
 * ran 4 times), and the judgement calls the harness makes (extend or start a new graph; ask or build;
 * drafts or one shot).
 *
 * WHAT A CHECK MAY NOT DO: judge a picture. Nothing here renders, so every check is about the graph,
 * the money and the order of events. Five of the scenes are deliberate baselines for gaps the plan
 * names — a run that cannot work, a picture too small, a price declined — so they are expected to fail
 * until those are built, and the failure is the measurement.
 *
 * Tiers: 1 one step, 2 a pipeline, 3 judgement.
 */

import type { Entity } from '@kushagradhawan/kookie-flow';
import { estimateNodeSize, registry, valueBag, type GraphDocument, type MediaRef } from 'studio-core';
import type { HostState } from './host';
import type { ToolTrace } from './tools';

export interface TaskState {
  state: HostState;
  trace: ToolTrace[];
  created: Array<{ name: string; doc: GraphDocument }>;
  /** What the agent said, each turn, in order. */
  said: string[];
}

export interface Task {
  id: string;
  tier: 1 | 2 | 3;
  ask: string;
  /** Answers to give if the agent comes back before it is done, in order. */
  replies?: string[];
  startDoc?: () => GraphDocument;
  /** What the person presses when the agent asks to spend. Default: Run. */
  approve?: (run: { nodes: string[]; micros: number; index: number }) => boolean;
  /** Empty means the scene passed. */
  expect: (t: TaskState) => string[];
  /** A gap in the harness, not the model: expected to fail until the plan's step lands. */
  baselineFor?: string;
}

// Reading the graph ------------------------------------------------------------------------------

const nodes = (t: TaskState, type: string): Entity[] => t.state.doc.entities.filter((e) => e.type === type);
const all = (t: TaskState): Entity[] => t.state.doc.entities;
const value = (entity: Entity, socket: string): unknown => valueBag(entity)[socket];

/** Is `to`'s input fed, directly or through anything, by `from`? */
function feeds(t: TaskState, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const here = stack.pop() as string;
    for (const edge of t.state.doc.edges) {
      if (edge.target !== here) continue;
      if (edge.source === from) return true;
      if (!seen.has(edge.source)) {
        seen.add(edge.source);
        stack.push(edge.source);
      }
    }
  }
  return false;
}

const wiredInto = (t: TaskState, id: string, socket: string): boolean =>
  t.state.doc.edges.some((e) => e.target === id && e.targetSocket === socket);

const ranNodes = (t: TaskState): string[] => t.state.runs.filter((r) => r.approved).flatMap((r) => r.nodes);
const ran = (t: TaskState, id: string): boolean => ranNodes(t).includes(id);
const calls = (t: TaskState, name: string): ToolTrace[] => t.trace.filter((c) => c.name === name);
const askedQuestion = (t: TaskState): boolean => t.said.some((s) => s.includes('?'));
const positioned = (t: TaskState): boolean => calls(t, 'apply_ops').length > 0 && t.state.doc.entities.length > 0;

/** The shape the vision is built on: several cheap drafts, a pick, one dear final. */
function draftsPickFinal(t: TaskState): string[] {
  const problems: string[] = [];
  const picks = nodes(t, 'logic/pick');
  if (picks.length !== 1) return [`wanted one pick node, found ${picks.length}`];
  const pick = picks[0];
  const drafts = all(t).filter((e) => ['a', 'b', 'c', 'd'].some((s) => t.state.doc.edges.some((edge) => edge.source === e.id && edge.target === pick.id && edge.targetSocket === s)));
  if (drafts.length < 2) problems.push(`wanted at least two drafts into the pick, found ${drafts.length}`);
  const finals = all(t).filter((e) => e.id !== pick.id && feeds(t, pick.id, e.id));
  if (finals.length === 0) problems.push('nothing is wired after the pick');
  const cheap = drafts.every((d) => d.type !== 'ai/gpt-image-2.5' || ['low', 'medium'].includes(String(value(d, 'quality') ?? 'medium')));
  if (!cheap) problems.push('the drafts are not at a cheap quality');
  for (const final of finals) {
    if (ran(t, final.id) && String(value(pick, 'choice') ?? 'none') === 'none') {
      problems.push('the final ran before anything was picked');
    }
  }
  if (drafts.some((d) => !ran(t, d.id))) problems.push('the drafts were not run');
  return problems;
}

function noRefusals(t: TaskState): string[] {
  return t.state.refusals.length ? [`${t.state.refusals.length} ops refused: ${t.state.refusals[0]}`] : [];
}

function spentNothing(t: TaskState): string[] {
  const spent = t.state.runs.filter((r) => r.approved);
  return spent.length ? [`ran ${spent.length} time(s) when it should not have`] : [];
}

// Start documents -------------------------------------------------------------------------------

const PICTURE_LANDSCAPE: MediaRef = {
  kind: 'image',
  hash: 'cd9da959113eddbd5e1efb660ee82180133bd85fc6033ee6c612e95f2ad55c21',
  mime: 'image/jpeg',
  width: 1024,
  height: 768,
  url: '/api/blob/cd9da959113eddbd5e1efb660ee82180133bd85fc6033ee6c612e95f2ad55c21',
  preview: '/api/blob/cd9da959113eddbd5e1efb660ee82180133bd85fc6033ee6c612e95f2ad55c21',
};

/** 572 × 1024 is 585,728 pixels: under GPT Image's 655,360 minimum, so an edit of it is refused. */
const PICTURE_SMALL: MediaRef = {
  kind: 'image',
  hash: 'bdb5996cf78584fde2705735aaae0c087173ad346780a6a2cbe70594f268e3b4',
  mime: 'image/jpeg',
  width: 572,
  height: 1024,
  url: '/api/blob/bdb5996cf78584fde2705735aaae0c087173ad346780a6a2cbe70594f268e3b4',
  preview: '/api/blob/bdb5996cf78584fde2705735aaae0c087173ad346780a6a2cbe70594f268e3b4',
};

function doc(entities: Entity[], edges: GraphDocument['edges'] = []): GraphDocument {
  return { version: 1, entities, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

function node(id: string, type: string, values: Record<string, unknown> = {}, at = { x: 0, y: 0 }, label?: string): Entity {
  const entity = registry.create(type, id, at, values);
  if (label) entity.data.label = label;
  return entity;
}

const withPicture = (picture: MediaRef = PICTURE_LANDSCAPE) => () =>
  doc([node('n1', 'source/image', { image: picture }, { x: 0, y: 0 }, 'Photo')]);

/** Work already on the canvas: a prompt into an image, run once. */
const finishedWork = () =>
  doc(
    [
      node('n1', 'source/text', { value: 'A brass desk lamp on a walnut table' }, { x: 0, y: 0 }, 'Brief'),
      node('n2', 'ai/gpt-image-2.5', { quality: 'high' }, { x: 420, y: 0 }, 'Final'),
    ],
    [{ id: 'n1-out-n2-prompt', source: 'n1', sourceSocket: 'out', target: 'n2', targetSocket: 'prompt' }]
  );

export const TASKS: Task[] = [
  // Tier 1 ---------------------------------------------------------------------------------------
  {
    id: 'one-image',
    tier: 1,
    ask: 'Make me one image, no drafts and no alternatives: a red ceramic teapot on a sunlit windowsill.',
    expect: (t) => {
      const images = nodes(t, 'ai/gpt-image-2.5');
      const problems = [...noRefusals(t)];
      if (images.length !== 1) problems.push(`wanted one image node, found ${images.length}`);
      if (nodes(t, 'logic/pick').length) problems.push('made a pick when one image was asked for');
      const only = images[0];
      if (only && !String(value(only, 'prompt') ?? '').trim() && !wiredInto(t, only.id, 'prompt')) {
        problems.push('the image node has no prompt');
      }
      if (only && !ran(t, only.id)) problems.push('never ran it');
      return problems;
    },
  },
  {
    id: 'upscale-this',
    tier: 1,
    ask: 'Upscale this photo for print.',
    startDoc: withPicture(),
    expect: (t) => {
      const up = nodes(t, 'ai/clarity-upscaler');
      const problems = [...noRefusals(t)];
      if (up.length !== 1) problems.push(`wanted one upscaler, found ${up.length}`);
      if (up[0] && !feeds(t, 'n1', up[0].id)) problems.push('the upscaler is not fed by the photo');
      if (up[0] && !ran(t, up[0].id)) problems.push('never ran it');
      return problems;
    },
  },
  {
    id: 'cut-out',
    tier: 1,
    ask: 'Remove the background from this photo.',
    startDoc: withPicture(),
    expect: (t) => {
      const cut = nodes(t, 'ai/birefnet');
      const problems = [...noRefusals(t)];
      if (cut.length !== 1) problems.push(`wanted one BiRefNet, found ${cut.length}`);
      if (cut[0] && !feeds(t, 'n1', cut[0].id)) problems.push('the cutout is not fed by the photo');
      if (cut[0] && !ran(t, cut[0].id)) problems.push('never ran it');
      return problems;
    },
  },
  {
    id: 'tidy-up',
    tier: 1,
    ask: 'Tidy up the graph, it is a mess.',
    startDoc: () =>
      doc(
        [
          node('n1', 'source/text', { value: 'A lighthouse in fog' }, { x: 900, y: 640 }, 'Brief'),
          node('n2', 'ai/gpt-image-2.5', {}, { x: 120, y: -200 }, 'Image'),
          node('n3', 'ai/clarity-upscaler', {}, { x: 500, y: 900 }, 'Sharper'),
        ],
        [
          { id: 'n1-out-n2-prompt', source: 'n1', sourceSocket: 'out', target: 'n2', targetSocket: 'prompt' },
          { id: 'n2-image-n3-image', source: 'n2', sourceSocket: 'image', target: 'n3', targetSocket: 'image' },
        ]
      ),
    expect: (t) => {
      const problems = [...noRefusals(t), ...spentNothing(t)];
      if (all(t).length !== 3) problems.push(`the node count changed to ${all(t).length}`);
      const at = new Map(all(t).map((e) => [e.id, e.position]));
      const brief = at.get('n1');
      const image = at.get('n2');
      const sharp = at.get('n3');
      if (!brief || !image || !sharp) return [...problems, 'a node went missing'];
      if (!(brief.x < image.x && image.x < sharp.x)) problems.push('the nodes are not left to right by their wiring');
      // MIDDLES, NOT TOPS. `layoutGraph` centres a column across the flow, so a short text node and a
      // tall image node in one row share a centre line and not a top edge. Comparing tops failed all
      // twelve trials against a layout that was in fact correct (2026-09-18).
      const middle = (id: string) => {
        const entity = all(t).find((e) => e.id === id);
        if (!entity) return null;
        const size = estimateNodeSize(registry, entity.type);
        return entity.position.y + (entity.height ?? size.h) / 2;
      };
      const [briefMid, imageMid, sharpMid] = [middle('n1'), middle('n2'), middle('n3')];
      if (briefMid === null || imageMid === null || sharpMid === null) return [...problems, 'a node went missing'];
      if (Math.abs(briefMid - imageMid) > 80 || Math.abs(imageMid - sharpMid) > 80) {
        problems.push('the row does not share a centre line');
      }
      return problems;
    },
  },
  {
    id: 'run-empty-prompt',
    tier: 1,
    baselineFor: 'pre-flight (plan step 5)',
    ask: 'Run this.',
    startDoc: () => doc([node('n1', 'ai/gpt-image-2.5', { quality: 'low' }, { x: 0, y: 0 }, 'Image')]),
    expect: (t) => {
      const problems: string[] = [];
      // The right answer is to notice the prompt is empty and ask, not to spend on a job that fails.
      if (ran(t, 'n1')) problems.push('ran a node whose prompt is empty');
      if (!askedQuestion(t) && !String(value(all(t).find((e) => e.id === 'n1') as Entity, 'prompt') ?? '').trim()) {
        problems.push('neither asked for a prompt nor set one');
      }
      return problems;
    },
  },

  // Tier 2 ---------------------------------------------------------------------------------------
  {
    id: 'concept-controller',
    tier: 2,
    ask: 'Concept art for a controller for a handheld games console. It is a concept, not a product shot, for a pitch deck.',
    expect: (t) => [...noRefusals(t), ...draftsPickFinal(t)],
  },
  {
    id: 'launch-images',
    tier: 2,
    ask: 'Launch images for a new sneaker, from this product shot. Bright, clean, for Instagram.',
    startDoc: withPicture(),
    expect: (t) => {
      const problems = [...noRefusals(t), ...draftsPickFinal(t)];
      const drafts = nodes(t, 'ai/gpt-image-2.5');
      if (drafts.length && !drafts.some((d) => feeds(t, 'n1', d.id))) problems.push('the product shot feeds nothing');
      return problems;
    },
  },
  {
    id: 'relight-three-ways',
    tier: 2,
    ask: 'Relight this portrait three ways: golden hour, studio, overcast.',
    startDoc: withPicture(),
    expect: (t) => {
      const problems = [...noRefusals(t)];
      const edits = nodes(t, 'ai/gpt-image-2.5').filter((e) => feeds(t, 'n1', e.id));
      if (edits.length < 3) problems.push(`wanted three relights from the photo, found ${edits.length}`);
      if (edits.length && edits.some((e) => !ran(t, e.id))) problems.push('not every relight was run');
      return problems;
    },
  },
  {
    id: 'animate-photo',
    tier: 2,
    ask: 'Animate this photo: mist rolling slowly over the ridge. A draft first, cheap.',
    startDoc: withPicture(),
    expect: (t) => {
      const clips = nodes(t, 'video/wan-i2v');
      const problems = [...noRefusals(t)];
      if (clips.length === 0) problems.push('no clip node');
      if (clips[0] && !feeds(t, 'n1', clips[0].id)) problems.push('the clip is not fed by the photo');
      if (clips[0] && String(value(clips[0], 'resolution') ?? '720p') !== '480p') problems.push('the draft clip is not at 480p');
      if (clips[0] && !ran(t, clips[0].id)) problems.push('never ran it');
      return problems;
    },
  },
  {
    id: 'lookbook',
    tier: 2,
    ask: 'A lookbook from this brief: sun-faded sportswear, saffron and denim, shot against open sky. Four looks that belong together.',
    expect: (t) => {
      const problems = [...noRefusals(t)];
      const images = nodes(t, 'ai/gpt-image-2.5');
      if (images.length < 4) problems.push(`wanted four looks, found ${images.length}`);
      if (images.length && images.filter((e) => ran(t, e.id)).length < 4) problems.push('fewer than four looks were run');
      const shared = nodes(t, 'source/text').concat(nodes(t, 'text/template'));
      if (!shared.length) problems.push('the brief is not shared by the looks');
      return problems;
    },
  },
  {
    id: 'cutout-place-upscale',
    tier: 2,
    ask: 'Take this product, cut it out, place it in a bright Scandinavian living room with oak floors and late afternoon light, then sharpen it for print.',
    startDoc: withPicture(),
    expect: (t) => {
      const problems = [...noRefusals(t)];
      const cut = nodes(t, 'ai/birefnet')[0];
      const place = nodes(t, 'ai/gpt-image-2.5')[0];
      const sharp = nodes(t, 'ai/clarity-upscaler')[0];
      if (!cut) problems.push('nothing cuts the product out');
      if (!place) problems.push('nothing places it in a room');
      if (!sharp) problems.push('nothing sharpens it');
      if (cut && place && !feeds(t, cut.id, place.id)) problems.push('the cutout does not feed the placement');
      if (place && sharp && !feeds(t, place.id, sharp.id)) problems.push('the placement does not feed the sharpening');
      if (cut && !feeds(t, 'n1', cut.id)) problems.push('the product does not feed the cutout');
      return problems;
    },
  },
  {
    id: 'exact-edit',
    tier: 2,
    ask: 'Make this photo black and white, nothing else, then upscale it twice.',
    startDoc: withPicture(),
    expect: (t) => {
      const problems = [...noRefusals(t)];
      if (nodes(t, 'logic/pick').length) problems.push('made a pick for an exact edit');
      const edits = nodes(t, 'ai/gpt-image-2.5');
      if (edits.length !== 1) problems.push(`wanted one edit, found ${edits.length}`);
      const up = nodes(t, 'ai/clarity-upscaler')[0];
      if (!up) problems.push('no upscaler');
      if (up && String(value(up, 'factor') ?? 2) !== '2' && Number(value(up, 'factor') ?? 2) !== 2) {
        problems.push('the upscale is not twice');
      }
      if (edits[0] && up && !feeds(t, edits[0].id, up.id)) problems.push('the edit does not feed the upscaler');
      return problems;
    },
  },
  {
    id: 'extend-canvas',
    tier: 2,
    ask: 'Add an upscale after the final and run it.',
    startDoc: finishedWork,
    expect: (t) => {
      const problems = [...noRefusals(t)];
      if (t.created.length) problems.push('started a new graph when asked to extend this one');
      const up = nodes(t, 'ai/clarity-upscaler')[0];
      if (!up) problems.push('no upscaler was added');
      if (up && !feeds(t, 'n2', up.id)) problems.push('the upscaler is not fed by the final');
      if (up && !ran(t, up.id)) problems.push('never ran it');
      return problems;
    },
  },
  {
    id: 'new-graph',
    tier: 2,
    ask: 'Forget the lamp, that is done. Start something completely separate: a poster for a jazz night at a basement bar.',
    startDoc: finishedWork,
    expect: (t) => {
      const problems = [...noRefusals(t)];
      if (!t.created.length) problems.push('did not start a new graph for unrelated work');
      if (all(t).length !== 2) problems.push(`added ${all(t).length - 2} node(s) to the old graph`);
      return problems;
    },
  },

  // Tier 3 ---------------------------------------------------------------------------------------
  {
    id: 'two-words',
    tier: 3,
    ask: 'gaming controller',
    expect: (t) => {
      const problems = [...spentNothing(t)];
      if (!askedQuestion(t)) problems.push('did not ask anything about a two-word brief');
      if (nodes(t, 'ai/gpt-image-2.5').length) problems.push('built before asking');
      return problems;
    },
  },
  {
    id: 'vague-brief',
    tier: 3,
    ask: 'I need something for my brand.',
    expect: (t) => {
      const problems = [...spentNothing(t)];
      if (!askedQuestion(t)) problems.push('did not ask anything about a vague brief');
      if (all(t).length > 0) problems.push('built before asking');
      return problems;
    },
  },
  {
    id: 'pick-then-final',
    tier: 3,
    ask: 'Concept art for a pair of over-ear headphones, matte black, for a launch page. Show me a few directions first.',
    replies: ['The second one. Make the final from that.'],
    expect: (t) => {
      const problems = [...noRefusals(t), ...draftsPickFinal(t)];
      const pick = nodes(t, 'logic/pick')[0];
      if (pick && String(value(pick, 'choice') ?? 'none') !== '2') {
        problems.push(`the pick is on "${String(value(pick, 'choice') ?? 'none')}" after the person said the second one`);
      }
      const finals = pick ? all(t).filter((e) => e.id !== pick.id && feeds(t, pick.id, e.id)) : [];
      if (finals.length && !finals.some((f) => ran(t, f.id))) problems.push('the final was never run after the pick');
      return problems;
    },
  },
  {
    id: 'price-declined',
    tier: 3,
    baselineFor: 'what happens when the person says no',
    ask: 'Make four concept images of a titanium water bottle and a finished one at high quality.',
    approve: () => false,
    expect: (t) => {
      const problems = [...noRefusals(t)];
      if (t.state.runs.some((r) => r.approved)) problems.push('spent after the person declined');
      if (t.state.runs.length > 2) problems.push(`asked to spend ${t.state.runs.length} times after being told no`);
      if (!all(t).length) problems.push('built nothing at all');
      return problems;
    },
  },
  {
    id: 'picture-too-small',
    tier: 3,
    baselineFor: 'pre-flight (plan step 5)',
    ask: 'Add falling snow to this photo.',
    startDoc: withPicture(PICTURE_SMALL),
    expect: (t) => {
      const problems: string[] = [];
      const edit = nodes(t, 'ai/gpt-image-2.5')[0];
      // 572 × 1024 is under the model's minimum: the run fails at the provider, after the money is held.
      if (edit && ran(t, edit.id)) problems.push('ran an edit on a picture below the model\'s minimum size');
      if (!askedQuestion(t) && !nodes(t, 'ai/clarity-upscaler').length) {
        problems.push('neither said the picture is too small nor enlarged it first');
      }
      return problems;
    },
  },
  {
    id: 'positions-left-alone',
    tier: 3,
    ask: 'Build a cheap draft and a high-quality final of a linen sofa in a loft, and put them somewhere sensible on the canvas.',
    expect: (t) => {
      const problems = [...noRefusals(t)];
      const placed = calls(t, 'apply_ops').length > 0;
      if (!placed) problems.push('built nothing');
      // Positions are the harness's job: the model should not be naming coordinates.
      const moves = t.state.doc.entities.filter((e) => e.position.x === 0 && e.position.y === 0);
      if (moves.length > 1) problems.push(`${moves.length} nodes sit at the origin, so nothing laid them out`);
      if (!positioned(t)) problems.push('no ops were applied');
      return problems;
    },
  },
];

export const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));
