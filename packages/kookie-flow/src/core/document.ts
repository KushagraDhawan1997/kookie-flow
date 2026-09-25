import type { FlowObject } from '../types';
import { validateGraphStructure } from './graph-validation';

export interface FlowDocumentIssue {
  path: string;
  message: string;
}
export interface FlowDocumentLimits {
  /** Defaults to 100,000. Choose a smaller application limit when appropriate. */
  maxEntities?: number;
  /** Defaults to 500,000. */
  maxEdges?: number;
}
export class FlowDocumentError extends Error {
  constructor(public readonly issues: FlowDocumentIssue[]) {
    super(
      `Invalid flow document: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
    );
    this.name = 'FlowDocumentError';
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const widgets = [
  'slider',
  'number',
  'select',
  'checkbox',
  'text',
  'color',
  'textarea',
  'switch',
  'segmented',
  'vector',
  'seed',
];

/**
 * Validate persisted/remote data before giving it to the canvas. This checks the library's
 * document shape and references, not application payload semantics, URL trust, or execution
 * readiness. Custom data remains application-owned. Cycles and incomplete graphs are allowed;
 * use validateGraph for evaluation readiness. Function-valued inline widgets are not serializable.
 */
export function validateFlowObject(
  value: unknown,
  limits: FlowDocumentLimits = {}
): FlowDocumentIssue[] {
  const issues: FlowDocumentIssue[] = [];
  const fail = (path: string, message: string) => {
    issues.push({ path, message });
  };
  const str = (v: unknown, p: string, nonempty = false) => {
    if (typeof v !== 'string' || (nonempty && v.length === 0))
      fail(p, nonempty ? 'Expected a nonempty string' : 'Expected a string');
  };
  const num = (v: unknown, p: string, min = -Infinity, max = Infinity) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      fail(p, `Expected a finite number in [${min}, ${max}]`);
  };
  const bool = (v: unknown, p: string) => {
    if (typeof v !== 'boolean') fail(p, 'Expected a boolean');
  };
  const oneOf = (v: unknown, p: string, choices: readonly unknown[]) => {
    if (!choices.includes(v)) fail(p, `Expected one of ${choices.join(', ')}`);
  };
  const optional = (
    o: Record<string, unknown>,
    p: string,
    keys: string[],
    check: (v: unknown, p: string) => void
  ) => {
    for (const key of keys) if (o[key] !== undefined) check(o[key], `${p}.${key}`);
  };
  const strings = (v: unknown, p: string) => {
    if (!Array.isArray(v)) return fail(p, 'Expected an array');
    v.forEach((item, i) => str(item, `${p}[${i}]`));
  };
  const point = (v: unknown, p: string) => {
    if (!record(v)) return fail(p, 'Expected a position object');
    num(v.x, `${p}.x`);
    num(v.y, `${p}.y`);
  };
  const sockets = (v: unknown, p: string) => {
    if (!Array.isArray(v)) return fail(p, 'Expected an array');
    v.forEach((socket, i) => {
      const sp = `${p}[${i}]`;
      if (!record(socket)) return fail(sp, 'Expected a socket object');
      str(socket.id, `${sp}.id`, true);
      str(socket.name, `${sp}.name`);
      str(socket.type, `${sp}.type`, true);
      optional(socket, sp, ['min', 'max'], num);
      optional(socket, sp, ['step', 'height', 'rows'], (n, path) => num(n, path, Number.MIN_VALUE));
      optional(socket, sp, ['position'], (n, path) => num(n, path, 0, 1));
      optional(socket, sp, ['placeholder'], str);
      if (socket.dimensions !== undefined) oneOf(socket.dimensions, `${sp}.dimensions`, [2, 3, 4]);
      if (socket.widget !== undefined) oneOf(socket.widget, `${sp}.widget`, [false, ...widgets]);
      if (socket.options !== undefined) strings(socket.options, `${sp}.options`);
      if (socket.optionLabels !== undefined) {
        if (!record(socket.optionLabels)) fail(`${sp}.optionLabels`, 'Expected a string map');
        else
          for (const [key, label] of Object.entries(socket.optionLabels))
            str(label, `${sp}.optionLabels.${key}`);
      }
    });
  };
  if (!record(value)) return [{ path: '$', message: 'Expected a flow document object' }];
  const maxEntities = limits.maxEntities ?? 100_000,
    maxEdges = limits.maxEdges ?? 500_000;
  for (const [name, limit] of [
    ['entities', maxEntities],
    ['edges', maxEdges],
  ] as const) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError(`Invalid max ${name}: ${limit}`);
    if (!Array.isArray(value[name])) fail(`$.${name}`, 'Expected an array');
    else if (value[name].length > limit) fail(`$.${name}`, `Exceeds the ${limit} item limit`);
  }
  // Do not walk an oversized or malformed collection.
  if (issues.length) return issues;
  const entities = value.entities as unknown[],
    edges = value.edges as unknown[];
  point(value.viewport, '$.viewport');
  if (record(value.viewport)) num(value.viewport.zoom, '$.viewport.zoom', Number.MIN_VALUE);
  entities.forEach((entity, i) => {
    const p = `$.entities[${i}]`;
    if (!record(entity)) return fail(p, 'Expected an entity object');
    str(entity.id, `${p}.id`, true);
    str(entity.type, `${p}.type`, true);
    point(entity.position, `${p}.position`);
    if (!record(entity.data)) fail(`${p}.data`, 'Expected a data object');
    else {
      optional(entity.data, `${p}.data`, ['label', 'statusMessage'], str);
      if (entity.data.status !== undefined)
        oneOf(entity.data.status, `${p}.data.status`, [
          'dirty',
          'error',
          'warning',
          'running',
          'success',
        ]);
      if (
        ['frame', 'comment', 'text', 'draw', 'image', 'video', 'mesh'].includes(String(entity.type))
      ) {
        optional(
          entity.data,
          `${p}.data`,
          [
            'content',
            'src',
            'alt',
            'poster',
            'fontFamily',
            'textColor',
            'backgroundColor',
            'borderColor',
            'strokeColor',
          ],
          str
        );
        optional(
          entity.data,
          `${p}.data`,
          ['fontSize', 'fontWeight', 'lineHeight', 'strokeWidth'],
          (n, path) => num(n, path, Number.MIN_VALUE)
        );
        optional(entity.data, `${p}.data`, ['letterSpacing', 'rotateSpeed'], num);

        if (entity.data.points !== undefined) {
          if (!Array.isArray(entity.data.points) || entity.data.points.length % 2 !== 0)
            fail(`${p}.data.points`, 'Expected an even-length coordinate array');
          else entity.data.points.forEach((n, j) => num(n, `${p}.data.points[${j}]`));
        }
        optional(
          entity.data,
          `${p}.data`,
          ['controls', 'aspectLocked', 'autoplay', 'playing', 'loop', 'autoRotate', 'orbit'],
          bool
        );
        if (entity.data.cameraPosition !== undefined) {
          point(entity.data.cameraPosition, `${p}.data.cameraPosition`);
          if (record(entity.data.cameraPosition))
            num(entity.data.cameraPosition.z, `${p}.data.cameraPosition.z`);
        }

        if (entity.data.textAlign !== undefined)
          oneOf(entity.data.textAlign, `${p}.data.textAlign`, ['left', 'center', 'right']);
        if (entity.data.sizingMode !== undefined)
          oneOf(entity.data.sizingMode, `${p}.data.sizingMode`, [
            'auto-width',
            'auto-height',
            'fixed',
          ]);
        if (entity.data.objectFit !== undefined)
          oneOf(entity.data.objectFit, `${p}.data.objectFit`, ['contain', 'cover', 'fill']);
      }
    }
    optional(entity, p, ['width', 'height'], (n, path) => num(n, path, 0));
    optional(entity, p, ['selected', 'dragging', 'collapsed'], bool);
    optional(entity, p, ['color'], str);
    optional(entity, p, ['parentId'], (v, path) => str(v, path, true));
    optional(entity, p, ['inputs', 'outputs'], sockets);
    if (entity.extent !== undefined) oneOf(entity.extent, `${p}.extent`, ['auto', 'fixed']);
    if (entity.resizable !== undefined) {
      if (record(entity.resizable))
        optional(entity.resizable, `${p}.resizable`, ['width', 'height'], bool);
      else bool(entity.resizable, `${p}.resizable`);
    }
    if (entity.preview !== undefined) {
      if (!record(entity.preview)) fail(`${p}.preview`, 'Expected a preview object');
      else {
        str(entity.preview.socket, `${p}.preview.socket`, true);
        optional(entity.preview, `${p}.preview`, ['height'], (n, path) => num(n, path, 0));
        optional(entity.preview, `${p}.preview`, ['controls'], bool);
        if (entity.preview.fit !== undefined)
          oneOf(entity.preview.fit, `${p}.preview.fit`, ['cover', 'contain']);
        if (entity.preview.position !== undefined)
          oneOf(entity.preview.position, `${p}.preview.position`, ['top', 'bottom']);
      }
    }
  });
  edges.forEach((edge, i) => {
    const p = `$.edges[${i}]`;
    if (!record(edge)) return fail(p, 'Expected an edge object');
    for (const key of ['id', 'source', 'target']) str(edge[key], `${p}.${key}`, true);
    optional(edge, p, ['sourceSocket', 'targetSocket'], (v, path) => str(v, path, true));
    optional(edge, p, ['selected', 'animated', 'invalid'], bool);
    optional(edge, p, ['reroutes'], strings);
    if (edge.type !== undefined)
      oneOf(edge.type, `${p}.type`, ['straight', 'bezier', 'step', 'smoothstep']);
    if (edge.label !== undefined) {
      if (record(edge.label)) {
        str(edge.label.text, `${p}.label.text`);
        optional(edge.label, `${p}.label`, ['bgColor', 'textColor'], str);
        optional(edge.label, `${p}.label`, ['fontSize'], (n, path) =>
          num(n, path, Number.MIN_VALUE)
        );
        optional(edge.label, `${p}.label`, ['position'], (n, path) => num(n, path, 0, 1));
      } else str(edge.label, `${p}.label`);
    }
    for (const key of ['markerStart', 'markerEnd'])
      if (edge[key] !== undefined) {
        const marker = edge[key];
        if (record(marker)) {
          oneOf(marker.type, `${p}.${key}.type`, ['arrow', 'arrowClosed']);
          optional(marker, `${p}.${key}`, ['width', 'height'], (n, path) => num(n, path, 0));
          optional(marker, `${p}.${key}`, ['color'], str);
        } else oneOf(marker, `${p}.${key}`, ['arrow', 'arrowClosed']);
      }
  });
  if (issues.length === 0) {
    const document = value as unknown as FlowObject;
    for (const issue of validateGraphStructure(document.entities, document.edges))
      fail('$', JSON.stringify(issue));
  }
  return issues;
}

/** Returns the validated document unchanged; throws FlowDocumentError with paths on failure. */
export function parseFlowObject(value: unknown, limits?: FlowDocumentLimits): FlowObject {
  const issues = validateFlowObject(value, limits);
  if (issues.length) throw new FlowDocumentError(issues);
  return value as FlowObject;
}
