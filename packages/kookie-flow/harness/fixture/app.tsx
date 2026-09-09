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
import { makeGraph, makeShapes, makeGroup, makeComments } from './graph';
import { parseColorToRGB, parseColorToRGBA, resolveColorToRGB, parsePx } from '../../src/utils/color';
import { FALLBACK_TOKENS } from '../../src/hooks/useThemeTokens';
import { useTheme } from '../../src/contexts/ThemeContext';
import { frozenHue } from '../../src/core/palette';

declare global {
  interface Window {
    __harness?: HarnessApi;
    /** Every mounted instance, in mount order. `__harness` is the first. */
    __harnesses?: HarnessApi[];
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
    parsePx(v: string): number;
    frozenHue(name: string, appearance: 'light' | 'dark'): string | null;
  };
  /** Read one pixel from the WebGL canvas, in CSS pixel coordinates from the top-left. */
  readPixel(x: number, y: number): [number, number, number, number] | null;
  /** The <canvas> R3F is drawing into. */
  canvas(): HTMLCanvasElement | null;
  /** Every non-instanced vertex in the scene, in world space (Y-down, like the store), labelled by mesh. */
  drawnVertices(): { x: number; y: number; kind: string }[];
  /** WebGL draw-call counters. */
  gl(): unknown;
  /** Zero the draw-call counters and the frame recorder. */
  resetGl(): void;
  /** Frame-interval distribution for the current window. */
  frames(): unknown;
  /**
   * Open a named measurement window. Everything counted between mark(name) and the next mark is
   * attributed to `name`, so one page can measure pan, drag and a connection drag separately
   * without a reload between them.
   */
  mark(name: string): void;
  /** React commit counts, total and per window. */
  reactCommits(): { commits: number; marks: Record<string, number> };
  /** Which of the tokens the GL layer reads are actually present in the mounted theme. */
  tokenCensus(): { present: string[]; missing: string[] };
  /** Every MSDF glyph mesh: how many glyphs it draws and where its first one sits, in world space. */
  glyphs(): { count: number; x: number; y: number }[];
  /** Every drawn instance's world-space translation, labelled by mesh. The instanced half of `drawnVertices`. */
  drawnInstances(): { kind: string; x: number; y: number }[];
  /** How many bulk Float32Array copies have happened since the last `mark`. */
  bulkCopies(): number;
  /** Cumulative GPU-object create/delete counts. Never reset — these are lifetimes, not work. */
  glLifetimes(): GlLifetimes;
  /** Cumulative three-side dispose calls, by resource kind. Also never reset. */
  disposals(): { material: number; geometry: number; texture: number };
  /** The element the design system's tokens are scoped to, as the fixture resolves it. */
  themeRoot(): { className: string; tag: string; isDocumentElement: boolean };
  /** Resolved PIXEL values for the tokens whose value, not merely whose name, has to survive. */
  tokenValues(): Record<string, number>;
  /** What the package's own reader resolves a length token to, and the raw text it started from. */
  readLength(name: string): { raw: string; parsed: number };
  /** The live token object the GL layer paints from — the flow's own ThemeContext. */
  themeTokens(): Readonly<Record<string, number | number[] | string>>;
  /** Flip the appearance on either design system (class for v1, data-appearance for v2). */
  setAppearance(mode: string): { ok: boolean; on: string };
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
    radius: q.get('radius') as 'none'|'small'|'medium'|'large'|'full'|null,
    entityRadius: q.get('entityRadius') as 'none'|'small'|'medium'|'large'|'full'|null,
    // Which fixture. 'grid' is the scale/behaviour workhorse; 'shapes' is the set of entities
    // where the four independent height/socket-Y implementations disagree; 'group' covers
    // collapse and hidden entities.
    scene: (q.get('scene') ?? 'grid') as 'grid' | 'shapes' | 'group' | 'comments',
    // Explicit width/height on every entity. Default off — see the note in graph.ts about why a
    // uniformly sized fixture hides two whole bug classes.
    explicitSize: q.get('explicitSize') === '1',
    // Mount N KookieFlow instances. Two is the reentrancy case: module-level state in the store
    // used to make the second instance break dragging in the first.
    instances: Math.max(1, Math.min(3, num('instances', 1))),
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

/**
 * GPU objects created and destroyed, at the driver boundary.
 *
 * Deliberately NOT part of `GlSnapshot` and deliberately never reset by `mark`: these are
 * cumulative lifetimes, not per-window work, and the question they answer is "did anything get
 * left behind". three does not free a GPU resource on garbage collection — the renderer holds it
 * in its own caches — so a material or geometry that is rebuilt and not disposed shows up here as
 * a program or a set of buffers that was created and never deleted.
 *
 * Counted at `WebGL2RenderingContext` rather than read off `renderer.info`, which the fixture has
 * no handle on, and which would be three's own account of its own bookkeeping rather than an
 * independent one.
 */
interface GlLifetimes {
  programsCreated: number;
  programsDeleted: number;
  buffersCreated: number;
  buffersDeleted: number;
  texturesCreated: number;
  texturesDeleted: number;
}

/**
 * three-side dispose calls, by resource kind.
 *
 * The driver counters above are the honest instrument for a LEAK, but they cannot see a material
 * leak at all: every ShaderMaterial in this package has a byte-identical shader body per kind, so
 * three's program cache hands out the same program and `createProgram` never fires again however
 * many materials are built. That is measured, not assumed — deleting all 23 dispose effects moves
 * the program count by exactly zero.
 *
 * So the material half is proven the only way left: by counting the calls. Weaker than a driver
 * counter, and stated as such — it can only show that the teardown RAN, not that the GPU let go.
 */
const disposals = { material: 0, geometry: 0, texture: 0 };
{
  const patch = (proto: { dispose?: unknown }, key: 'material' | 'geometry' | 'texture') => {
    const original = proto.dispose as (...a: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    (proto as unknown as Record<string, unknown>).dispose = function patched(this: unknown, ...args: unknown[]) {
      disposals[key]++;
      return original.apply(this, args);
    };
  };
  patch(THREE.Material.prototype, 'material');
  patch(THREE.BufferGeometry.prototype, 'geometry');
  patch(THREE.Texture.prototype, 'texture');
}

const live: GlLifetimes = {
  programsCreated: 0,
  programsDeleted: 0,
  buffersCreated: 0,
  buffersDeleted: 0,
  texturesCreated: 0,
  texturesDeleted: 0,
};

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

  wrap('createProgram', () => { live.programsCreated++; });
  wrap('deleteProgram', () => { live.programsDeleted++; });
  wrap('createBuffer', () => { live.buffersCreated++; });
  wrap('deleteBuffer', () => { live.buffersDeleted++; });
  wrap('createTexture', () => { live.texturesCreated++; });
  wrap('deleteTexture', () => { live.texturesDeleted++; });

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

/**
 * React commit counts, installed by a plain <script> in index.html.
 *
 * NOT here: React reads `__REACT_DEVTOOLS_GLOBAL_HOOK__` when its own module is evaluated, and ES
 * imports are hoisted, so this module's body runs after React has already looked. The first
 * version lived at module scope right here and reported zero commits for every interaction —
 * including a node drag that calls setState through the controlled-component contract, so the
 * answer was not just unproven but wrong. See index.html for the counter itself.
 */
interface CommitCounter {
  commits: number;
  marks: Record<string, number>;
  current: string | null;
}

const react: CommitCounter =
  (window as unknown as { __kfReact?: CommitCounter }).__kfReact ??
  { commits: 0, marks: {}, current: null };


installGlProbe();

/**
 * Scene capture, for reading the GEOMETRY that was actually drawn.
 *
 * Same problem as the draw-call probe and the same shape of answer: there is no supported route
 * from outside <Canvas> to R3F's scene, so the hook is a prototype patch on the one method every
 * scene graph must go through. `THREE.Object3D.prototype.add` is on the prototype (unlike
 * WebGLRenderer.render), so this actually intercepts.
 *
 * Why it exists: the alternative for "did the edge land on the socket" is reading pixels, and that
 * instrument turned out not to be trustworthy here. A scan column outside the socket's painted
 * disc and close enough for the bezier to still be near-horizontal is about one pixel wide, and
 * the readings were not reproducible run to run. Vertices are exact and have no such window.
 */
const scenes = new Set<THREE.Scene>();
function installSceneProbe() {
  const proto = THREE.Object3D.prototype as unknown as Record<string, unknown>;
  const add = proto.add as (...a: unknown[]) => unknown;
  proto.add = function patched(this: THREE.Object3D, ...args: unknown[]) {
    if ((this as unknown as { isScene?: boolean }).isScene) scenes.add(this as THREE.Scene);
    return add.apply(this, args);
  };
}

installSceneProbe();

/**
 * Every vertex drawn in the scene, in WORLD space.
 *
 * GL is Y-up and this world is Y-down, so the renderer negates Y on the way in; this negates it
 * back. Instanced meshes are skipped: their per-vertex positions are a unit quad and say nothing
 * about where anything sits, which is what `instanceMatrix` carries.
 */
/**
 * The element the design system's tokens are scoped to — the fixture's copy of
 * `src/utils/theme-root.ts`.
 *
 * Copied rather than imported ON PURPOSE, and the divergence is the point: the harness must be
 * able to disagree with the package. If the fixture imported the package's resolver, a law reading
 * "the census host and the reader root are the same node" would hold by construction and could
 * never fail. Two implementations, one law that they agree — the rule this repo already applies to
 * every mechanism with two homes.
 *
 * The fallback order matters. v1 scoped its tokens to `.radix-themes`, so a probe outside it
 * resolved nothing, loudly. v2 declares at `:root` and re-declares inside the Theme's own
 * `[data-appearance]` scope, so falling through to `<html>` returns a complete, valid palette of
 * the WRONG MODE — measured, the present/missing split over all 99 tokens is identical at `<html>`
 * and inside the Theme, so the census literally cannot tell them apart.
 */
function themeRoot(): Element {
  return (
    document.querySelector('.radix-themes') ??
    document.querySelector('.kui-theme') ??
    document.documentElement
  );
}

/**
 * Flip the appearance, on either design system.
 *
 * v1 carries light/dark in `classList`; v2 stamps `data-appearance` on the Theme element and its
 * generated selectors key on the attribute alone — measured, adding a `dark` class to a
 * `.kui-theme` div changes NOTHING, every token byte-identical. Doing both is harmless on either:
 * v1 ignores the attribute, v2 ignores the class.
 *
 * It lives here rather than inline in five call sites because those five had drifted into two
 * spellings already, and because a `querySelector` that returns null throws a TypeError inside
 * `page.evaluate` — which CRASHES the run instead of failing a law.
 */
function setAppearanceOn(mode: string): { ok: boolean; on: string } {
  const el = themeRoot();
  el.classList.remove('light', 'dark');
  el.classList.add(mode);
  el.setAttribute('data-appearance', mode);
  return { ok: true, on: el.className || el.tagName };
}

function drawnVertices(): { x: number; y: number; kind: string }[] {
  const out: { x: number; y: number; kind: string }[] = [];
  const v = new THREE.Vector3();
  for (const scene of scenes) {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean };
      if (!mesh.isMesh || mesh.isInstancedMesh) return;
      if (mesh.visible === false) return;
      const pos = mesh.geometry?.attributes?.position as THREE.BufferAttribute | undefined;
      if (!pos) return;

      /**
       * Honour the DRAW RANGE, and the index if there is one.
       *
       * Reading `pos.count` reports the whole capacity-sized buffer, and the ribbon meshes
       * (edges, the connection line) are exactly that: a fixed buffer with `setDrawRange(0, n)`
       * deciding how much of it the driver ever sees. So a vertex left over from before the last
       * rebuild read as a drawn vertex — invisible to an EXISTENTIAL law ("some vertex lands on
       * this socket") and fatal to a UNIVERSAL one ("no vertex lands anywhere near here"), which
       * is how a law about a collapsed group came to fail on stale positions from before the
       * collapse.
       */
      const index = mesh.geometry.index;
      const total = index ? index.count : pos.count;
      const start = mesh.geometry.drawRange.start;
      const declared = mesh.geometry.drawRange.count;
      const count = Math.max(0, Math.min(declared === Infinity ? total : declared, total - start));
      mesh.updateWorldMatrix(true, false);
      const kind =
        mesh.name ||
        (Array.isArray(mesh.material) ? 'multi' : (mesh.material?.type ?? 'no-material')) +
          ':' +
          (mesh.geometry?.type ?? 'no-geometry') +
          ':r' +
          String(mesh.renderOrder);
      for (let k = start; k < start + count; k++) {
        const i = index ? index.getX(k) : k;
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        // `kind` names which mesh drew it. Added because a law that finds an unexpected vertex
        // otherwise has to guess which renderer put it there, and guessing is how a law comes to
        // blame the wrong component.
        out.push({ x: v.x, y: -v.y, kind });
      }
    });
  }
  return out;
}

