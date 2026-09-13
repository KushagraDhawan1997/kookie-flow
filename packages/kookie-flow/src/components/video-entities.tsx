/**
 * VideoEntities — video entities as WebGL textured quads, on the same quad an image uses.
 *
 * The shape of this file is image-entities.tsx's: React state holds only the SET of ids, every
 * position, texture and visibility write happens in `useFrame` through refs, and fine-grained
 * dirty flags keep that loop from doing work nothing asked for. What differs is the middle —
 * a still picture has LOD tiers and an upload queue, and a video has a playback policy instead.
 *
 * THE PLAYBACK POLICY IS THE PERFORMANCE STORY. A playing video uploads a frame per frame; a
 * paused one uploads nothing. So the culling pass does double duty: an entity that leaves the
 * viewport is not merely skipped, it is PAUSED, and it resumes when it comes back. Combined with
 * VideoTextureManager's hard cap on concurrent decoders, the per-frame cost of a board is bounded
 * by what is on screen rather than by what exists — which is the difference between a Flora-style
 * board of two hundred clips being usable and being a slideshow.
 *
 * See utils/video-loader.ts for why these are GL quads rather than DOM `<video>` elements.
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle } from '../contexts';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';
import { applyMediaGlass, buildMediaGlass } from '../utils/media-glass';
import { rgbToHex } from '../utils/color';
import { DEFAULT_VIDEO_WIDTH, DEFAULT_VIDEO_HEIGHT, MIN_VIDEO_HEIGHT } from '../core/constants';
import { VideoTextureManager } from '../utils/video-loader';
import type { VideoEntityData, EntityChange } from '../types';
import { entityDepth } from '../utils/entity-depth';
import { easeChromePresence, fitsControls, fitsExpand } from '../utils/media-chrome';
import { registerVideoOps } from '../utils/media-runtime';
import {
  sharedGeometry,
  createPlaceholderMaterial,
  createMediaMaterial,
  applyObjectFitUV,
  setMediaBox,
  setMediaChrome,
} from '../utils/media-quad';

const RENDER_ORDER_BG = 1;
const RENDER_ORDER_FG = 4;

/**
 * Padding, in screen pixels, around the viewport for culling.
 *
 * Matches image-entities. It is deliberately generous for video: an entity that crosses the edge
 * pauses and resumes, and a tight boundary would toggle a decoder on and off during a slow pan.
 */
const CULL_PADDING = 100;

interface VideoEntitiesProps {
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function VideoEntities({ onEntitiesChange }: VideoEntitiesProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  // A media entity is a surface, so it takes the theme's surface corner like a node body does.
  const resolvedStyle = useResolvedStyle();

  const [videoEntityIds, setVideoEntityIds] = useState<string[]>(() =>
    store.getState().entities.filter((e) => e.type === 'video').map((e) => e.id)
  );

  const fullDirtyRef = useRef(true);
  const hiddenDirtyRef = useRef(true);
  const topologyDirtyRef = useRef(true);

  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const refCallbacksRef = useRef<Map<string, (mesh: THREE.Mesh | null) => void>>(new Map());
  const materialRefs = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  const loadedSrcRefs = useRef<Map<string, string>>(new Map());

  const autoSizedRef = useRef<Set<string>>(new Set());
  const pendingDimUpdatesRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const dimFlushScheduledRef = useRef(false);

  const videoEntityIdsRef = useRef(videoEntityIds);
  videoEntityIdsRef.current = videoEntityIds;
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  onEntitiesChangeRef.current = onEntitiesChange;

  // The controls' glass, shared by every material; see utils/media-glass.ts.
  const glass = useMemo(
    () => buildMediaGlass(tokens, resolveColor(THEME_COLORS.canvas.background, tokens), resolvedStyle.widgetRadius),
    [tokens, resolvedStyle.widgetRadius]
  );
  const glassRef = useRef(glass);
  glassRef.current = glass;
  useEffect(() => {
    for (const mat of materialRefs.current.values()) applyMediaGlass(mat, glass);
    fullDirtyRef.current = true;
  }, [glass]);

  /**
   * Sources this pass decided should be playing.
   *
   * Reused between frames rather than allocated, because it is written in `useFrame` and a fresh
   * Set per frame is exactly the hot-path allocation this project forbids. It is the reason
   * playback can be expressed as "what SHOULD play", computed fresh each pass, rather than as a
   * pile of transitions each caller has to get right.
   */
  const wantPlayingRef = useRef<Set<string>>(new Set());
  /** Sources some entity explicitly wants playing, and ones a consumer explicitly paused. Per pass. */
  const explicitPlayRef = useRef<Set<string>>(new Set());
  const explicitPauseRef = useRef<Set<string>>(new Set());
  /**
   * How faded in each entity's controls are, 0..1.
   *
   * Eased rather than switched, so the bar arrives under the pointer instead of blinking, and
   * kept in a ref because it changes every frame of a fade and must never reach React.
   */
  const chromePresenceRef = useRef<Map<string, number>>(new Map());
  /** Whether any chrome is on screen or on its way there, and the pass must therefore run. */
  const chromeFadingRef = useRef(false);
  /**
   * What the PERSON asked for, per entity, by pressing play or pause.
   *
   * It outranks `autoplay`, and has to: without it the next pass reconciled playback from the
   * entity's data and started the clip again, so the pause button worked for one frame. Cleared
   * when the consumer states `playing` explicitly, because then the app is driving and the app's
   * word is the newer one.
   */
  const userPlaybackRef = useRef<Map<string, boolean>>(new Map());

  const texManager = useMemo(
    () => new VideoTextureManager(() => { fullDirtyRef.current = true; }),
    []
  );

  const placeholderColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);
  const errorColor = rgbToHex(tokens[THEME_COLORS.edge.invalid]);

