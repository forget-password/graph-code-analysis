import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useNodeId,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from '@xyflow/react';
import dagre from 'dagre';
import ELK from 'elkjs/lib/elk.bundled.js';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import './graph-app.css';

const elk = new ELK();

const DEFAULT_DIRECTION = 'TB';
const PREVIEW_LIMIT = 5;
const COMPACT_PREVIEW_LIMIT = 4;
const EXPANDED_PREVIEW_LIMIT = 12;
const COMPACT_EXPANDED_PREVIEW_LIMIT = 9;
const COMPACT_NODE_COUNT = 90;
const COMPACT_EDGE_COUNT = 180;
const VIEWPORT_MOVING_DEBOUNCE_MS = 120;
const LOW_DETAIL_ZOOM_THRESHOLD = 0.18;

const EDGE_COLORS = {
  import: '#4aa3ff',
  export: '#52c17d',
  extends: '#f0b429',
  implements: '#ff8f5a',
  uses: '#8d7bff',
  calls: '#ff6b8a',
};

const vscode = typeof acquireVsCodeApi === 'function'
  ? acquireVsCodeApi()
  : { postMessage() {} };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAlgorithm(algorithm) {
  return algorithm === 'dagre' ? 'dagre' : 'elk';
}

function normalizeDirection(direction) {
  if (direction === 'BT' || direction === 'LR' || direction === 'RL') {
    return direction;
  }

  return DEFAULT_DIRECTION;
}

function getHandlePositions(direction) {
  switch (direction) {
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    default:
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  }
}

function getElkDirection(direction) {
  switch (direction) {
    case 'BT':
      return 'UP';
    case 'LR':
      return 'RIGHT';
    case 'RL':
      return 'LEFT';
    default:
      return 'DOWN';
  }
}

function getNodeDimensions(node, compact) {
  const elementCount = node.elements?.length ?? 0;
  const collapsedLimit = compact ? COMPACT_PREVIEW_LIMIT : PREVIEW_LIMIT;
  const expandedLimit = compact ? COMPACT_EXPANDED_PREVIEW_LIMIT : EXPANDED_PREVIEW_LIMIT;
  const collapsedCount = Math.max(1, Math.min(elementCount, collapsedLimit));
  const expandedCount = Math.max(1, Math.min(elementCount, expandedLimit));
  const headerHeight = compact ? 80 : 88;
  const rowHeight = compact ? 34 : 38;
  const footerHeight = elementCount > collapsedLimit ? 34 : 0;
  const collapsedHeight = headerHeight + (collapsedCount * rowHeight) + footerHeight + 16;
  const expandedHeight = headerHeight + (expandedCount * rowHeight) + footerHeight + 16;

  return {
    width: compact ? 280 : 320,
    minimalHeight: compact ? 92 : 104,
    collapsedHeight: Math.min(collapsedHeight, compact ? 268 : 330),
    expandedHeight: Math.min(expandedHeight, compact ? 420 : 590),
    canExpand: elementCount > collapsedLimit,
  };
}

function getRangeStart(range) {
  if (!range) {
    return { line: 0, character: 0 };
  }

  if (Array.isArray(range) && range.length > 0) {
    return {
      line: range[0]?.line ?? 0,
      character: range[0]?.character ?? 0,
    };
  }

  if (range.start) {
    return {
      line: range.start.line ?? 0,
      character: range.start.character ?? 0,
    };
  }

  return { line: 0, character: 0 };
}

function buildFlowNodes(graphData, direction) {
  const compact = graphData.nodes.length >= COMPACT_NODE_COUNT
    || graphData.edges.length >= COMPACT_EDGE_COUNT;
  const { sourcePosition, targetPosition } = getHandlePositions(direction);

  return graphData.nodes.map((node) => {
    const dimensions = getNodeDimensions(node, compact);

    return {
      id: node.id,
      type: 'fileNode',
      position: node.position ?? { x: 0, y: 0 },
      draggable: true,
      sourcePosition,
      targetPosition,
      style: {
        width: dimensions.width,
        height: dimensions.collapsedHeight,
      },
      data: {
        nodeId: node.id,
        label: node.label,
        filePath: node.filePath,
        elements: node.elements ?? [],
        elementCount: node.elements?.length ?? 0,
        minimalHeight: dimensions.minimalHeight,
        collapsedHeight: dimensions.collapsedHeight,
        expandedHeight: dimensions.expandedHeight,
        canExpand: dimensions.canExpand,
        sourcePosition,
        targetPosition,
        expanded: false,
        isDimmed: false,
      },
    };
  });
}

