import {
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import type { MinimapProps, Node } from '../types';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MINIMAP_DEFAULTS,
} from '../core/constants';

/** Transform to map world coordinates to minimap coordinates */
interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Drag state for viewport indicator */
interface DragState {
  startMinimapX: number;
  startMinimapY: number;
  startViewportX: number;
  startViewportY: number;
}

/** Minimum rendered size in pixels - below this, skip rendering */
const MIN_RENDER_SIZE = 0.5;

/**
 * Calculate the transform to fit all nodes into minimap with padding.
 * Writes directly to output object to avoid allocations.
 * Returns false if no valid transform (empty or degenerate bounds).
 */
function calculateMinimapTransform(
  nodes: Node[],
  minimapWidth: number,
  minimapHeight: number,
  padding: number,
  out: MinimapTransform
): boolean {
  if (nodes.length === 0) return false;

  // Calculate world bounds
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const h = node.height ?? DEFAULT_NODE_HEIGHT;
    const px = node.position.x;
    const py = node.position.y;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px + w > maxX) maxX = px + w;
    if (py + h > maxY) maxY = py + h;
  }

  const worldWidth = maxX - minX;
  const worldHeight = maxY - minY;

  // Handle degenerate cases
  if (worldWidth <= 0 || worldHeight <= 0) return false;

  // Available minimap area (with padding)
  const availableWidth = minimapWidth - padding * 2;
  const availableHeight = minimapHeight - padding * 2;

  // Scale to fit
  const scale = Math.min(
    availableWidth / worldWidth,
    availableHeight / worldHeight
  );

  // Center in minimap
  const scaledWidth = worldWidth * scale;
  const scaledHeight = worldHeight * scale;

  out.scale = scale;
  out.offsetX = padding + (availableWidth - scaledWidth) / 2 - minX * scale;
  out.offsetY = padding + (availableHeight - scaledHeight) / 2 - minY * scale;

  return true;
}

/**
 * Generate a hash of node positions for change detection.
 * Uses a simple checksum approach - fast but not cryptographic.
 */
function hashNodePositions(nodes: Node[]): number {
  let hash = nodes.length;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Combine position into hash (bitwise ops are fast)
    hash = ((hash << 5) - hash + (node.position.x | 0)) | 0;
    hash = ((hash << 5) - hash + (node.position.y | 0)) | 0;
  }
  return hash;
}

/** Position styles for each corner */
const POSITION_STYLES: Record<string, CSSProperties> = {
  'top-left': { top: 10, left: 10 },
  'top-right': { top: 10, right: 10 },
  'bottom-left': { bottom: 10, left: 10 },
  'bottom-right': { bottom: 10, right: 10 },
};

/**
 * Minimap component - Canvas 2D overview of the graph.
 *
 * Performance optimizations:
 * - Canvas 2D for efficient rendering of 10k+ rectangles (single composite)
 * - RAF-throttled updates (single render per frame)
 * - Fine-grained dirty flags (skip node redraw for viewport-only changes)
 * - Position hash for bounds invalidation (detects node moves)
 * - Inline coordinate math (zero object allocations in render loop)
 * - Culling for sub-pixel nodes
 * - ResizeObserver for container size (no layout queries in render)
 * - HiDPI support for crisp rendering
 */