  const placeholderMat = useMemo(() => createPlaceholderMaterial(placeholderColor), [placeholderColor]);
  const errorMat = useMemo(() => createPlaceholderMaterial(errorColor), [errorColor]);

  // Freed when the memo that built them is replaced — a theme flip rebuilds both, and three never
  // reclaims an abandoned material from its caches on garbage collection. Same reasoning as
  // image-entities.tsx, which had this exact leak before it was found.
  useEffect(() => () => { placeholderMat.dispose(); }, [placeholderMat]);
  useEffect(() => () => { errorMat.dispose(); }, [errorMat]);

  // Every element, texture and decoder this manager owns goes back on unmount. A video left
  // running in a detached element keeps decoding.
  useEffect(() => () => {
    texManager.disposeAll();
    for (const mat of materialRefs.current.values()) {
      if (mat.uniforms.map) mat.uniforms.map.value = null;
    }
  }, [texManager]);

  useEffect(() => {
    const materials = materialRefs.current;
    return () => {
      materials.forEach((m) => m.dispose());
      materials.clear();
    };
  }, []);

  useEffect(() => {
    const markFullDirty = () => { fullDirtyRef.current = true; };

    const unsubTopology = store.subscribe((s) => s.topologyVersion, () => {
      markFullDirty();
      topologyDirtyRef.current = true;
      const ids = store.getState().entities.filter((e) => e.type === 'video').map((e) => e.id);
      setVideoEntityIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) {
          if (prev[i] !== ids[i]) return ids;
        }
        return prev;
      });
    });
    const unsubPositions = store.subscribe((s) => s.positionVersion, markFullDirty);
    let lastPosVersion = store.getState().positionVersion;
    const unsubEntities = store.subscribe((s) => s.entities, () => {
      const pv = store.getState().positionVersion;
      if (pv !== lastPosVersion) {
        lastPosVersion = pv;
        return;
      }
      markFullDirty();
    });
    const unsubViewport = store.subscribe((s) => s.viewport, markFullDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markFullDirty);
    const unsubStack = store.subscribe((s) => s.stackVersion, markFullDirty);
    const unsubHovered = store.subscribe((s) => s.hoveredEntityId, markFullDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, () => {
      // A hidden video must also stop decoding, and only the full pass computes playback.
      hiddenDirtyRef.current = true;
      markFullDirty();
    });

    return () => {
      unsubTopology();
      unsubPositions();
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubStack();
      unsubHidden();
      unsubHovered();
    };
  }, [store]);

  /**
   * What a press on a video's controls acts on.
   *
   * The pointer handler knows an entity was pressed; the element that has to play or seek is
   * loaded here. Registered against the store, which is what identifies one flow.
   */
  useEffect(() => {
    registerVideoOps(store, 'entity', {
      toggle: (entityId) => {
        const src = (store.getState().entityMap.get(entityId)?.data as VideoEntityData | undefined)?.src;
        if (!src) return;
        const next = !texManager.isPlaying(src);
        // By source: the element is per source, so a press on one copy of a clip is a press on all.
        userPlaybackRef.current.set(src, next);
        texManager.setPlaying(src, next);
        fullDirtyRef.current = true;
      },
      seek: (entityId, t) => {
        const src = (store.getState().entityMap.get(entityId)?.data as VideoEntityData | undefined)?.src;
        if (!src) return;
        const entry = texManager.getEntry(src);
        const duration = entry?.element.duration;
        if (!entry || !duration || !Number.isFinite(duration)) return;
        entry.element.currentTime = Math.min(Math.max(t, 0), 1) * duration;
        fullDirtyRef.current = true;
      },
      currentTime: (entityId) => {
        const src = (store.getState().entityMap.get(entityId)?.data as VideoEntityData | undefined)?.src;
        return (src ? texManager.getEntry(src)?.element.currentTime : 0) ?? 0;
      },
    });
    return () => registerVideoOps(store, 'entity', null);
  }, [store, texManager]);

  function getRefCallback(id: string): (mesh: THREE.Mesh | null) => void {
    let cb = refCallbacksRef.current.get(id);
    if (!cb) {
      cb = (mesh: THREE.Mesh | null) => {
        if (mesh) {
          meshRefs.current.set(id, mesh);
          if (!materialRefs.current.has(id)) {
            materialRefs.current.set(id, createMediaMaterial(glassRef.current));
          }
        } else {
          meshRefs.current.delete(id);
        }
      };
      refCallbacksRef.current.set(id, cb);
    }
    return cb;
  }

  useFrame(({ size }, delta) => {
    // Controls fading in or standing open keep the pass alive: the bar's own progress line moves
    // with the clip, and nothing in the store changes while a video plays.
    if (!fullDirtyRef.current && !hiddenDirtyRef.current && !chromeFadingRef.current) return;
    let chromeFading = false;

    const { entityMap, viewport, selectedEntityIds, hiddenEntityIds, stackOrder, hoveredEntityId } =
      store.getState();
    const ids = videoEntityIdsRef.current;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;

    const wantPlaying = wantPlayingRef.current;
    wantPlaying.clear();
    const explicitPlay = explicitPlayRef.current;
    const explicitPause = explicitPauseRef.current;
    explicitPlay.clear();
    explicitPause.clear();

    for (let i = 0; i < ids.length; i++) {
      const entity = entityMap.get(ids[i]);
      if (!entity) continue;
      const mesh = meshRefs.current.get(entity.id);
      if (!mesh) continue;

      const data = entity.data as VideoEntityData;
      const src = data.src;

      // Source bookkeeping runs before any visibility decision, so an entity that is off screen
      // still holds its reference — releasing on cull would tear the element down and rebuild it
      // on every pan across the edge.
      const prevSrc = loadedSrcRefs.current.get(entity.id);
      if (src && src !== prevSrc) {
        if (prevSrc) texManager.release(prevSrc);
        texManager.acquire(src, data.loop ?? true);
        loadedSrcRefs.current.set(entity.id, src);
        autoSizedRef.current.delete(entity.id);
      } else if (!src && prevSrc) {
        texManager.release(prevSrc);
        loadedSrcRefs.current.delete(entity.id);
      }

      if (hiddenEntityIds.has(entity.id)) {
        mesh.visible = false;
        continue;
      }

      const w = entity.width ?? DEFAULT_VIDEO_WIDTH;
      const h = entity.height ?? DEFAULT_VIDEO_HEIGHT;

      const entityRight = entity.position.x + w;
      const entityBottom = entity.position.y + h;
      if (
        entityRight < viewLeft - CULL_PADDING ||
        entity.position.x > viewRight + CULL_PADDING ||
        entityBottom < viewTop - CULL_PADDING ||
        entity.position.y > viewBottom + CULL_PADDING
      ) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;

      const cx = entity.position.x + w / 2;
      const cy = -(entity.position.y + h / 2);
      mesh.position.set(cx, cy, entityDepth(entity.id, stackOrder, selectedEntityIds));
      mesh.scale.set(w, h, 1);
      mesh.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;

      // Reaching here means visible and on screen, so this is the only place playback is asked
      // for. `playing` is the explicit switch a consumer drives; `autoplay` is the standing wish
      // for a preview that should run whenever it can be seen.
      //
      // Keyed by SOURCE, not by entity. Two entities showing one clip share one element, and keyed
      // by entity a pause pressed on one was undone on the next frame by the other's autoplay.
      const asked = src ? userPlaybackRef.current.get(src) : undefined;
      // The consumer stating `playing` is a newer instruction than a press was, so it wins and
      // the press is forgotten. Otherwise the press stands, and `autoplay` is only the opening
      // position.
      if (src && data.playing !== undefined && asked !== undefined) {
        userPlaybackRef.current.delete(src);
      }
      const wants = data.playing !== undefined
        ? data.playing
        : asked ?? data.autoplay ?? false;
      if (src) {
        // A clip that failed to load is never asked to play. Its play() only rejects, and asked
        // anyway it took a decoder slot ahead of a working clip on every pass.
        if (wants && texManager.getEntry(src)?.state !== 'error') wantPlaying.add(src);
        if (data.playing === true || asked === true) explicitPlay.add(src);
        else if (data.playing === false) explicitPause.add(src);
      }

      const entry = src ? texManager.getEntry(src) : undefined;
      const texture = src ? texManager.getTexture(src) : null;

      /**
       * The controls, on by default and drawn only under the pointer.
       *
       * `controls: false` turns them off — a video used as decoration on a board should not grow
       * a play bar when the pointer crosses it. A clip too small for a bar never shows one, since
       * a control strip in a thumbnail is a smudge rather than an affordance; it may still be big
       * enough for the expand button, which is one square.
       */
      const wantsChrome =
        (data.controls ?? true) && hoveredEntityId === entity.id && fitsExpand(w, h);
      const presence = easeChromePresence(chromePresenceRef.current, entity.id, wantsChrome, delta);
      if (presence > 0.001) chromeFading = true;

      if (texture) {
        const mat = materialRefs.current.get(entity.id);
        if (mat) {
          setMediaBox(mat, w, h, resolvedStyle.borderRadius);
          const element = entry?.element;
          const duration = element?.duration;
          const played = element && duration && Number.isFinite(duration) && duration > 0
            ? element.currentTime / duration
            : 0;
          setMediaChrome(
            mat,
            presence > 0.001 && fitsControls(w, h) ? 1 : 0,
            played,
            src ? texManager.isPlaying(src) : false,
            presence,
            presence
          );
          // A clip that is running redraws its own frames anyway; one that is paused still has to
          // repaint while its bar fades, and while it is showing, so the played line keeps up.
          if (presence > 0.001) chromeFading = true;
          const u = mat.uniforms;
          if (u.map.value !== texture) u.map.value = texture;
          u.opacity.value = 1;
          applyObjectFitUV(
            u.uvOffset.value as THREE.Vector2,
            u.uvScale.value as THREE.Vector2,
            data.objectFit ?? 'contain',
            w, h,
            entry?.naturalWidth ?? 0,
            entry?.naturalHeight ?? 0
          );
          mesh.material = mat;
        }
      } else {
        mesh.material = entry?.state === 'error' ? errorMat : placeholderMat;
      }

      // Auto aspect: a clip's frame size is not known until metadata lands, so the entity is
      // reshaped once, the first time it is. Same deferral as images — the store write happens in
      // a microtask, never inside useFrame.
      if (entry && entry.naturalWidth > 0 && entry.naturalHeight > 0 && !autoSizedRef.current.has(entity.id)) {
        autoSizedRef.current.add(entity.id);
        const naturalAR = entry.naturalHeight / entry.naturalWidth;
        const expectedH = Math.max(MIN_VIDEO_HEIGHT, Math.round(w * naturalAR));
        if (Math.abs(expectedH - h) > 0.5) {
          pendingDimUpdatesRef.current.set(entity.id, { w, h: expectedH });
        }
      }
    }

    // ONE pass over the manager's own view of what is decoding, not over the entities: a source
    // shared by two entities must stay playing while either wants it, and a source whose entity
    // has just been culled has no entity left to tell it to stop.
    // A consumer's explicit pause on one entity outranks another entity's standing autoplay for the
    // same clip; an explicit play outranks both.
    for (const s of explicitPause) if (!explicitPlay.has(s)) wantPlaying.delete(s);
    texManager.reconcilePlayback(wantPlaying);

    if (pendingDimUpdatesRef.current.size > 0 && !dimFlushScheduledRef.current) {
      dimFlushScheduledRef.current = true;
      queueMicrotask(() => {
        dimFlushScheduledRef.current = false;
        const pending = pendingDimUpdatesRef.current;
        if (pending.size === 0) return;
        const changes: EntityChange[] = [];
        for (const [id, { w, h }] of pending) {
          store.getState().updateEntityDimensions(id, w, h);
          changes.push({ type: 'dimensions', id, dimensions: { width: w, height: h } });
        }
        pending.clear();
        onEntitiesChangeRef.current?.(changes);
      });
    }

    if (topologyDirtyRef.current) {
      for (const [id] of materialRefs.current) {
        if (!meshRefs.current.has(id)) {
          materialRefs.current.get(id)?.dispose();
          materialRefs.current.delete(id);
          refCallbacksRef.current.delete(id);
          autoSizedRef.current.delete(id);
          const src = loadedSrcRefs.current.get(id);
          if (src) {
            texManager.release(src);
            loadedSrcRefs.current.delete(id);
          }
        }
      }
      topologyDirtyRef.current = false;
    }

    chromeFadingRef.current = chromeFading;
    fullDirtyRef.current = false;
    hiddenDirtyRef.current = false;
  });

  return (
    <group>
      {videoEntityIds.map((id) => (
        <mesh
          key={id}
          ref={getRefCallback(id)}
          geometry={sharedGeometry}
          material={placeholderMat}
          frustumCulled={false}
          renderOrder={RENDER_ORDER_BG}
        />
      ))}
    </group>
  );
}
