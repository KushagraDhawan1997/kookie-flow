/**
 * The harness fixture: one page that mounts a real KookieFlow and exposes enough of its
 * internals for a test to assert against.
 *
 * It mounts the library the way a consumer does — inside Kookie UI's Theme, so the CSS custom
 * properties the GL layer reads are actually present. Phase 0 pins CURRENT behavior, so this is
 * deliberately still Kookie UI **v1**; the v2 swap is a later phase and must be visible as a diff
 * against these baselines rather than smuggled into them.
 *
 * Configuration comes from the query string so one bundle serves every scale:
 *   ?count=1000&seed=1&widgets=0&preserveBuffer=1
 */

import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Theme } from '@kushagradhawan/kookie-ui';
import { KookieFlow } from '../../src/components/kookie-flow';
import { useFlowStoreApi } from '../../src/components/context';
import type { Entity, Edge, EntityChange, EdgeChange } from '../../src/types';
import { makeGraph } from './graph';
import { parseColorToRGB, parseColorToRGBA, resolveColorToRGB } from '../../src/utils/color';

declare global {
  interface Window {
    __harness?: HarnessApi;
  }
}

export interface HarnessApi {
  /** Resolves once React has committed and at least one frame has been rendered. */
  ready: Promise<void>;
  /** The live zustand store, for asserting state after a synthetic interaction. */
  store: unknown;
  /** Current entity/edge counts, as the store sees them. */
  counts(): { entities: number; edges: number };
  /** Read the store's viewport (pan/zoom). */
  viewport(): unknown;
  /** Resolve a CSS custom property the way the GL layer does, to sRGB 0-1. */
  resolveToken(name: string): [number, number, number] | null;
  /** The LIBRARY's own colour parsers, so a spike tests the shipped code and not a copy. */
  lib: {
    parseColorToRGB(v: string): [number, number, number];
    parseColorToRGBA(v: string): [number, number, number, number];
    resolveColorToRGB(v: string): [number, number, number] | null;
  };
  /** Read one pixel from the WebGL canvas, in CSS pixel coordinates from the top-left. */
  readPixel(x: number, y: number): [number, number, number, number] | null;
  /** The <canvas> R3F is drawing into. */
  canvas(): HTMLCanvasElement | null;
  /** WebGL draw-call counters. */
  gl(): unknown;
  /** Zero the draw-call counters and the frame recorder. */
  resetGl(): void;
  /** Frame-interval distribution for the current window. */
  frames(): unknown;
}

function params() {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => {
    const v = q.get(k);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    count: num('count', 12),
    seed: num('seed', 1),
    edgeRatio: num('edgeRatio', 0.8),
    widgets: q.get('widgets') === '1',
    grid: q.get('grid') !== '0',
    appearance: (q.get('appearance') ?? 'light') as 'light' | 'dark',
  };
}

let markReady: () => void = () => {};
const readyPromise = new Promise<void>((res) => {
  markReady = res;
});

/**
 * Draw-call instrumentation, at the WebGL level.
 *
 * Three earlier attempts failed and each failure is worth stating, because a harness that
 * silently measures nothing is worse than no harness:
 *  - R3F v9 does not stash its root state on the canvas element, so `canvas.__r3f` is undefined.
 *  - KookieFlow renders `children` into the DOM layer, not inside <Canvas>, so a probe component
 *    cannot call useThree().
 *  - three 0.182 assigns `render` as an OWN property in the WebGLRenderer constructor, so
 *    `WebGLRenderer.prototype.render` is undefined and patching the prototype intercepts nothing.
 *    That produced a confident `renders: 0` that said nothing about the app at all.
 *
 * WebGL2RenderingContext methods ARE on the prototype, so counting draw calls there is both
 * reliable and a more useful number: "did anything get drawn" and "how many draw calls per frame"
 * are the questions, and this answers them without depending on any framework internal.
 */
interface GlSnapshot {
  contexts: number;
  drawCalls: number;
  instancedDrawCalls: number;
  instancesDrawn: number;
  clears: number;
  viewportSize: [number, number] | null;
}

const gl: GlSnapshot = {
  contexts: 0,
  drawCalls: 0,
  instancedDrawCalls: 0,
  instancesDrawn: 0,
  clears: 0,
  viewportSize: null,
};

