/**
 * The accessibility mirror's element set, and the three ways it can be wrong.
 *
 * It can mirror a socket the GL layer does not draw, which announces a control that is not on
 * screen and cannot be pressed. It can mirror a socket that ALREADY has a real DOM control on it,
 * which puts two identically named controls inside one node — the duplicate-name defect the naming
 * law in harness/behaviors.mjs exists to catch. And it can hand a control a value the control
 * cannot represent, which is a write that never settles and therefore a write on every store
 * change. One describe each.
 */

import { describe, it, expect } from 'vitest';
import { listEntityWidgets, mirrorDisplayValue, sameMirrorShape } from './widget-mirror';
import type { Entity, ResolvedWidgetConfig, SocketType, WidgetProps } from '../types';

const socketTypes: Record<string, SocketType> = {
  boolean: { name: 'Boolean', color: '#000', widget: 'checkbox' },
  number: { name: 'Number', color: '#000', widget: 'slider', min: 0, max: 100 },
  string: { name: 'String', color: '#000', widget: 'text' },
};

function node(inputs: Entity['inputs']): Entity {
  return { id: 'n1', type: 'default', position: { x: 0, y: 0 }, data: {}, width: 240, inputs };
}

function Stub(_: WidgetProps) {
  return null;
}

describe('listEntityWidgets covers what the GL layer draws', () => {
  it('returns one entry per input socket with a resolved widget, in socket order', () => {
    const entity = node([
      { id: 'on', name: 'On', type: 'boolean' },
      { id: 'amt', name: 'Amount', type: 'number' },
    ]);
    const entries = listEntityWidgets(entity, socketTypes, new Set());
    expect(entries.map((e) => e.socketId)).toEqual(['on', 'amt']);
    expect(entries.map((e) => e.index)).toEqual([0, 1]);
    expect(entries.map((e) => e.config.type)).toEqual(['checkbox', 'slider']);
  });

  it('names an entry from socket.name, not socket.id', () => {
    const entries = listEntityWidgets(
      node([{ id: 'amt', name: 'Amount', type: 'number' }]),
      socketTypes,
      new Set()
    );
    // The whole point of carrying a name: 'amt' is the consumer's key and 'Amount' is what the
    // GL layer paints beside the socket. A mirror that announced the key would describe a
    // control the person cannot find on screen.
    expect(entries[0].socketName).toBe('Amount');
  });

  it('skips a socket whose type resolves no widget', () => {
    const entries = listEntityWidgets(
      node([
        { id: 'amt', name: 'Amount', type: 'number' },
        { id: 'x', name: 'X', type: 'unmapped' },
      ]),
      socketTypes,
      new Set()
    );
    expect(entries.map((e) => e.socketId)).toEqual(['amt']);
  });

  it('skips a connected socket, keyed with the :input direction suffix', () => {
    const entity = node([
      { id: 'on', name: 'On', type: 'boolean' },
      { id: 'amt', name: 'Amount', type: 'number' },
    ]);
    const entries = listEntityWidgets(entity, socketTypes, new Set(['n1:on:input']));
    expect(entries.map((e) => e.socketId)).toEqual(['amt']);
  });

  it('does not treat a connected OUTPUT of the same name as a connected input', () => {
    // Dropping the `:input` suffix is the easy mistake, and it silently removes the widget from
    // any socket whose output side happens to be wired — which is most of them.
    const entity = node([{ id: 'on', name: 'On', type: 'boolean' }]);
    const entries = listEntityWidgets(entity, socketTypes, new Set(['n1:on:output']));
    expect(entries.map((e) => e.socketId)).toEqual(['on']);
  });
});

describe('listEntityWidgets leaves the DOM widget path alone', () => {
  it('skips a socket carrying an inline consumer component', () => {
    const entity = node([
      { id: 'a', name: 'A', type: 'string', widget: { component: Stub } },
      { id: 'b', name: 'B', type: 'string' },
    ]);
    const entries = listEntityWidgets(entity, socketTypes, new Set());
    expect(entries.map((e) => e.socketId)).toEqual(['b']);
  });

  it('skips a widget TYPE the consumer has replaced through widgetTypes', () => {
    const entity = node([
      { id: 'a', name: 'A', type: 'string' },
      { id: 'b', name: 'B', type: 'boolean' },
    ]);
    // `text` is what a string socket resolves to, so widgets-layer.tsx already mounts a named
    // control for 'a'. Mirroring it too would put two controls called "A" on one node.
    const entries = listEntityWidgets(entity, socketTypes, new Set(), { text: Stub });
    expect(entries.map((e) => e.socketId)).toEqual(['b']);
  });
});

