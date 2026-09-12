/**
 * One node definition, written once.
 *
 * From this object the registry derives the canvas's entity type (sockets, widgets, the preview
 * band, the evaluation mode), the agent's tool schema, validation, and later the published app's
 * form. Nothing about a node is stated twice.
 */

import type {
  AccentColor,
  EvaluationMode,
  SocketLayoutMode,
  WidgetType,
} from '@kushagradhawan/kookie-flow';
import type { MediaRef } from './values';
import type { RunContext } from './ports';

export type StudioSocketType =
  | 'image'
  | 'video'
  | 'mask'
  | 'text'
  | 'float'
  | 'int'
  | 'bool'
  | 'color'
  | 'seed'
  | 'any';

export type ValueOf<T extends StudioSocketType> = T extends 'image' | 'video' | 'mask'
  ? MediaRef
  : T extends 'text' | 'color'
    ? string
    : T extends 'float' | 'int' | 'seed'
      ? number
      : T extends 'bool'
        ? boolean
        : unknown;

export interface SocketSpec<T extends StudioSocketType = StudioSocketType> {
  type: T;
  /** Shown beside the socket. Defaults to the key, title-cased. */
  label?: string;
  /** Read by the agent. */
  description?: string;
  /** Overrides the socket type's default widget; `false` draws none. */
  widget?: WidgetType | false;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  placeholder?: string;
  rows?: number;
  layout?: SocketLayoutMode;
  /** The value an unconnected input has when nobody has touched its widget. */
  default?: ValueOf<T>;
}

export function socket<T extends StudioSocketType>(
  type: T,
  spec: Omit<SocketSpec<T>, 'type'> = {}
): SocketSpec<T> {
  return { type, ...spec };
}

export type SocketSpecs = Record<string, SocketSpec>;

export type Values<S extends SocketSpecs> = { [K in keyof S]: ValueOf<S[K]['type']> };

/** Where a node's work happens. The app's dispatcher reads this; a node never does. */
export type Where = 'inline' | 'gpu' | 'media' | 'server';

export type Category =
  | 'source'
  | 'text'
  | 'math'
  | 'list'
  | 'logic'
  | 'image'
  | 'video'
  | 'ai'
  | 'output';

export const CATEGORY_LABELS: Record<Category, string> = {
  source: 'Sources',
  text: 'Text',
  math: 'Math',
  list: 'Lists',
  logic: 'Logic',
  image: 'Image',
  video: 'Video',
  ai: 'AI',
  output: 'Output',
};

export interface Estimate {
  /** In credits; 0 for anything deterministic. */
  credits: number;
  /** Rough wall-clock seconds. */
  seconds: number;
}

export interface NodeDefinition<I extends SocketSpecs = SocketSpecs, O extends SocketSpecs = SocketSpecs> {
  /** `category/name`, stable forever: saved graphs name it. */
  type: string;
  label: string;
  category: Category;
  /** One or two sentences the agent reads to decide whether this is the node it wants. */
  description: string;
  inputs: I;
  outputs: O;
  /** `manual` for anything that costs money or minutes. Default: reactive. */
  evaluation?: EvaluationMode;
  where: Where;
  /** Bump when `run` changes its output for the same inputs, so caches miss. Default: 1. */
  version?: number;
  /** Which output the band shows. Default: the first picture or video output. */
  preview?: keyof O & string;
  previewHeight?: number;
  color?: AccentColor;
  width?: number;
  // Methods rather than properties so a specific definition assigns to the erased one: a method
  // parameter is checked bivariantly, a property's function type is not.
  run(inputs: Values<I>, ctx: RunContext): Promise<Partial<Values<O>>> | Partial<Values<O>>;
  estimate?(inputs: Partial<Values<I>>): Estimate;
}

/**
 * A definition with its socket shapes erased, which is what the registry holds. A separate
 * interface rather than `NodeDefinition<SocketSpecs, SocketSpecs>`: relating a generic mapped
 * return type to that instantiation fails in TypeScript, while relating it to a plain record
 * passes, and the method signatures stay bivariant either way.
 */
export interface AnyNodeDefinition {
  type: string;
  label: string;
  category: Category;
  description: string;
  inputs: SocketSpecs;
  outputs: SocketSpecs;
  evaluation?: EvaluationMode;
  where: Where;
  version?: number;
  preview?: string;
  previewHeight?: number;
  color?: AccentColor;
  width?: number;
  run(
    inputs: Record<string, unknown>,
    ctx: RunContext
  ): Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  estimate?(inputs: Record<string, unknown>): Estimate;
}

export function defineNode<I extends SocketSpecs, O extends SocketSpecs>(
  def: NodeDefinition<I, O>
): NodeDefinition<I, O> {
  return def;
}

export function titleCase(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