function installGlProbe() {
  if (typeof WebGL2RenderingContext === 'undefined') return;
  const proto = WebGL2RenderingContext.prototype;

  const wrap = <K extends keyof WebGL2RenderingContext>(name: K, onCall: (args: unknown[]) => void) => {
    const original = proto[name] as unknown as (...a: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    (proto as unknown as Record<string, unknown>)[name as string] = function patched(
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      onCall(args);
      return original.apply(this, args);
    };
  };

  wrap('drawElements', () => { gl.drawCalls++; });
  wrap('drawArrays', () => { gl.drawCalls++; });
  wrap('drawElementsInstanced', (a) => {
    gl.drawCalls++;
    gl.instancedDrawCalls++;
    gl.instancesDrawn += Number(a[4] ?? 0);
  });
  wrap('drawArraysInstanced', (a) => {
    gl.drawCalls++;
    gl.instancedDrawCalls++;
    gl.instancesDrawn += Number(a[3] ?? 0);
  });
  wrap('clear', () => {
    gl.clears++;
    // three clears once per frame, so the gap between clears IS the frame interval. Recording
    // here rather than from our own rAF loop keeps the instrument out of the measurement.
    const now = performance.now();
    if (frames.last > 0) {
      const dt = now - frames.last;
      // A gap over a second is a tab stall or a pause between measurement windows, not a frame.
      if (dt < 1000) frames.samples.push(dt);
    }
    frames.last = now;
  });
  wrap('viewport', (a) => { gl.viewportSize = [Number(a[2] ?? 0), Number(a[3] ?? 0)]; });

  // KookieFlow creates its context with `preserveDrawingBuffer: false` (a deliberate Safari
  // performance choice). That is correct for the product and fatal for pixel assertions: the
  // backbuffer is invalid once the frame is composited, so readPixels and page.screenshot both
  // come back empty — which reads as "the renderer drew nothing" when it drew 13k instances.
  //
  // `?preserveBuffer=1` forces it on for correctness runs. Perf runs must leave it OFF, because
  // preserving the buffer changes what the driver can optimise and would bias every timing.
  const forcePreserve = new URLSearchParams(location.search).get('preserveBuffer') === '1';
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, ...args: unknown[]) {
    if (forcePreserve && (args[0] === 'webgl2' || args[0] === 'webgl')) {
      args[1] = { ...(args[1] as object | undefined), preserveDrawingBuffer: true };
    }
    const ctx = (getContext as unknown as (...a: unknown[]) => unknown).apply(this, args);
    if (ctx instanceof WebGL2RenderingContext) gl.contexts++;
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

installGlProbe();

/**
 * Colour-management state, published for the record.
 *
 * KookieFlow mounts <Canvas flat legacy>. `legacy` is what sets THREE.ColorManagement.enabled =
 * false, and the entire colour pipeline's coherence rests on it: with management OFF, both the
 * float path (new THREE.Color(r,g,b)) and the hex path (new THREE.Color('#rrggbb')) pass sRGB
 * through unconverted, so every one of the 22 unmanaged ShaderMaterials paints the token's own
 * bytes. Turn management back ON and the hex sites silently darken while the float sites stay
 * correct. This exposes the flag so a law can assert it rather than a comment claiming it.
 */
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__three', {
    get: () => ({
      revision: THREE.REVISION,
      colorManagementEnabled: THREE.ColorManagement.enabled,
      workingColorSpace: THREE.ColorManagement.workingColorSpace,
    }),
    configurable: true,
  });
}

interface FrameRecorder {
  last: number;
  samples: number[];
}
const frames: FrameRecorder = { last: 0, samples: [] };

/**
 * Frame intervals for the current window, as a distribution.
 *
 * A mean is the wrong summary for frame time — one 200ms hitch inside a second of 8ms frames
 * averages to something that looks fine and feels broken. p95 is where the stutter lives.
 */
function frameStats() {
  const s = frames.samples.slice().sort((a, b) => a - b);
  if (s.length === 0) return { count: 0 };
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    count: s.length,
    p50: Number(at(0.5).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    p99: Number(at(0.99).toFixed(2)),
    max: Number(s[s.length - 1].toFixed(2)),
    fps50: Number((1000 / at(0.5)).toFixed(1)),
  };
}

/** Zero the counters, so a measurement covers a known window rather than all of history. */
function resetGlCounters() {
  frames.samples.length = 0;
  frames.last = 0;
  gl.drawCalls = 0;
  gl.instancedDrawCalls = 0;
  gl.instancesDrawn = 0;
  gl.clears = 0;
}