function buildEdgeMetadata(graphData) {
  return graphData.edges.map((edge) => {
    const color = EDGE_COLORS[edge.type] ?? '#8a8f98';

    return {
      id: edge.id,
      source: edge.source.nodeId,
      target: edge.target.nodeId,
      type: edge.type,
      color,
      baseOpacity: 0.78,
      strokeWidth: 1.7,
    };
  });
}

function getMatchedNodeIds(graphData, searchTerm) {
  const normalized = searchTerm.trim().toLowerCase();
  if (!normalized || !graphData) {
    return null;
  }

  return new Set(
    graphData.nodes
      .filter((node) => {
        const inFile = node.label.toLowerCase().includes(normalized)
          || node.filePath.toLowerCase().includes(normalized);
        const inElements = (node.elements ?? []).some((element) => (
          element.name.toLowerCase().includes(normalized)
          || element.kind.toLowerCase().includes(normalized)
        ));

        return inFile || inElements;
      })
      .map((node) => node.id)
  );
}

function decorateNodes(nodes, matchedIds, expandedNodeIds, onToggleExpand, lowDetailMode, viewportMoving) {
  const hasSearch = matchedIds !== null;

  return nodes.map((node) => {
    const isMatched = !hasSearch || matchedIds.has(node.id);
    const expanded = expandedNodeIds.has(node.id);

    return {
      ...node,
      style: {
        ...node.style,
        height: lowDetailMode
          ? node.data.minimalHeight
          : (expanded ? node.data.expandedHeight : node.data.collapsedHeight),
        opacity: isMatched ? 1 : 0.3,
      },
      data: {
        ...node.data,
        expanded,
        isDimmed: !isMatched,
        lowDetailMode,
        viewportMoving,
        onToggleExpand,
      },
    };
  });
}

function applyDagreLayout(nodes, edges, direction) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 70,
    ranksep: 120,
    marginx: 60,
    marginy: 60,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: Number(node.style?.width ?? 0),
      height: Number(node.style?.height ?? 0),
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const layoutNode = graph.node(node.id);
      const width = Number(node.style?.width ?? 0);
      const height = Number(node.style?.height ?? 0);

      return {
        ...node,
        position: {
          x: (layoutNode?.x ?? 0) - (width / 2),
          y: (layoutNode?.y ?? 0) - (height / 2),
        },
      };
    }),
    edges,
  };
}

async function applyElkLayout(nodes, edges, direction) {
  const layout = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': getElkDirection(direction),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': '70',
      'elk.spacing.edgeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '130',
      'elk.padding': '[top=60,left=60,bottom=60,right=60]',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: Number(node.style?.width ?? 0),
      height: Number(node.style?.height ?? 0),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positions = new Map(
    (layout.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ])
  );

  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges,
  };
}

async function layoutGraph(graphData, algorithm) {
  const direction = normalizeDirection(graphData.layout?.direction);
  const nodes = buildFlowNodes(graphData, direction);
  const edges = buildEdgeMetadata(graphData);

  if (algorithm === 'dagre') {
    return applyDagreLayout(nodes, edges, direction);
  }

  return applyElkLayout(nodes, edges, direction);
}

function hexToRgba(hex, alpha = 1) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  const parsed = Number.parseInt(value, 16);

  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
    alpha,
  ];
}

function rgbaToCss(color) {
  const r = Math.round((color[0] ?? 0) * 255);
  const g = Math.round((color[1] ?? 0) * 255);
  const b = Math.round((color[2] ?? 0) * 255);
  const a = color[3] ?? 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function toWorldNode(node) {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: Number(node.style?.width ?? 0),
    height: Number(node.style?.height ?? 0),
    sourcePosition: node.sourcePosition,
    targetPosition: node.targetPosition,
  };
}

function getAnchorPoint(node, position) {
  const centerX = node.x + (node.width / 2);
  const centerY = node.y + (node.height / 2);

  switch (position) {
    case Position.Top:
      return { x: centerX, y: node.y };
    case Position.Right:
      return { x: node.x + node.width, y: centerY };
    case Position.Left:
      return { x: node.x, y: centerY };
    default:
      return { x: centerX, y: node.y + node.height };
  }
}

function dedupePolyline(points) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return Math.abs(previous.x - point.x) > 0.1 || Math.abs(previous.y - point.y) > 0.1;
  });
}

function computeWorldBounds(nodes) {
  if (!nodes.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    const width = Number(node.style?.width ?? 0);
    const height = Number(node.style?.height ?? 0);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  });

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function buildOrthogonalRoute(sourceNode, targetNode) {
  const source = getAnchorPoint(sourceNode, sourceNode.sourcePosition);
  const target = getAnchorPoint(targetNode, targetNode.targetPosition);
  const sourceHorizontal = sourceNode.sourcePosition === Position.Left || sourceNode.sourcePosition === Position.Right;

  if (sourceHorizontal) {
    const midX = (source.x + target.x) / 2;
    return dedupePolyline([
      source,
      { x: midX, y: source.y },
      { x: midX, y: target.y },
      target,
    ]);
  }

  const midY = (source.y + target.y) / 2;
  return dedupePolyline([
    source,
    { x: source.x, y: midY },
    { x: target.x, y: midY },
    target,
  ]);
}