/**
 * Every INSTANCE drawn by an instanced mesh, as its world-space translation.
 *
 * `drawnVertices` deliberately skips instanced meshes — their vertex positions are a unit quad and
 * say nothing about where anything sits — so sockets, nodes and marks were invisible to every law
 * in the suite. This is the other half: one point per drawn instance, read from the translation
 * column of its instance matrix (elements 12/13, column-major), negated on Y because GL is Y-up
 * and this world is Y-down.
 *
 * Bounded by `mesh.count`, which is the instanced equivalent of a draw range: the buffers are
 * capacity-sized and everything past `count` is stale.
 *
 * Kept SEPARATE from `drawnVertices` rather than folded into it. Folding would silently change
 * what every existing law measures — "some drawn vertex lands on this socket" becomes trivially
 * true the moment the socket's own instance centre is in the list.
 */
function drawnInstances(): { kind: string; x: number; y: number }[] {
  const out: { kind: string; x: number; y: number }[] = [];
  for (const scene of scenes) {
    scene.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh & { isInstancedMesh?: boolean };
      if (!mesh.isInstancedMesh || mesh.visible === false) return;
      const kind =
        mesh.name ||
        (mesh.geometry?.attributes?.aUvOffset ? 'glyphs' : mesh.geometry?.type ?? 'no-geometry') +
          ':r' +
          String(mesh.renderOrder);
      const m = mesh.instanceMatrix.array as unknown as ArrayLike<number>;
      for (let i = 0; i < mesh.count; i++) {
        out.push({ kind, x: m[i * 16 + 12], y: -m[i * 16 + 13] });
      }
    });
  }
  return out;
}

