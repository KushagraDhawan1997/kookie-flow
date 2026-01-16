import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFlowStore } from './context';
import { EDGE_COLORS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';
import type { Node, Edge } from '../types';

interface EdgeGeometryData {
  positions: number[];
  colors: number[];
}

/**
 * Renders all edges as line segments.
 * For now, straight lines. Bezier curves will come later.
 */
export function Edges() {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const lineRef = useRef<THREE.LineSegments>(null);

  // Build node lookup map
  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  // Generate line geometry from edges
  const geometryData = useMemo((): EdgeGeometryData => {
    const positions: number[] = [];
    const colors: number[] = [];

    const defaultColor = new THREE.Color(EDGE_COLORS.default);
    const selectedColor = new THREE.Color(EDGE_COLORS.selected);

    edges.forEach((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) return;

      const sourceWidth = sourceNode.width ?? DEFAULT_NODE_WIDTH;
      const sourceHeight = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
      const targetWidth = targetNode.width ?? DEFAULT_NODE_WIDTH;
      const targetHeight = targetNode.height ?? DEFAULT_NODE_HEIGHT;

      // Output is on right side of source node
      const sourceX = sourceNode.position.x + sourceWidth;
      const sourceY = -(sourceNode.position.y + sourceHeight / 2);

      // Input is on left side of target node
      const targetX = targetNode.position.x;
      const targetY = -(targetNode.position.y + targetHeight / 2);

      // Add line segment
      positions.push(sourceX, sourceY, 0);
      positions.push(targetX, targetY, 0);

      // Color
      const color = edge.selected ? selectedColor : defaultColor;
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
    });

    return { positions, colors };
  }, [edges, nodeMap]);

  // Update geometry
  useEffect(() => {
    if (!lineRef.current) return;

    const geometry = lineRef.current.geometry;
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(geometryData.positions, 3)
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(geometryData.colors, 3)
    );
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }, [geometryData]);

  if (edges.length === 0) return null;

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry />
      <lineBasicMaterial vertexColors transparent opacity={0.8} linewidth={2} />
    </lineSegments>
  );
}