function buildEdgeScene(nodes, edges, matchedNodeIds) {
  const nodeMap = new Map(nodes.map((node) => [node.id, toWorldNode(node)]));
  const hasSearch = matchedNodeIds !== null;
  const segments = [];
  const arrows = [];

  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode || !targetNode) {
      return;
    }

    const dimmed = hasSearch && !(matchedNodeIds.has(edge.source) && matchedNodeIds.has(edge.target));
    const opacity = dimmed ? 0.1 : edge.baseOpacity;
    const color = hexToRgba(edge.color, opacity);
    const route = buildOrthogonalRoute(sourceNode, targetNode);

    for (let index = 1; index < route.length; index += 1) {
      const previous = route[index - 1];
      const current = route[index];
      segments.push({
        x1: previous.x,
        y1: previous.y,
        x2: current.x,
        y2: current.y,
        color,
        thickness: dimmed ? 1.1 : edge.strokeWidth,
      });
    }

    if (route.length >= 2) {
      arrows.push({
        start: route[route.length - 2],
        end: route[route.length - 1],
        color,
      });
    }
  });

  return { segments, arrows };
}

function buildEdgeInstanceData(segments) {
  const data = new Float32Array(segments.length * 12);

  segments.forEach((segment, index) => {
    const offset = index * 12;
    data[offset + 0] = segment.x1;
    data[offset + 1] = segment.y1;
    data[offset + 2] = segment.x2;
    data[offset + 3] = segment.y2;
    data[offset + 4] = segment.color[0];
    data[offset + 5] = segment.color[1];
    data[offset + 6] = segment.color[2];
    data[offset + 7] = segment.color[3];
    data[offset + 8] = segment.thickness;
    data[offset + 9] = 0;
    data[offset + 10] = 0;
    data[offset + 11] = 0;
  });

  return data;
}

function worldToScreen(point, viewport) {
  return {
    x: (point.x * viewport.zoom) + viewport.x,
    y: (point.y * viewport.zoom) + viewport.y,
  };
}

function getViewportBitmapTransform(renderedViewport, nextViewport) {
  const scale = nextViewport.zoom / renderedViewport.zoom;

  return {
    scale,
    x: nextViewport.x - (renderedViewport.x * scale),
    y: nextViewport.y - (renderedViewport.y * scale),
  };
}

function drawArrowOverlay(context, overlayScene, viewport, size, dpr, interacting) {
  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);

  if (interacting) {
    context.restore();
    return;
  }

  context.lineCap = 'round';
  context.lineJoin = 'round';

  overlayScene.arrows.forEach((arrow) => {
    const start = worldToScreen(arrow.start, viewport);
    const end = worldToScreen(arrow.end, viewport);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length < 1) {
      return;
    }

    const ux = dx / length;
    const uy = dy / length;
    const sizePx = clamp(7 + (viewport.zoom * 1.6), 7, 12);
    const backX = end.x - (ux * sizePx);
    const backY = end.y - (uy * sizePx);
    const nx = -uy;
    const ny = ux;

    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(backX + (nx * sizePx * 0.55), backY + (ny * sizePx * 0.55));
    context.lineTo(backX - (nx * sizePx * 0.55), backY - (ny * sizePx * 0.55));
    context.closePath();
    context.fillStyle = rgbaToCss(arrow.color);
    context.fill();
  });

  context.restore();
}

function createCanvas2dEdgeRenderer(canvas) {
  const context = canvas.getContext('2d');
  let segments = [];

  return {
    mode: 'canvas2d',
    resize() {},
    updateScene(nextScene) {
      segments = nextScene.segments;
    },
    render({ viewport, size, dpr }) {
      if (!context) {
        return;
      }

      context.save();
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.lineCap = 'round';

      segments.forEach((segment) => {
        const start = worldToScreen({ x: segment.x1, y: segment.y1 }, viewport);
        const end = worldToScreen({ x: segment.x2, y: segment.y2 }, viewport);
        context.beginPath();
        context.strokeStyle = rgbaToCss(segment.color);
        context.lineWidth = Math.max(1, segment.thickness * viewport.zoom);
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      });

      context.restore();
    },
    destroy() {},
  };
}

