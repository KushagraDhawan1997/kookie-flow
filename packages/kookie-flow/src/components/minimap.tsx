import {
  useRef,
  useCallback,
  useLayoutEffect,
  type CSSProperties,
} from 'react';
import { useFlowStoreApi } from './context';
import type { MinimapProps, Node, Viewport } from '../types';
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
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
}

/** Drag state for viewport indicator */
interface DragState {
  startMinimapX: number;
  startMinimapY: number;
  startViewportX: number;
  startViewportY: number;
}

/**
 * Calculate the transform to fit all nodes into minimap with padding.
 * Returns null if there are no nodes.
 */
function calculateMinimapTransform(
  nodes: Node[],
  minimapWidth: number,
  minimapHeight: number,
  padding: number
): MinimapTransform | null {
  if (nodes.length === 0) return null;

  // Calculate world bounds
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const node of nodes) {
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const h = node.height ?? DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const worldWidth = maxX - minX;
  const worldHeight = maxY - minY;

  // Handle degenerate cases
  if (worldWidth <= 0 || worldHeight <= 0) return null;

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
  const offsetX = padding + (availableWidth - scaledWidth) / 2 - minX * scale;
  const offsetY = padding + (availableHeight - scaledHeight) / 2 - minY * scale;

  return {
    scale,
    offsetX,
    offsetY,
    worldMinX: minX,
    worldMinY: minY,
    worldMaxX: maxX,
    worldMaxY: maxY,
  };
}

/** Convert world position to minimap position */
function worldToMinimap(
  worldX: number,
  worldY: number,
  transform: MinimapTransform
): { x: number; y: number } {
  return {
    x: worldX * transform.scale + transform.offsetX,
    y: worldY * transform.scale + transform.offsetY,
  };
}

