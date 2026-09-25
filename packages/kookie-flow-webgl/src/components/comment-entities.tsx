import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme, useThemeScope } from '../contexts/ThemeContext';
import { useResolvedStyle } from '../contexts/StyleContext';
import { ViewportCuller } from '../utils/viewport-culler';
import { CORNER_K, squircleBoxSDF } from '../utils/corner-shader';
import { commentPaint } from '../utils/comment-paint';
import { entityDepth } from '@kushagradhawan/kookie-flow-core/internal/utils/entity-depth';

/** Notes use two instanced batches, like nodes. DOM count does not grow with graph size. */
export function CommentEntities() {
  return (
    <>
      <CommentBatch foreground={false} />
      <CommentBatch foreground />
    </>
  );
}

function CommentBatch({ foreground }: { foreground: boolean }) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const scope = useThemeScope();
  const style = useResolvedStyle();
  const countNotes = () =>
    store.getState().entities.reduce((n, e) => n + Number(e.type === 'comment'), 0);
  const [capacity, setCapacity] = useState(() => Math.max(64, countNotes()));
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dirty = useRef(true);
  const culler = useMemo(() => new ViewportCuller(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const buffers = useMemo(
    () => ({
      sizes: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2),
      fills: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
      edges: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
    }),
    [capacity]
  );
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aSize', buffers.sizes);
    g.setAttribute('aFill', buffers.fills);
    g.setAttribute('aEdge', buffers.edges);
    return g;
  }, [buffers]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
        uniforms: { uRadius: { value: 0 } },
        vertexShader: `
      attribute vec2 aSize;
      attribute vec4 aFill;
      attribute vec4 aEdge;
      varying vec2 vLocal;
      varying vec2 vSize;
      varying vec4 vFill;
      varying vec4 vEdge;
      void main() {
        vLocal = position.xy * aSize;
        vSize = aSize; vFill = aFill; vEdge = aEdge;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(vLocal, 0.0, 1.0);
      }
    `,
        fragmentShader: `
      uniform float uRadius;
      varying vec2 vLocal;
      varying vec2 vSize;
      varying vec4 vFill;
      varying vec4 vEdge;
      ${squircleBoxSDF}
      void main() {
        float d = roundedBoxSDF(vLocal, vSize * 0.5, uRadius);
        float aa = max(fwidth(d), 0.0001);
        float coverage = 1.0 - smoothstep(-aa, aa, d);
        if (coverage < 0.001) discard;
        float rim = smoothstep(-1.0-aa, -1.0+aa, d) * vEdge.a;
        vec3 color = mix(vFill.rgb, vEdge.rgb, rim);
        gl_FragColor = vec4(color, max(vFill.a, rim) * coverage);
      }
    `,
      }),
    []
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    dirty.current = true;
  }, [tokens, scope, style, capacity]);
  useEffect(() => {
    const mark = () => {
      dirty.current = true;
      culler.invalidate();
    };
    const unsub = [
      store.subscribe(
        (s) => s.entities,
        () => {
          mark();
          const count = countNotes();
          setCapacity((old) => (count > old ? Math.ceil(count * 1.5) : old));
        }
      ),
      store.subscribe((s) => s.positionVersion, mark),
      store.subscribe((s) => s.selectedEntityIds, mark),
      store.subscribe((s) => s.hiddenEntityIds, mark),
      store.subscribe((s) => s.stackVersion, mark),
    ];
    return () => {
      for (const off of unsub) off();
    };
  }, [store, culler]);
  useFrame(({ size }) => {
    if (!mesh.current || !scope) return;
    const state = store.getState();
    const vp = state.viewport;
    const changed = culler.refresh(
      state.quadtree,
      vp.x,
      vp.y,
      vp.zoom,
      size.width,
      size.height,
      100
    );
    if (!changed && !dirty.current) return;
    material.uniforms.uRadius.value = style.borderRadius * CORNER_K;
    let count = 0;
    for (let i = 0; i < culler.count; i++) {
      const e = state.entityMap.get(culler.ids[i]);
      if (
        !e ||
        e.type !== 'comment' ||
        state.hiddenEntityIds.has(e.id) ||
        state.selectedEntityIds.has(e.id) !== foreground
      )
        continue;
      if (count === capacity) break;
      const width = e.width ?? 200,
        height = e.height ?? 100;
      const paint = commentPaint(e, tokens, scope);
      matrix
        .identity()
        .setPosition(
          e.position.x + width / 2,
          -(e.position.y + height / 2),
          entityDepth(e.id, state.stackOrder, state.selectedEntityIds)
        );
      mesh.current.setMatrixAt(count, matrix);
      buffers.sizes.setXY(count, width, height);
      buffers.fills.setXYZW(count, ...paint.fill);
      buffers.edges.setXYZW(count, ...paint.edge);
      count++;
    }
    mesh.current.count = count;
    mesh.current.instanceMatrix.needsUpdate = true;
    buffers.sizes.needsUpdate = true;
    buffers.fills.needsUpdate = true;
    buffers.edges.needsUpdate = true;
    dirty.current = false;
  });
  return (
    <instancedMesh
      name={foreground ? 'comments-foreground' : 'comments-background'}
      ref={mesh}
      args={[geometry, material, capacity]}
      count={0}
      frustumCulled={false}
      renderOrder={foreground ? 4 : 1}
    />
  );
}