async function createWebGpuEdgeRenderer(canvas) {
  if (!navigator.gpu) {
    return null;
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return null;
  }

  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: uniformBuffer },
    }],
  });

  const shader = device.createShaderModule({
    code: `
struct ViewUniforms {
  data0: vec4f,
  data1: vec4f,
}

@group(0) @binding(0)
var<uniform> view: ViewUniforms;

struct VertexInput {
  @location(0) local: vec2f,
  @location(1) start: vec2f,
  @location(2) end: vec2f,
  @location(3) color: vec4f,
  @location(4) metrics: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

fn world_to_clip(world: vec2f) -> vec4f {
  let screen = (world * view.data1.x) + view.data0.xy;
  let clip = vec2f(
    (screen.x / view.data0.z) * 2.0 - 1.0,
    1.0 - (screen.y / view.data0.w) * 2.0
  );

  return vec4f(clip, 0.0, 1.0);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let direction = input.end - input.start;
  let length_value = max(length(direction), 0.0001);
  let tangent = direction / length_value;
  let normal = vec2f(-tangent.y, tangent.x);
  let half_thickness = max(input.metrics.x * 0.5, 0.75 / max(view.data1.x, 0.0001));
  let world = input.start + (tangent * (input.local.x * length_value)) + (normal * input.local.y * half_thickness);

  output.position = world_to_clip(world);
  output.color = input.color;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  return input.color;
}
`,
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shader,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'float32x2',
          }],
        },
        {
          arrayStride: 48,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' },
            { shaderLocation: 2, offset: 8, format: 'float32x2' },
            { shaderLocation: 3, offset: 16, format: 'float32x4' },
            { shaderLocation: 4, offset: 32, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module: shader,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const quad = new Float32Array([
    0, -1,
    1, -1,
    1, 1,
    0, -1,
    1, 1,
    0, 1,
  ]);

  const vertexBuffer = device.createBuffer({
    size: quad.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, quad);

  let instanceBuffer = null;
  let capacity = 0;
  let count = 0;

  function ensureBuffer(requiredSize) {
    if (instanceBuffer && capacity >= requiredSize) {
      return;
    }

    instanceBuffer?.destroy();
    capacity = alignTo(Math.max(requiredSize, capacity * 2 || 1024), 4);
    instanceBuffer = device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return {
    mode: 'webgpu',
    resize() {
      context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
      });
    },
    updateScene(nextScene) {
      const data = buildEdgeInstanceData(nextScene.segments);
      ensureBuffer(data.byteLength || 4);
      count = nextScene.segments.length;

      if (data.byteLength > 0) {
        device.queue.writeBuffer(instanceBuffer, 0, data);
      }
    },
    render({ viewport, size }) {
      device.queue.writeBuffer(
        uniformBuffer,
        0,
        new Float32Array([
          viewport.x,
          viewport.y,
          size.width,
          size.height,
          viewport.zoom,
          0,
          0,
          0,
        ])
      );

      const encoder = device.createCommandEncoder();
      const view = context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      if (count > 0 && instanceBuffer) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setVertexBuffer(1, instanceBuffer);
        pass.draw(6, count);
      }

      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      vertexBuffer.destroy();
      uniformBuffer.destroy();
      instanceBuffer?.destroy();
    },
  };
}

function downloadDataUrl(filename, dataUrl) {
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = dataUrl;
  anchor.click();
}

function fileNodePropsAreEqual(prev, next) {
  const prevData = prev.data;
  const nextData = next.data;

  return (
    prev.selected === next.selected
    && prevData.nodeId === nextData.nodeId
    && prevData.expanded === nextData.expanded
    && prevData.isDimmed === nextData.isDimmed
    && prevData.lowDetailMode === nextData.lowDetailMode
    && prevData.viewportMoving === nextData.viewportMoving
    && prevData.elementCount === nextData.elementCount
    && prevData.sourcePosition === nextData.sourcePosition
    && prevData.targetPosition === nextData.targetPosition
    && prevData.label === nextData.label
    && prevData.canExpand === nextData.canExpand
  );
}