describe('sameMirrorShape keeps a live control from being torn down', () => {
  const entity = node([
    { id: 'a', name: 'A', type: 'string' },
    { id: 'b', name: 'B', type: 'boolean' },
  ]);

  it('answers true for two independently built lists of the same shape', () => {
    // The real scenario: a controlled consumer bumps topologyVersion on every echoed keystroke,
    // and a fresh list is built each time. Committing it would remount the input being typed in.
    const a = listEntityWidgets(entity, socketTypes, new Set());
    const b = listEntityWidgets(entity, socketTypes, new Set());
    expect(a).not.toBe(b);
    expect(sameMirrorShape(a, b)).toBe(true);
  });

  it('answers false when a socket is renamed, added or removed', () => {
    const base = listEntityWidgets(entity, socketTypes, new Set());
    const renamed = listEntityWidgets(
      node([
        { id: 'a', name: 'A2', type: 'string' },
        { id: 'b', name: 'B', type: 'boolean' },
      ]),
      socketTypes,
      new Set()
    );
    const fewer = listEntityWidgets(entity, socketTypes, new Set(['n1:a:input']));
    expect(sameMirrorShape(base, renamed)).toBe(false);
    expect(sameMirrorShape(base, fewer)).toBe(false);
  });

  it('answers false when a select gains an option', () => {
    const one: ResolvedWidgetConfig = { type: 'select', options: ['x'] };
    const two: ResolvedWidgetConfig = { type: 'select', options: ['x', 'y'] };
    const shape = (config: ResolvedWidgetConfig) => [
      { socketId: 's', socketName: 'S', index: 0, config },
    ];
    expect(sameMirrorShape(shape(one), shape(two))).toBe(false);
  });
});

describe('mirrorDisplayValue reaches a fixed point after one write', () => {
  /**
   * Each of these is a browser behaviour that rewrites what you assigned. The sync loop compares
   * `el.value` against this string before writing, so a value the element normalises would differ
   * forever and be rewritten on every store change — which for a graph being dragged is every
   * pointermove.
   */
  it('clamps a range value into the bounds the element carries', () => {
    const config: ResolvedWidgetConfig = { type: 'slider', min: 0, max: 100 };
    expect(mirrorDisplayValue(config, 150)).toBe('100');
    expect(mirrorDisplayValue(config, -20)).toBe('0');
    expect(mirrorDisplayValue(config, 42)).toBe('42');
  });

  it('clamps against the ORDERED pair, so a descending range is not frozen', () => {
    // Same defect sliderValueAt already had to fix: with min above max, clamping to (min, max)
    // in that order answers max for every input.
    const config: ResolvedWidgetConfig = { type: 'slider', min: 10, max: 0 };
    expect(mirrorDisplayValue(config, 4)).toBe('4');
  });

  it('answers a hex triple for a colour, whatever it was given', () => {
    const config: ResolvedWidgetConfig = { type: 'color' };
    expect(mirrorDisplayValue(config, '#8E4EC6')).toBe('#8e4ec6');
    expect(mirrorDisplayValue(config, 'rebeccapurple')).toBe('#000000');
    expect(mirrorDisplayValue(config, undefined)).toBe('#000000');
  });

  it('answers empty for a select value none of the options offer', () => {
    const config: ResolvedWidgetConfig = { type: 'select', options: ['one', 'two'] };
    expect(mirrorDisplayValue(config, 'two')).toBe('two');
    expect(mirrorDisplayValue(config, 'three')).toBe('');
  });

  it('stringifies anything else, and answers empty for nothing', () => {
    const config: ResolvedWidgetConfig = { type: 'text' };
    expect(mirrorDisplayValue(config, 'hello')).toBe('hello');
    expect(mirrorDisplayValue(config, 7)).toBe('7');
    expect(mirrorDisplayValue(config, null)).toBe('');
    expect(mirrorDisplayValue(config, undefined)).toBe('');
  });
});