/** Convert minimap position to world position */
function minimapToWorld(
  minimapX: number,
  minimapY: number,
  transform: MinimapTransform
): { x: number; y: number } {
  return {
    x: (minimapX - transform.offsetX) / transform.scale,
    y: (minimapY - transform.offsetY) / transform.scale,
  };
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
 * Key optimizations:
 * - Canvas 2D for efficient rendering of 10k+ rectangles
 * - RAF-throttled updates (single render per frame)
 * - Bounds caching (only recalculates when node count changes)
 * - HiDPI support for crisp rendering
 * - Ref-based updates that bypass React rendering
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

  // Cached transform (recalculated when node count changes)
  const transformRef = useRef<MinimapTransform | null>(null);
  const lastNodeCountRef = useRef<number>(0);

  // Container size (for viewport indicator)
  const containerSizeRef = useRef({ width: 0, height: 0 });

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);

  // Viewport indicator bounds (for hit testing)
  const viewportRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Get container size from parent
  const updateContainerSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement?.parentElement;
    if (parent) {
      containerSizeRef.current = {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
  }, []);

  // Main render function
  const render = useCallback(() => {
    rafIdRef.current = 0;

    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const { nodes, viewport, selectedNodeIds } = store.getState();

    // Update container size
    updateContainerSize();
    const containerWidth = containerSizeRef.current.width;
    const containerHeight = containerSizeRef.current.height;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (nodes.length === 0) {
      return;
    }

    if (zoomable) {
      // Zoomable mode: minimap mirrors main viewport zoom/pan
      // Use a base scale that makes the zoom effect clearly visible
      const baseScale = MINIMAP_DEFAULTS.zoomableBaseScale;
      const minimapScale = viewport.zoom * baseScale;

      // Calculate the center of what's visible in world space
      const invZoom = 1 / viewport.zoom;
      const worldCenterX = (-viewport.x + containerWidth / 2) * invZoom;
      const worldCenterY = (-viewport.y + containerHeight / 2) * invZoom;

      // Offset to center the view in the minimap
      const offsetX = width / 2 - worldCenterX * minimapScale;
      const offsetY = height / 2 - worldCenterY * minimapScale;

      // Draw nodes
      for (const node of nodes) {
        const w = node.width ?? DEFAULT_NODE_WIDTH;
        const h = node.height ?? DEFAULT_NODE_HEIGHT;

        const x = node.position.x * minimapScale + offsetX;
        const y = node.position.y * minimapScale + offsetY;
        const scaledW = Math.max(MINIMAP_DEFAULTS.minNodeSize, w * minimapScale);
        const scaledH = Math.max(MINIMAP_DEFAULTS.minNodeSize, h * minimapScale);

        const isSelected = selectedNodeIds.has(node.id);
        ctx.fillStyle = isSelected
          ? selectedNodeColor
          : typeof nodeColor === 'function'
          ? nodeColor(node)
          : nodeColor;
        ctx.fillRect(x, y, scaledW, scaledH);
      }

      // Draw viewport indicator as border (fixed size = minimap bounds)
      ctx.strokeStyle = viewportBorderColor;
      ctx.lineWidth = MINIMAP_DEFAULTS.viewportBorderWidth;
      ctx.strokeRect(
        MINIMAP_DEFAULTS.viewportBorderWidth / 2,
        MINIMAP_DEFAULTS.viewportBorderWidth / 2,
        width - MINIMAP_DEFAULTS.viewportBorderWidth,
        height - MINIMAP_DEFAULTS.viewportBorderWidth
      );

      // Store viewport rect as full minimap for hit testing (no draggable indicator in zoomable mode)
      viewportRectRef.current = { x: 0, y: 0, w: width, h: height };
    } else {
      // Standard mode: show all nodes, viewport indicator resizes with zoom

      // Recalculate transform if node count changed
      if (nodes.length !== lastNodeCountRef.current) {
        transformRef.current = calculateMinimapTransform(
          nodes,
          width,
          height,
          padding
        );
        lastNodeCountRef.current = nodes.length;
      }

      const transform = transformRef.current;
      if (!transform) return;

      // Draw nodes
      for (const node of nodes) {
        const w = node.width ?? DEFAULT_NODE_WIDTH;
        const h = node.height ?? DEFAULT_NODE_HEIGHT;

        const { x, y } = worldToMinimap(
          node.position.x,
          node.position.y,
          transform
        );
        const scaledW = Math.max(MINIMAP_DEFAULTS.minNodeSize, w * transform.scale);
        const scaledH = Math.max(MINIMAP_DEFAULTS.minNodeSize, h * transform.scale);

        const isSelected = selectedNodeIds.has(node.id);
        ctx.fillStyle = isSelected
          ? selectedNodeColor
          : typeof nodeColor === 'function'
          ? nodeColor(node)
          : nodeColor;
        ctx.fillRect(x, y, scaledW, scaledH);
      }

      // Draw viewport indicator
      if (containerWidth > 0 && containerHeight > 0) {
        drawViewportIndicator(
          ctx,
          viewport,
          transform,
          containerWidth,
          containerHeight,
          viewportColor,
          viewportBorderColor
        );
      }
    }
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
    updateContainerSize,
    zoomable,
  ]);

  // Draw viewport indicator rectangle
  function drawViewportIndicator(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    transform: MinimapTransform,
    containerWidth: number,
    containerHeight: number,
    fillColor: string,
    borderColor: string
  ) {
    // Calculate what's visible in world space
    const invZoom = 1 / viewport.zoom;
    const worldLeft = -viewport.x * invZoom;
    const worldTop = -viewport.y * invZoom;
    const worldRight = worldLeft + containerWidth * invZoom;
    const worldBottom = worldTop + containerHeight * invZoom;

    // Convert to minimap coordinates
    const { x: minX, y: minY } = worldToMinimap(worldLeft, worldTop, transform);
    const { x: maxX, y: maxY } = worldToMinimap(
      worldRight,
      worldBottom,
      transform
    );

    const rectWidth = maxX - minX;
    const rectHeight = maxY - minY;

    // Store for hit testing
    viewportRectRef.current = { x: minX, y: minY, w: rectWidth, h: rectHeight };

    // Draw filled rectangle
    ctx.fillStyle = fillColor;
    ctx.fillRect(minX, minY, rectWidth, rectHeight);

    // Draw border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = MINIMAP_DEFAULTS.viewportBorderWidth;
    ctx.strokeRect(minX, minY, rectWidth, rectHeight);
  }

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
      if (!interactive || isDraggingRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const minimapX = (e.clientX - rect.left) * dpr;
      const minimapY = (e.clientY - rect.top) * dpr;

      const { viewport, setViewport } = store.getState();
      const containerWidth = containerSizeRef.current.width;
      const containerHeight = containerSizeRef.current.height;

      if (zoomable) {
        // In zoomable mode, clicking pans relative to current view
        // Calculate world position from minimap click
        const baseScale = MINIMAP_DEFAULTS.zoomableBaseScale;
        const minimapScale = viewport.zoom * baseScale;
        const invZoom = 1 / viewport.zoom;

        // Current world center
        const worldCenterX = (-viewport.x + containerWidth / 2) * invZoom;
        const worldCenterY = (-viewport.y + containerHeight / 2) * invZoom;

        // Offset used in rendering
        const offsetX = width / 2 - worldCenterX * minimapScale;
        const offsetY = height / 2 - worldCenterY * minimapScale;

        // Convert click to world coords
        const worldX = (minimapX - offsetX) / minimapScale;
        const worldY = (minimapY - offsetY) / minimapScale;

        const newX = containerWidth / 2 - worldX * viewport.zoom;
        const newY = containerHeight / 2 - worldY * viewport.zoom;

        setViewport({ x: newX, y: newY, zoom: viewport.zoom });
      } else {
        // Standard mode
        const transform = transformRef.current;
        if (!transform) return;

        // Don't pan if clicking on viewport indicator
        if (isInsideViewportIndicator(minimapX, minimapY)) return;

        // Convert to world coordinates
        const worldPos = minimapToWorld(minimapX, minimapY, transform);

        const newX = containerWidth / 2 - worldPos.x * viewport.zoom;
        const newY = containerHeight / 2 - worldPos.y * viewport.zoom;

        setViewport({ x: newX, y: newY, zoom: viewport.zoom });
      }
    },
    [store, interactive, isInsideViewportIndicator, zoomable, width, height]
  );

  // Pointer down handler - start drag if on viewport indicator (or anywhere in zoomable mode)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactive) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const minimapX = (e.clientX - rect.left) * dpr;
      const minimapY = (e.clientY - rect.top) * dpr;

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
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const minimapX = (e.clientX - rect.left) * dpr;
      const minimapY = (e.clientY - rect.top) * dpr;

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
          const transform = transformRef.current;
          if (!transform) return;

          const deltaWorldX = deltaMinimapX / transform.scale;
          const deltaWorldY = deltaMinimapY / transform.scale;

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
      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;
      dragStateRef.current = null;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = interactive ? 'pointer' : 'default';
      }

      // Prevent click from firing after drag
      if (wasDragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [interactive]
  );

  // Initialize canvas context and subscribe to store
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set up HiDPI canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale context for HiDPI
    ctx.scale(dpr, dpr);
    ctxRef.current = ctx;

    // Initial render
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

  // Update canvas size when dimensions change
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
      render();
    }
  }, [width, height, render]);

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
      />
    </div>
  );
}