const FileNode = memo(function FileNode({ data, selected }) {
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (nodeId) {
      updateNodeInternals(nodeId);
    }
  }, [data.expanded, data.lowDetailMode, nodeId, updateNodeInternals]);

  const visibleElements = useMemo(() => {
    if (data.lowDetailMode || data.viewportMoving) {
      return [];
    }

    const limit = data.expanded ? EXPANDED_PREVIEW_LIMIT : PREVIEW_LIMIT;
    return data.elements.slice(0, limit);
  }, [data.elements, data.expanded, data.lowDetailMode, data.viewportMoving]);

  return (
    <div className={`file-node ${data.lowDetailMode ? 'file-node--minimal' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={data.targetPosition} className="file-node__handle" />
      {data.viewportMoving ? (
        <div className="file-node__placeholder" aria-hidden="true">
          <div className="file-node__placeholder-header">
            <span className="file-node__placeholder-chip" />
            <span className="file-node__placeholder-badge" />
          </div>
          <div className="file-node__placeholder-line file-node__placeholder-line--primary" />
          <div className="file-node__placeholder-line" />
          <div className="file-node__placeholder-line file-node__placeholder-line--short" />
        </div>
      ) : (
        <>
          <button
            type="button"
            className="file-node__header nopan"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="file-node__title">
              <span>file</span>
              <strong title={data.label}>{data.label}</strong>
            </div>
            <div className="file-node__badge">{data.elementCount}</div>
          </button>
          {data.lowDetailMode ? (
            <div className="file-node__hint">Zoom in to inspect symbols</div>
          ) : (
            <>
              <div className="file-node__path" title={data.filePath}>{data.filePath}</div>
              <div
                className="file-node__symbols nowheel nopan"
                onWheel={(event) => {
                  event.stopPropagation();
                }}
              >
                {visibleElements.length > 0 ? visibleElements.map((element) => {
                  const start = getRangeStart(element.range);
                  return (
                    <button
                      key={element.id}
                      type="button"
                      className="file-node__symbol nodrag nopan"
                      onClick={(event) => {
                        event.stopPropagation();
                        vscode.postMessage({
                          type: 'elementClicked',
                          data: {
                            filePath: element.filePath,
                            line: start.line,
                            character: start.character,
                          },
                        });
                      }}
                    >
                      <span className="file-node__symbol-name" title={element.name}>{element.name}</span>
                      <span className="file-node__symbol-kind">{element.kind}</span>
                    </button>
                  );
                }) : (
                  <div className="file-node__empty">No symbols detected</div>
                )}
              </div>
              {data.canExpand ? (
                <button
                  type="button"
                  className="file-node__toggle nodrag nopan"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onToggleExpand?.(data.nodeId);
                  }}
                >
                  <span>{data.expanded ? '⌃' : '⌄'}</span>
                  <span>{data.expanded ? 'Collapse' : 'Show All'}</span>
                </button>
              ) : null}
            </>
          )}
        </>
      )}
      <Handle type="source" position={data.sourcePosition} className="file-node__handle" />
    </div>
  );
}, fileNodePropsAreEqual);

const nodeTypes = {
  fileNode: FileNode,
};

function GraphCanvas() {
  const [graphData, setGraphData] = useState(null);
  const [baseGraph, setBaseGraph] = useState({ nodes: [], edges: [] });
  const [expandedNodeIds, setExpandedNodeIds] = useState(() => new Set());
  const [layoutEngine, setLayoutEngine] = useState('elk');
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLayouting, setIsLayouting] = useState(false);
  const [isViewportMoving, setIsViewportMoving] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [lowDetailMode, setLowDetailMode] = useState(false);
  const [rendererMode, setRendererMode] = useState('INIT');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const { fitView, getViewport, setViewport } = useReactFlow();

  const flowShellRef = useRef(null);
  const edgeCanvasRef = useRef(null);
  const arrowCanvasRef = useRef(null);
  const rendererRef = useRef(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const renderedViewportRef = useRef(null);
  const sceneRef = useRef({ segments: [], arrows: [] });
  const frameRef = useRef(0);
  const transformFrameRef = useRef(0);
  const pendingViewportRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const zoomLevelRef = useRef(100);
  const lowDetailModeRef = useRef(false);
  const viewportMovingRef = useRef(false);
  const viewportZoomRef = useRef(1);
  const movingTimerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const lastEdgeRebuildRef = useRef(0);

  const matchedNodeIds = useMemo(
    () => getMatchedNodeIds(graphData, searchTerm),
    [graphData, searchTerm]
  );

  const resetCanvasTransform = useCallback(() => {
    [edgeCanvasRef.current, arrowCanvasRef.current].forEach((canvas) => {
      if (!canvas) {
        return;
      }

      canvas.style.transform = 'translate(0px, 0px) scale(1)';
      canvas.style.opacity = '1';
    });
  }, []);

  const applyViewportTransform = useCallback((viewport) => {
    pendingViewportRef.current = viewport;

    if (transformFrameRef.current) {
      return;
    }

    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = 0;

      const nextViewport = pendingViewportRef.current;
      if (!nextViewport) {
        return;
      }

      const renderedViewport = renderedViewportRef.current;
      const edgeCanvas = edgeCanvasRef.current;
      const arrowCanvas = arrowCanvasRef.current;

      if (!renderedViewport || !edgeCanvas || !arrowCanvas) {
        return;
      }

      const bitmapTransform = getViewportBitmapTransform(renderedViewport, nextViewport);
      const transform = `translate(${bitmapTransform.x}px, ${bitmapTransform.y}px) scale(${bitmapTransform.scale})`;

      edgeCanvas.style.transform = transform;
      arrowCanvas.style.transform = transform;
      arrowCanvas.style.opacity = '0';
    });
  }, []);

  const scheduleRender = useCallback(() => {
    if (frameRef.current) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;

      const renderer = rendererRef.current;
      const arrowCanvas = arrowCanvasRef.current;
      const arrowContext = arrowCanvas?.getContext('2d');

      if (!renderer || !arrowContext || sizeRef.current.width === 0 || sizeRef.current.height === 0) {
        return;
      }

      renderer.render({
        viewport: viewportRef.current,
        size: sizeRef.current,
        dpr: sizeRef.current.dpr,
      });

      drawArrowOverlay(
        arrowContext,
        sceneRef.current,
        viewportRef.current,
        sizeRef.current,
        sizeRef.current.dpr,
        viewportMovingRef.current
      );

      renderedViewportRef.current = { ...viewportRef.current };
      resetCanvasTransform();
    });
  }, [resetCanvasTransform]);

  const syncViewportMode = useCallback((viewport) => {
    const nextLowDetailMode = viewport.zoom <= LOW_DETAIL_ZOOM_THRESHOLD;
    if (nextLowDetailMode !== lowDetailModeRef.current) {
      lowDetailModeRef.current = nextLowDetailMode;
      startTransition(() => {
        setLowDetailMode(nextLowDetailMode);
      });
    }
  }, []);

  const syncZoomLevel = useCallback((viewport) => {
    const nextZoomLevel = Math.round(viewport.zoom * 100);
    if (nextZoomLevel !== zoomLevelRef.current) {
      zoomLevelRef.current = nextZoomLevel;
      setZoomLevel(nextZoomLevel);
    }
  }, []);

  const setViewportMovingState = useCallback((nextIsMoving) => {
    if (nextIsMoving) {
      if (movingTimerRef.current) {
        clearTimeout(movingTimerRef.current);
        movingTimerRef.current = null;
      }

      if (!viewportMovingRef.current) {
        viewportMovingRef.current = true;
        startTransition(() => {
          setIsViewportMoving(true);
        });
      }
    } else {
      if (movingTimerRef.current) {
        clearTimeout(movingTimerRef.current);
      }

      movingTimerRef.current = setTimeout(() => {
        movingTimerRef.current = null;
        viewportMovingRef.current = false;
        startTransition(() => {
          setIsViewportMoving(false);
        });
      }, VIEWPORT_MOVING_DEBOUNCE_MS);
    }
  }, []);

  const updateEdgeScene = useCallback((nextNodes, nextEdges, nextMatchedIds) => {
    const scene = buildEdgeScene(nextNodes, nextEdges, nextMatchedIds);
    sceneRef.current = scene;
    rendererRef.current?.updateScene(scene);
    scheduleRender();
  }, [scheduleRender]);

  useEffect(() => {
    const handleMessage = (event) => {
      const message = event.data;
      if (message?.type !== 'updateGraph') {
        return;
      }

      setGraphData(message.data);
      setExpandedNodeIds(new Set());
      setLayoutEngine(normalizeAlgorithm(message.data?.layout?.algorithm));
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeRenderer = async () => {
      if (!edgeCanvasRef.current) {
        return;
      }

      try {
        const renderer = await createWebGpuEdgeRenderer(edgeCanvasRef.current);
        if (cancelled) {
          renderer?.destroy();
          return;
        }

        rendererRef.current = renderer ?? createCanvas2dEdgeRenderer(edgeCanvasRef.current);
        setRendererMode(renderer ? 'WEBGPU' : 'CANVAS');
        rendererRef.current.updateScene(sceneRef.current);
        scheduleRender();
      } catch (error) {
        if (cancelled) {
          return;
        }

        rendererRef.current = createCanvas2dEdgeRenderer(edgeCanvasRef.current);
        setRendererMode('CANVAS');
        rendererRef.current.updateScene(sceneRef.current);
        scheduleRender();
      }
    };

    initializeRenderer();

    return () => {
      cancelled = true;
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      if (transformFrameRef.current) {
        window.cancelAnimationFrame(transformFrameRef.current);
        transformFrameRef.current = 0;
      }
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [scheduleRender]);

  useEffect(() => {
    if (!flowShellRef.current || !edgeCanvasRef.current || !arrowCanvasRef.current) {
      return undefined;
    }

    const updateSize = () => {
      if (!flowShellRef.current || !edgeCanvasRef.current || !arrowCanvasRef.current) {
        return;
      }

      const rect = flowShellRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextSize = {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        dpr,
      };

      sizeRef.current = nextSize;

      [edgeCanvasRef.current, arrowCanvasRef.current].forEach((canvas) => {
        canvas.width = Math.max(1, Math.round(nextSize.width * dpr));
        canvas.height = Math.max(1, Math.round(nextSize.height * dpr));
        canvas.style.width = `${nextSize.width}px`;
        canvas.style.height = `${nextSize.height}px`;
      });

      rendererRef.current?.resize(nextSize);
      scheduleRender();
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(flowShellRef.current);

    return () => {
      observer.disconnect();
    };
  }, [scheduleRender]);

  useEffect(() => {
    if (!graphData?.nodes?.length) {
      setBaseGraph({ nodes: [], edges: [] });
      setNodes([]);
      updateEdgeScene([], [], matchedNodeIds);
      setIsLayouting(false);
      return;
    }

    let cancelled = false;

    const runLayout = async () => {
      setIsLayouting(true);

      try {
        const result = await layoutGraph(graphData, layoutEngine);
        if (cancelled) {
          return;
        }

        setBaseGraph(result);
        setNodes(result.nodes);
        updateEdgeScene(result.nodes, result.edges, matchedNodeIds);

        window.requestAnimationFrame(async () => {
          await fitView({ padding: 0.18, duration: 320 });
          const viewport = getViewport();
          viewportRef.current = viewport;
          syncViewportMode(viewport);
          syncZoomLevel(viewport);
          scheduleRender();
        });
      } catch (error) {
        console.error('[GraphCanvas] Failed to layout graph', error);
      } finally {
        if (!cancelled) {
          setIsLayouting(false);
        }
      }
    };

    runLayout();

    return () => {
      cancelled = true;
    };
  }, [fitView, getViewport, graphData, layoutEngine, layoutNonce, matchedNodeIds, scheduleRender, setNodes, syncViewportMode, syncZoomLevel, updateEdgeScene]);

  const handleToggleExpand = useCallback((nodeId) => {
    setExpandedNodeIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(nodeId)) {
        nextIds.delete(nodeId);
      } else {
        nextIds.add(nodeId);
      }

      return nextIds;
    });
  }, []);

  useEffect(() => {
    if (baseGraph.nodes.length === 0) {
      return;
    }

    setNodes((currentNodes) => {
      const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
      const nextNodes = decorateNodes(
        baseGraph.nodes.map((node) => ({
          ...node,
          position: nodesById.get(node.id)?.position ?? node.position,
        })),
        matchedNodeIds,
        expandedNodeIds,
        handleToggleExpand,
        lowDetailMode,
        isViewportMoving
      );

      updateEdgeScene(nextNodes, baseGraph.edges, matchedNodeIds);
      return nextNodes;
    });
  }, [baseGraph, expandedNodeIds, handleToggleExpand, isViewportMoving, lowDetailMode, matchedNodeIds, setNodes, updateEdgeScene]);

  // Edge scene is rebuilt by the decoration effect above and by handleNodesChange during drag.
  // No separate nodes-change effect needed — it caused double rebuilds on every drag frame.

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);

    const hasDrag = changes.some((change) => change.type === 'position' && change.dragging);
    const dragEnded = changes.some((change) => change.type === 'position' && !change.dragging && change.position);

    if (hasDrag) {
      isDraggingRef.current = true;
    }

    if (dragEnded) {
      isDraggingRef.current = false;
    }

    if (hasDrag || dragEnded) {
      const now = performance.now();
      const elapsed = now - lastEdgeRebuildRef.current;

      if (dragEnded || elapsed > 32) {
        lastEdgeRebuildRef.current = now;
        window.requestAnimationFrame(() => {
          setNodes((currentNodes) => {
            updateEdgeScene(currentNodes, baseGraph.edges, matchedNodeIds);
            return currentNodes;
          });
        });

        return;
      }
    }

    window.requestAnimationFrame(() => {
      scheduleRender();
    });
  }, [baseGraph.edges, matchedNodeIds, onNodesChange, scheduleRender, setNodes, updateEdgeScene]);

  const handleExport = async () => {
    const viewport = flowShellRef.current;
    if (!viewport || nodes.length === 0) {
      return;
    }

    const bounds = getNodesBounds(nodes);
    const width = Math.max(Math.round(bounds.width + 220), 1280);
    const height = Math.max(Math.round(bounds.height + 220), 720);
    const transform = getViewportForBounds(bounds, width, height, 0.1, 2, 0.16);
    const backgroundColor = getComputedStyle(document.body).backgroundColor;

    const dataUrl = await toPng(viewport, {
      backgroundColor,
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
      },
    });

    downloadDataUrl('code-analysis-graph.png', dataUrl);
  };

  const handleResetViewport = () => {
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 });
    const viewport = { x: 0, y: 0, zoom: 1 };
    viewportRef.current = viewport;
    syncViewportMode(viewport);
    syncZoomLevel(viewport);
    scheduleRender();
  };

  const totalNodes = graphData?.nodes?.length ?? 0;
  const matchedCount = matchedNodeIds ? matchedNodeIds.size : totalNodes;

  return (
    <div className={`graph-app ${lowDetailMode ? 'graph-app--overview' : ''} ${isViewportMoving ? 'graph-app--moving' : ''}`}>
      <div className="graph-toolbar">
        <div className="graph-toolbar__group">
          <select
            className="graph-select"
            value={layoutEngine}
            onChange={(event) => {
              setLayoutEngine(event.target.value);
            }}
          >
            <option value="elk">ELK layered</option>
            <option value="dagre">Dagre</option>
          </select>
          <button type="button" className="graph-button" onClick={() => setLayoutNonce((value) => value + 1)}>
            Relayout
          </button>
        </div>
        <div className="graph-toolbar__divider" />
        <div className="graph-toolbar__group">
          <button type="button" className="graph-button graph-button--secondary" onClick={handleResetViewport}>
            Reset
          </button>
          <button type="button" className="graph-button graph-button--secondary" onClick={handleExport}>
            Export PNG
          </button>
        </div>
      </div>

      <div className="graph-search">
        <span className="graph-search__label">Search</span>
        <input
          className="graph-search__input"
          type="text"
          value={searchTerm}
          placeholder="Filter files or symbols"
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <span className="graph-search__summary">{matchedCount}/{totalNodes}</span>
      </div>

      <div className="graph-stats">
        <div className="graph-stat"><span>Nodes</span><strong>{graphData?.nodes?.length ?? 0}</strong></div>
        <div className="graph-stat"><span>Edges</span><strong>{graphData?.edges?.length ?? 0}</strong></div>
        <div className="graph-stat"><span>Zoom</span><strong>{zoomLevel}%</strong></div>
        <div className="graph-stat"><span>Renderer</span><strong>{rendererMode}</strong></div>
      </div>

      {isLayouting ? (
        <div className="graph-status">Computing layout...</div>
      ) : null}

      {graphData && totalNodes === 0 ? (
        <div className="graph-empty">
          <div className="graph-empty__card">No analyzable files were found for this workspace.</div>
        </div>
      ) : null}

      <div ref={flowShellRef} className="graph-flow-shell">
        <canvas ref={edgeCanvasRef} className="graph-edge-layer" />
        <canvas ref={arrowCanvasRef} className="graph-edge-arrows" />
        <ReactFlow
          className="graph-flow"
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          nodesDraggable
          onMove={(_, viewport) => {
            viewportZoomRef.current = viewport.zoom;
            viewportRef.current = viewport;
            setViewportMovingState(true);
            applyViewportTransform(viewport);
          }}
          onMoveEnd={(_, viewport) => {
            setViewportMovingState(false);
            if (viewport) {
              viewportZoomRef.current = viewport.zoom;
              viewportRef.current = viewport;
              syncViewportMode(viewport);
              syncZoomLevel(viewport);
              scheduleRender();
            }
          }}
          onNodeDoubleClick={(_, node) => {
            vscode.postMessage({
              type: 'nodeClicked',
              data: { nodeId: node.id },
            });
          }}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1.2} />
          <MiniMap
            pannable
            zoomable
            onClick={(_, position) => {
              const zoom = viewportRef.current.zoom;
              const stageWidth = sizeRef.current.width / zoom;
              const stageHeight = sizeRef.current.height / zoom;
              const bounds = computeWorldBounds(nodes);
              const padding = 40;
              const minWorldX = bounds.x - padding;
              const minWorldY = bounds.y - padding;
              const maxWorldX = Math.max(minWorldX, bounds.x + bounds.width + padding - stageWidth);
              const maxWorldY = Math.max(minWorldY, bounds.y + bounds.height + padding - stageHeight);
              const nextWorldLeft = clamp(position.x - (stageWidth / 2), minWorldX, maxWorldX);
              const nextWorldTop = clamp(position.y - (stageHeight / 2), minWorldY, maxWorldY);
              const nextViewport = {
                x: -(nextWorldLeft * zoom),
                y: -(nextWorldTop * zoom),
                zoom,
              };

              viewportRef.current = nextViewport;
              setViewport(nextViewport, { duration: 180 });
              applyViewportTransform(nextViewport);
            }}
            nodeColor={(node) => (node.data?.isDimmed ? 'rgba(128, 128, 128, 0.32)' : 'rgba(14, 99, 156, 0.85)')}
            nodeStrokeColor={(node) => (node.data?.isDimmed ? 'rgba(145, 145, 145, 0.38)' : 'rgba(208, 238, 255, 0.72)')}
            nodeStrokeWidth={1.6}
            maskColor="rgba(2, 10, 24, 0.42)"
            maskStrokeColor="rgba(126, 217, 255, 0.98)"
            maskStrokeWidth={2.4}
            offsetScale={8}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