/** Lives inside KookieFlow so it can reach the store's provider. */
function Probe() {
  const store = useFlowStoreApi();

  useEffect(() => {
    const canvas = () => document.querySelector<HTMLCanvasElement>('canvas');

    const api: HarnessApi = {
      ready: readyPromise,
      store,
      counts() {
        const s = (store as { getState(): { entities?: unknown[]; edges?: unknown[] } }).getState();
        return { entities: s.entities?.length ?? 0, edges: s.edges?.length ?? 0 };
      },
      viewport() {
        return (store as { getState(): { viewport?: unknown } }).getState().viewport ?? null;
      },
      resolveToken(name: string) {
        // Two things here are load-bearing and both were bugs in the first draft:
        //
        // 1. The probe MUST live inside the theme element. Tokens are scoped to `.radix-themes`,
        //    so a probe on <body> cannot see them: measured, `var(--accent-9)` resolves to
        //    rgb(0,0,0) from body and rgb(0,144,255) from inside the theme, and `--gray-2` gives
        //    the untinted rgb(249,249,249) instead of the real rgb(249,249,251).
        //
        // 2. The value MUST be wrapped in color-mix. Chrome returns modern colour functions from
        //    getComputedStyle UNCHANGED — `oklch(...)` in, `oklch(...)` out — so reading `.color`
        //    directly cannot resolve a v2 token. `color-mix(in srgb, …)` forces conversion and
        //    yields `color(srgb r g b)` at full float precision.
        //
        // See plans/migration/finding-colour-pipeline.md.
        const host = document.querySelector('.radix-themes') ?? document.body;
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
        probe.style.color = `color-mix(in srgb, var(${name}) 100%, transparent 0%)`;
        host.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();

        const srgb = computed.match(
          /color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/
        );
        if (srgb) {
          const clamp = (v: number) => Math.min(1, Math.max(0, v));
          return [clamp(Number(srgb[1])), clamp(Number(srgb[2])), clamp(Number(srgb[3]))];
        }
        const rgb = computed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (rgb) {
          return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
        }
        return null;
      },
      readPixel(x: number, y: number) {
        const c = canvas();
        if (!c) return null;
        const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
        if (!gl) return null;
        const dpr = c.width / c.clientWidth;
        const px = Math.round(x * dpr);
        // readPixels is bottom-left origin; CSS is top-left.
        const py = Math.round(c.height - y * dpr);
        const buf = new Uint8Array(4);
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return [buf[0], buf[1], buf[2], buf[3]];
      },
      canvas,
      gl: () => JSON.parse(JSON.stringify(gl)),
      resetGl: resetGlCounters,
      frames: frameStats,
      lib: { parseColorToRGB, parseColorToRGBA, resolveColorToRGB },
    };

    window.__harness = api;
    // Two frames: one for React's commit, one for R3F to have actually drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => markReady()));
  }, [store]);

  return null;
}

function App() {
  const p = useMemo(() => params(), []);
  const initial = useMemo(
    () => makeGraph({ count: p.count, seed: p.seed, edgeRatio: p.edgeRatio }),
    [p.count, p.seed, p.edgeRatio]
  );

  const [entities, setEntities] = useState<Entity[]>(initial.entities);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);

  // Applying changes keeps the fixture honest: a test that drags a node and then asserts on
  // `entities` is exercising the same controlled-component contract a consumer signs up for.
  const onEntitiesChange = useCallback((changes: EntityChange[]) => {
    setEntities((prev) => applyEntityChanges(prev, changes));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => applyEdgeChanges(prev, changes));
  }, []);

  return (
    <Theme appearance={p.appearance}>
      <div style={{ position: 'fixed', inset: 0 }}>
        <KookieFlow
          entities={entities}
          edges={edges}
          onEntitiesChange={onEntitiesChange}
          onEdgesChange={onEdgesChange}
          showWidgets={p.widgets}
          showGrid={p.grid}
          showMinimap={false}
        >
          <Probe />
        </KookieFlow>
      </div>
      {/* DOM reference swatches. Spike #1 compares GL pixels against these, so they must wear
          the same tokens the GL layer reads — not a hardcoded hex. */}
      <div
        id="dom-swatches"
        style={{ position: 'fixed', bottom: 0, left: 0, display: 'flex', zIndex: 10 }}
      >
        {['--gray-2', '--gray-3', '--gray-4', '--accent-9'].map((t) => (
          <div
            key={t}
            data-token={t}
            style={{ width: 24, height: 24, background: `var(${t})` }}
          />
        ))}
      </div>
    </Theme>
  );
}

function applyEntityChanges(prev: Entity[], changes: EntityChange[]): Entity[] {
  let next = prev;
  for (const c of changes as Array<Record<string, unknown>>) {
    const type = c.type as string;
    if (type === 'position' || type === 'select' || type === 'dimensions') {
      next = next.map((e) => (e.id === c.id ? ({ ...e, ...stripType(c) } as Entity) : e));
    } else if (type === 'remove') {
      next = next.filter((e) => e.id !== c.id);
    } else if (type === 'add' && c.item) {
      next = [...next, c.item as Entity];
    }
  }
  return next;
}

function applyEdgeChanges(prev: Edge[], changes: EdgeChange[]): Edge[] {
  let next = prev;
  for (const c of changes as Array<Record<string, unknown>>) {
    const type = c.type as string;
    if (type === 'select') {
      next = next.map((e) => (e.id === c.id ? ({ ...e, ...stripType(c) } as Edge) : e));
    } else if (type === 'remove') {
      next = next.filter((e) => e.id !== c.id);
    } else if (type === 'add' && c.item) {
      next = [...next, c.item as Edge];
    }
  }
  return next;
}

function stripType(c: Record<string, unknown>) {
  const { type, id, ...rest } = c;
  void type;
  void id;
  return rest;
}

const el = document.getElementById('root');
if (el) {
  // No StrictMode: it double-invokes effects, which would double every GL resource allocation
  // the perf tier is trying to measure. React-correctness under StrictMode is its own test.
  const strict = new URLSearchParams(location.search).get('strict') === '1';
  const tree = <App />;
  createRoot(el).render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