export function Minimap({
  position = 'bottom-right',
  width = MINIMAP_DEFAULTS.width,
  height = MINIMAP_DEFAULTS.height,
  backgroundColor = MINIMAP_DEFAULTS.backgroundColor,
  nodeColor = MINIMAP_DEFAULTS.nodeColor,
  selectedNodeColor = MINIMAP_DEFAULTS.selectedNodeColor,
  viewportColor = MINIMAP_DEFAULTS.viewportColor,
  viewportBorderColor = MINIMAP_DEFAULTS.viewportBorderColor,
  padding = MINIMAP_DEFAULTS.padding,
  interactive = true,
  zoomable = false,
  className,
}: MinimapProps) {
  const store = useFlowStoreApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafIdRef = useRef<number>(0);

  // Pre-allocated transform object (reused, never recreated)
  const transformRef = useRef<MinimapTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const hasValidTransformRef = useRef(false);

  // Change detection
  const lastPositionHashRef = useRef<number>(0);
  const lastSelectionRef = useRef<Set<string> | null>(null);

  // Container size (updated via ResizeObserver, not layout queries)
  const containerSizeRef = useRef({ width: 0, height: 0 });

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  // Track when drag just ended to ignore the subsequent click event
  const justFinishedDraggingRef = useRef(false);

  // Viewport indicator bounds (for hit testing)
  const viewportRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Dirty flags
  const dirtyRef = useRef({
    nodes: true,      // Nodes changed (positions, count, etc.)
    selection: true,  // Selection changed
    viewport: true,   // Viewport changed
  });

  // Main render function - only redraws what's necessary
  const render = useCallback(() => {
    rafIdRef.current = 0;

    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const { nodes, viewport, selectedNodeIds } = store.getState();
    const containerWidth = containerSizeRef.current.width;
    const containerHeight = containerSizeRef.current.height;

    // Check what actually changed
    const currentHash = hashNodePositions(nodes);
    const nodesChanged = currentHash !== lastPositionHashRef.current || nodes.length !== (lastPositionHashRef.current === 0 ? 0 : nodes.length);
    const selectionChanged = selectedNodeIds !== lastSelectionRef.current;

    if (nodesChanged) {
      lastPositionHashRef.current = currentHash;
      dirtyRef.current.nodes = true;
    }
    if (selectionChanged) {
      lastSelectionRef.current = selectedNodeIds;
      dirtyRef.current.selection = true;
    }

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (nodes.length === 0) {
      // Reset dirty flags
      dirtyRef.current.nodes = false;
      dirtyRef.current.selection = false;
      dirtyRef.current.viewport = false;
      return;
    }

    if (zoomable) {
      // Zoomable mode: minimap mirrors main viewport zoom/pan
      const baseScale = MINIMAP_DEFAULTS.zoomableBaseScale;
      const minimapScale = viewport.zoom * baseScale;

      // Calculate the center of what's visible in world space
      const invZoom = 1 / viewport.zoom;
      const worldCenterX = (-viewport.x + containerWidth / 2) * invZoom;
      const worldCenterY = (-viewport.y + containerHeight / 2) * invZoom;

      // Offset to center the view in the minimap
      const offsetX = width / 2 - worldCenterX * minimapScale;
      const offsetY = height / 2 - worldCenterY * minimapScale;

      // Draw nodes - inline coordinate math, no object allocations
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const w = node.width ?? DEFAULT_NODE_WIDTH;
        const h = node.height ?? DEFAULT_NODE_HEIGHT;

        const scaledW = w * minimapScale;
        const scaledH = h * minimapScale;

        // Culling: skip sub-pixel nodes
        if (scaledW < MIN_RENDER_SIZE && scaledH < MIN_RENDER_SIZE) continue;

        const x = node.position.x * minimapScale + offsetX;
        const y = node.position.y * minimapScale + offsetY;

        // Culling: skip nodes outside minimap bounds
        if (x + scaledW < 0 || x > width || y + scaledH < 0 || y > height) continue;

        const isSelected = selectedNodeIds.has(node.id);
        ctx.fillStyle = isSelected
          ? selectedNodeColor
          : typeof nodeColor === 'function'
          ? nodeColor(node)
          : nodeColor;
        ctx.fillRect(x, y, Math.max(MINIMAP_DEFAULTS.minNodeSize, scaledW), Math.max(MINIMAP_DEFAULTS.minNodeSize, scaledH));
      }

      // Draw viewport indicator as border
      ctx.strokeStyle = viewportBorderColor;
      ctx.lineWidth = MINIMAP_DEFAULTS.viewportBorderWidth;
      ctx.strokeRect(
        MINIMAP_DEFAULTS.viewportBorderWidth / 2,
        MINIMAP_DEFAULTS.viewportBorderWidth / 2,
        width - MINIMAP_DEFAULTS.viewportBorderWidth,
        height - MINIMAP_DEFAULTS.viewportBorderWidth
      );

      viewportRectRef.current = { x: 0, y: 0, w: width, h: height };
    } else {
      // Standard mode: show all nodes, viewport indicator resizes with zoom

      // Recalculate transform if nodes changed
      if (dirtyRef.current.nodes) {
        hasValidTransformRef.current = calculateMinimapTransform(
          nodes,
          width,
          height,
          padding,
          transformRef.current
        );
      }

      if (!hasValidTransformRef.current) {
        dirtyRef.current.nodes = false;
        dirtyRef.current.selection = false;
        dirtyRef.current.viewport = false;
        return;
      }

      const { scale, offsetX, offsetY } = transformRef.current;

      // Draw nodes - inline coordinate math, no object allocations
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const w = node.width ?? DEFAULT_NODE_WIDTH;
        const h = node.height ?? DEFAULT_NODE_HEIGHT;

        const scaledW = w * scale;
        const scaledH = h * scale;

        // Culling: skip sub-pixel nodes (unlikely in standard mode but check anyway)
        if (scaledW < MIN_RENDER_SIZE && scaledH < MIN_RENDER_SIZE) continue;

        // Inline worldToMinimap: x = worldX * scale + offsetX
        const x = node.position.x * scale + offsetX;
        const y = node.position.y * scale + offsetY;

        const isSelected = selectedNodeIds.has(node.id);
        ctx.fillStyle = isSelected
          ? selectedNodeColor
          : typeof nodeColor === 'function'
          ? nodeColor(node)
          : nodeColor;
        ctx.fillRect(x, y, Math.max(MINIMAP_DEFAULTS.minNodeSize, scaledW), Math.max(MINIMAP_DEFAULTS.minNodeSize, scaledH));
      }

      // Draw viewport indicator
      if (containerWidth > 0 && containerHeight > 0) {
        // Calculate what's visible in world space
        const invZoom = 1 / viewport.zoom;
        const worldLeft = -viewport.x * invZoom;
        const worldTop = -viewport.y * invZoom;
        const worldRight = worldLeft + containerWidth * invZoom;
        const worldBottom = worldTop + containerHeight * invZoom;

        // Inline worldToMinimap
        const minX = worldLeft * scale + offsetX;
        const minY = worldTop * scale + offsetY;
        const maxX = worldRight * scale + offsetX;
        const maxY = worldBottom * scale + offsetY;

        const rectWidth = maxX - minX;
        const rectHeight = maxY - minY;

        // Store for hit testing
        viewportRectRef.current = { x: minX, y: minY, w: rectWidth, h: rectHeight };

        // Draw filled rectangle
        ctx.fillStyle = viewportColor;
        ctx.fillRect(minX, minY, rectWidth, rectHeight);

        // Draw border
        ctx.strokeStyle = viewportBorderColor;
        ctx.lineWidth = MINIMAP_DEFAULTS.viewportBorderWidth;
        ctx.strokeRect(minX, minY, rectWidth, rectHeight);
      }
    }

    // Reset dirty flags
    dirtyRef.current.nodes = false;
    dirtyRef.current.selection = false;
    dirtyRef.current.viewport = false;
  }, [
    store,
    width,
    height,
    padding,
    backgroundColor,
    nodeColor,
    selectedNodeColor,
    viewportColor,
    viewportBorderColor,
    zoomable,
  ]);

  // Schedule render via RAF
  const scheduleRender = useCallback(() => {
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(render);
    }
  }, [render]);

  // Check if point is inside viewport indicator
  const isInsideViewportIndicator = useCallback(
    (minimapX: number, minimapY: number): boolean => {
      const rect = viewportRectRef.current;
      return (
        minimapX >= rect.x &&
        minimapX <= rect.x + rect.w &&
        minimapY >= rect.y &&
        minimapY <= rect.y + rect.h
      );
    },
    []
  );

  // Click handler - pan to clicked position
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Stop propagation to prevent main canvas from receiving event
      e.stopPropagation();

      // Skip click if we just finished dragging (click fires after pointerUp)
      if (justFinishedDraggingRef.current) {
        justFinishedDraggingRef.current = false;
        return;
      }

      if (!interactive || isDraggingRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Use CSS pixels (not canvas pixels) - transform is in CSS pixel space
      const minimapX = e.clientX - rect.left;
      const minimapY = e.clientY - rect.top;

      const { viewport, setViewport } = store.getState();
      const containerWidth = containerSizeRef.current.width;
      const containerHeight = containerSizeRef.current.height;

      if (zoomable) {
        // In zoomable mode, clicking pans relative to current view
        const baseScale = MINIMAP_DEFAULTS.zoomableBaseScale;
        const minimapScale = viewport.zoom * baseScale;
        const invZoom = 1 / viewport.zoom;

        // Current world center
        const worldCenterX = (-viewport.x + containerWidth / 2) * invZoom;
        const worldCenterY = (-viewport.y + containerHeight / 2) * invZoom;

        // Offset used in rendering
        const offsetX = width / 2 - worldCenterX * minimapScale;
        const offsetY = height / 2 - worldCenterY * minimapScale;

        // Convert click to world coords (inline minimapToWorld)
        const worldX = (minimapX - offsetX) / minimapScale;
        const worldY = (minimapY - offsetY) / minimapScale;

        const newX = containerWidth / 2 - worldX * viewport.zoom;
        const newY = containerHeight / 2 - worldY * viewport.zoom;

        setViewport({ x: newX, y: newY, zoom: viewport.zoom });
      } else {
        // Standard mode
        if (!hasValidTransformRef.current) return;

        // Don't pan if clicking on viewport indicator
        if (isInsideViewportIndicator(minimapX, minimapY)) return;

        // Inline minimapToWorld
        const { scale, offsetX, offsetY } = transformRef.current;
        const worldX = (minimapX - offsetX) / scale;
        const worldY = (minimapY - offsetY) / scale;

        const newX = containerWidth / 2 - worldX * viewport.zoom;
        const newY = containerHeight / 2 - worldY * viewport.zoom;

        setViewport({ x: newX, y: newY, zoom: viewport.zoom });
      }
    },
    [store, interactive, isInsideViewportIndicator, zoomable, width, height]
  );

  // Pointer down handler - start drag if on viewport indicator (or anywhere in zoomable mode)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Stop propagation to prevent main canvas from receiving event
      e.stopPropagation();

      if (!interactive) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Use CSS pixels (not canvas pixels) - transform is in CSS pixel space
      const minimapX = e.clientX - rect.left;
      const minimapY = e.clientY - rect.top;

      // In zoomable mode, drag anywhere to pan; in standard mode, only on viewport indicator
      const canDrag = zoomable || isInsideViewportIndicator(minimapX, minimapY);

      if (canDrag) {
        isDraggingRef.current = true;
        const { viewport } = store.getState();
        dragStateRef.current = {
          startMinimapX: minimapX,
          startMinimapY: minimapY,
          startViewportX: viewport.x,
          startViewportY: viewport.y,
        };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
      }
    },
    [store, interactive, isInsideViewportIndicator, zoomable]
  );

  // Pointer move handler - drag viewport indicator
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Stop propagation to prevent main canvas from receiving event
      e.stopPropagation();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Use CSS pixels (not canvas pixels) - transform is in CSS pixel space
      const minimapX = e.clientX - rect.left;
      const minimapY = e.clientY - rect.top;

      if (isDraggingRef.current && dragStateRef.current) {
        // Calculate delta in minimap space
        const deltaMinimapX = minimapX - dragStateRef.current.startMinimapX;
        const deltaMinimapY = minimapY - dragStateRef.current.startMinimapY;

        const { viewport, setViewport } = store.getState();

        if (zoomable) {
          // In zoomable mode, delta is inverted (dragging moves the view, not an indicator)
          const baseScale = MINIMAP_DEFAULTS.zoomableBaseScale;
          const minimapScale = viewport.zoom * baseScale;
          const deltaWorldX = deltaMinimapX / minimapScale;
          const deltaWorldY = deltaMinimapY / minimapScale;

          setViewport({
            x: dragStateRef.current.startViewportX + deltaWorldX * viewport.zoom,
            y: dragStateRef.current.startViewportY + deltaWorldY * viewport.zoom,
            zoom: viewport.zoom,
          });
        } else {
          // Standard mode: moving indicator right = viewport moves right = x decreases
          if (!hasValidTransformRef.current) return;
          const { scale } = transformRef.current;

          const deltaWorldX = deltaMinimapX / scale;
          const deltaWorldY = deltaMinimapY / scale;

          setViewport({
            x: dragStateRef.current.startViewportX - deltaWorldX * viewport.zoom,
            y: dragStateRef.current.startViewportY - deltaWorldY * viewport.zoom,
            zoom: viewport.zoom,
          });
        }
      } else if (interactive) {
        // Update cursor based on hover
        if (zoomable) {
          canvas.style.cursor = 'grab';
        } else if (isInsideViewportIndicator(minimapX, minimapY)) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'pointer';
        }
      }
    },
    [store, interactive, isInsideViewportIndicator, zoomable]
  );

  // Pointer up handler - end drag
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Always stop propagation to prevent main canvas from receiving event
      e.stopPropagation();

      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;
      dragStateRef.current = null;

      // Mark that we just finished dragging so click handler ignores next click
      if (wasDragging) {
        justFinishedDraggingRef.current = true;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Pointer capture may already be released
        }
        canvas.style.cursor = interactive ? 'pointer' : 'default';
      }

      // Prevent click from firing after drag
      if (wasDragging) {
        e.preventDefault();
      }
    },
    [interactive]
  );

  // Handle lost pointer capture - reset drag state
  const handleLostPointerCapture = useCallback(() => {
    isDraggingRef.current = false;
    dragStateRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = interactive ? 'pointer' : 'default';
    }
  }, [interactive]);

  // Initialize canvas context, get container size, and subscribe to store
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get container size BEFORE initial render (needed for viewport indicator)
    const parent = canvas.parentElement?.parentElement;
    if (parent) {
      containerSizeRef.current = {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }

    // Set up HiDPI canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale context for HiDPI
    ctx.scale(dpr, dpr);
    ctxRef.current = ctx;

    // Initial render (container size is now set)
    render();

    // Subscribe to store changes
    const unsub = store.subscribe(scheduleRender);

    return () => {
      unsub();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [store, width, height, render, scheduleRender]);

  // ResizeObserver for container size changes - avoids layout queries in render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement?.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerSizeRef.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        // Viewport indicator needs redraw when container size changes
        dirtyRef.current.viewport = true;
        scheduleRender();
      }
    });

    observer.observe(parent);

    return () => observer.disconnect();
  }, [scheduleRender]);

  const positionStyle = POSITION_STYLES[position] || POSITION_STYLES['bottom-right'];

  const containerStyle: CSSProperties = {
    position: 'absolute',
    ...positionStyle,
    width,
    height,
    borderRadius: 4,
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    pointerEvents: interactive ? 'auto' : 'none',
  };

  return (
    <div style={containerStyle} className={className}>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: 'block' }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handleLostPointerCapture}
      />
    </div>
  );
}