/**
 * Every MSDF glyph mesh in the scene.
 *
 * `drawnVertices` deliberately skips instanced meshes, because their vertex positions are a unit
 * quad and say nothing about where anything sits — so today NOTHING sees GL text. The one text law
 * in the suite asserts a label is ABSENT from the DOM, which passes just as happily when the GL
 * text is frozen, ghosted or gone.
 *
 * The text meshes are told apart by `aUvOffset`: only the MSDF material carries it. A glyph's
 * world position is the translation column of its instance matrix (elements 12/13, column-major),
 * negated on Y because GL is Y-up and this world is Y-down.
 */
function glyphs(): { count: number; x: number; y: number }[] {
  const out: { count: number; x: number; y: number }[] = [];
  for (const scene of scenes) {
    scene.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh & { isInstancedMesh?: boolean };
      if (!mesh.isInstancedMesh) return;
      if (!mesh.geometry?.attributes?.aUvOffset) return;
      if (mesh.count === 0) {
        out.push({ count: 0, x: NaN, y: NaN });
        return;
      }
      const m = mesh.instanceMatrix.array as unknown as ArrayLike<number>;
      out.push({ count: mesh.count, x: m[12], y: -m[13] });
    });
  }
  return out;
}

/**
 * Bulk Float32Array copies since the last `mark`.
 *
 * The glyph matrices used to be written twice — once into an intermediate buffer, then copied
 * whole into the mesh's own array with `.set(buf.subarray(0, n * 16))`, once per weight per dirty
 * frame. A byte counter cannot see that: the memcpy allocates nothing and the `subarray` view is
 * about a hundred bytes, which is noise in a heap sampler. Counting the copies sees it exactly.
 *
 * `subarray` is what is counted rather than `set`, because `set` has honest callers all over the
 * package while the only `subarray` sites left in `src/` are the edge buffers' growth path — which
 * does not run during a steady gesture on a fixed graph. So during a marked drag this is zero, and
 * putting either copy back makes it a per-frame count.
 */
const bulk = { copies: 0 };
{
  const proto = Float32Array.prototype as unknown as Record<string, unknown>;
  const subarray = proto.subarray as (...a: unknown[]) => unknown;
  proto.subarray = function patched(this: Float32Array, ...args: unknown[]) {
    bulk.copies++;
    return subarray.apply(this, args);
  };
}

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
  // The LIVE token object the GL layer is actually painting from — the flow's own ThemeContext,
  // read from inside the flow. Every other probe here asks the browser or asks the reader's
  // helpers; this is the value itself, which is the only way to tell "the reader fell back to
  // its dark table" from "the reader read a dark theme".
  const liveTokens = useTheme();

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
        // 1. The probe MUST live inside the theme element. Under v1 tokens are scoped to
        //    `.radix-themes`,
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
        const host = themeRoot();
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
      drawnVertices,
      glyphs,
      drawnInstances,
      bulkCopies: () => bulk.copies,
      glLifetimes: () => ({ ...live }),
      disposals: () => ({ ...disposals }),
      themeRoot: () => {
        const el = themeRoot();
        return {
          className: el.className || '',
          tag: el.tagName,
          isDocumentElement: el === document.documentElement,
        };
      },
      setAppearance: setAppearanceOn,
      /**
       * The census proves a token is DEFINED. This proves it means what it meant.
       *
       * Every one of these resolves under BOTH design systems by name, which is exactly why they
       * need a value law: v1's `--space-N` is v2's `--space-(N+1)`, so a socket row silently goes
       * 40px to 32px and a widget 32px to 24px with the census green, no missing token, no compile
       * error and no existing law anywhere. The radius entry catches the other silent one: v2's
       * default radius level is `full`, where `--radius-4` is 9999px, and every SDF site clamps
       * the corner so a node body becomes a stadium without erroring.
       *
       * Read off a probe INSIDE the theme, through the same resolver everything else uses.
       */
      tokenValues() {
        const host = themeRoot();
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
        host.appendChild(probe);
        const out: Record<string, number> = {};
        for (const name of [
          '--space-6',
          '--space-7',
          '--radius-4',
          '--font-size-2',
          '--line-height-3',
        ]) {
          probe.style.width = `var(${name})`;
          const px = parseFloat(getComputedStyle(probe).width);
          out[name] = Number.isFinite(px) ? px : NaN;
        }
        probe.remove();
        return out;
      },
      mark(name: string) {
        react.current = name;
        react.marks[name] ??= 0;
        resetGlCounters();
        bulk.copies = 0;
      },
      reactCommits: () => ({ commits: react.commits, marks: { ...react.marks } }),
      /**
       * Which tokens the theme actually defines.
       *
       * The token reader takes a FALLBACK for every value it cannot find, and the whole fallback
       * table is DARK. So a theme missing a token does not fail, or look obviously wrong in dark
       * mode — it silently paints one dark value into a light UI, and the more tokens are missing
       * the more of the canvas is quietly hardcoded. The v1 -> v2 swap is exactly that situation
       * at scale, which is why this exists before the swap rather than after it.
       *
       * The list is derived from FALLBACK_TOKENS rather than restated, so a token added to the
       * reader is censused without anyone remembering to add it here.
       */
      tokenCensus() {
        const root = themeRoot();
        const styles = getComputedStyle(root);
        const present: string[] = [];
        const missing: string[] = [];
        for (const key of Object.keys(FALLBACK_TOKENS)) {
          if (!key.startsWith('--')) continue; // `appearance` is derived, not read from CSS
          (styles.getPropertyValue(key).trim() ? present : missing).push(key);
        }
        return { present, missing };
      },
      gl: () => JSON.parse(JSON.stringify(gl)),
      resetGl: resetGlCounters,
      frames: frameStats,
      lib: { parseColorToRGB, parseColorToRGBA, resolveColorToRGB, parsePx, frozenHue },
      themeTokens: () => liveTokens as unknown as Readonly<Record<string, number | number[] | string>>,
      /**
       * What the PACKAGE resolves a length token to, through its own shipped path.
       *
       * Deliberately different from `tokenValues()`, which asks the browser by setting the value
       * on a probe inside the theme. This asks the way `readTokensFromDOM` does:
       * `getComputedStyle(themeRoot()).getPropertyValue(name)` — which returns a custom property's
       * DECLARED TEXT, `calc(12px * var(--scaling) * var(--radius-factor))`, not a resolved
       * length — and then hands that string to the exported `parsePx`. Where the two disagree,
       * the GL layer is painting the second number and the CSS is painting the first.
       */
      readLength(name: string) {
        const raw = getComputedStyle(themeRoot()).getPropertyValue(name).trim();
        return { raw, parsed: parsePx(raw) };
      },
    };

    // With more than one KookieFlow mounted, each Probe registers its own store. `__harness`
    // stays the FIRST so every existing test keeps working; `__harnesses` is the full list, which
    // is what a reentrancy test needs.
    const all = (window.__harnesses ??= []);
    all.push(api);
    if (!window.__harness) window.__harness = api;
    return () => {
      const i = all.indexOf(api);
      if (i >= 0) all.splice(i, 1);
      if (window.__harness === api) window.__harness = all[0];
    };
  }, [store]);

  // Two frames: one for React's commit, one for R3F to have actually drawn.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => markReady()));
    return () => cancelAnimationFrame(id);
  }, []);

  return null;
}

function App() {
  const p = useMemo(() => params(), []);
  const initial = useMemo(() => {
    if (p.scene === 'shapes') return makeShapes();
    if (p.scene === 'group') return makeGroup();
    if (p.scene === 'comments') return makeComments();
    return makeGraph({
      count: p.count,
      seed: p.seed,
      edgeRatio: p.edgeRatio,
      explicitSize: p.explicitSize,
    });
  }, [p.scene, p.count, p.seed, p.edgeRatio, p.explicitSize]);

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

  // One KookieFlow per instance, stacked as rows. Two instances is the reentrancy case: the
  // store used to keep its drag index and moved-id channel at MODULE scope, so constructing the
  // second store cleared the first one's map and dragging in the first silently stopped working.
  const flows = Array.from({ length: p.instances }, (_, i) => (
    <div
      key={i}
      data-instance={i}
      style={{ position: 'relative', flex: 1, minHeight: 0, borderTop: i > 0 ? '1px solid #ccc' : undefined }}
    >
      <KookieFlow
        entities={entities}
        edges={edges}
        onEntitiesChange={i === 0 ? onEntitiesChange : undefined}
        onEdgesChange={i === 0 ? onEdgesChange : undefined}
        showWidgets={p.widgets}
        showGrid={p.grid}
        showMinimap={false}
        {...(p.entityRadius ? { radius: p.entityRadius } : {})}
      >
        <Probe />
      </KookieFlow>
    </div>
  ));

  return (
    <Theme appearance={p.appearance} {...(p.radius ? { radius: p.radius } : {})}>
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
        {flows}
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

/**
 * Apply changes the way a real consumer would.
 *
 * This is not a convenience: KookieFlow is a CONTROLLED component, so whatever this function fails
 * to apply is pushed straight back into the store by FlowSync and undone. A change type missing
 * here does not "not update the fixture" — it actively reverts the library.
 *
 * It read `c.item` for an add, and the change union has always said `entity`. So EVERY add was
 * dropped: pressing T created a text entity in the store, this returned the unchanged array, and
 * the controlled prop flowed back and deleted it. The entity appeared and vanished within a frame.
 * Nothing noticed for as long as no law exercised an add — which is the degenerate-fixture problem
 * in the harness rather than in the graph, and it cost a correct fix a false failure.
 *
 * `data`, `collapse` and `parent` were missing outright, with the same consequence.
 */
function applyEntityChanges(prev: Entity[], changes: EntityChange[]): Entity[] {
  let next = prev;
  for (const c of changes as Array<Record<string, unknown>>) {
    const type = c.type as string;
    if (type === 'position' || type === 'select' || type === 'dimensions') {
      next = next.map((e) => (e.id === c.id ? ({ ...e, ...stripType(c) } as Entity) : e));
    } else if (type === 'collapse' || type === 'parent') {
      next = next.map((e) => (e.id === c.id ? ({ ...e, ...stripType(c) } as Entity) : e));
    } else if (type === 'data') {
      // Merged, not replaced — `applyEntityChanges` in the store spreads over the existing data.
      next = next.map((e) =>
        e.id === c.id ? ({ ...e, data: { ...e.data, ...(c.data as object) } } as Entity) : e
      );
    } else if (type === 'remove') {
      next = next.filter((e) => e.id !== c.id);
    } else if (type === 'add' && c.entity) {
      next = [...next, c.entity as Entity];
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
    } else if (type === 'add' && c.edge) {
      // `edge`, not `item` — same mismatch as the entity applier above, same consequence.
      next = [...next, c.edge as Edge];
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
