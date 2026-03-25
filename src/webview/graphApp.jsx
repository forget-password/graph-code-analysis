import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useEdgesState,
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

function buildFlowEdges(graphData) {
  return graphData.edges.map((edge) => {
    const color = EDGE_COLORS[edge.type] ?? '#8a8f98';

    return {
      id: edge.id,
      source: edge.source.nodeId,
      target: edge.target.nodeId,
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      style: {
        stroke: color,
        strokeWidth: 1.7,
        opacity: 0.78,
      },
      data: {
        baseOpacity: 0.78,
      },
    };
  });
}

function decorateGraph(nodes, edges, matchedIds, expandedNodeIds, onToggleExpand, lowDetailMode) {
  const hasSearch = matchedIds !== null;

  return {
    nodes: nodes.map((node) => {
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
          onToggleExpand,
        },
      };
    }),
    edges: edges.map((edge) => {
      const isMatched = !hasSearch || (matchedIds.has(edge.source) && matchedIds.has(edge.target));

      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: isMatched ? edge.data.baseOpacity : 0.1,
        },
      };
    }),
  };
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
  const edges = buildFlowEdges(graphData);

  if (algorithm === 'dagre') {
    return applyDagreLayout(nodes, edges, direction);
  }

  return applyElkLayout(nodes, edges, direction);
}

function downloadDataUrl(filename, dataUrl) {
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = dataUrl;
  anchor.click();
}

function FileNode({ data, selected }) {
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (nodeId) {
      updateNodeInternals(nodeId);
    }
  }, [data.expanded, data.lowDetailMode, nodeId, updateNodeInternals]);

  return (
    <div className={`file-node ${data.lowDetailMode ? 'file-node--minimal' : ''} ${data.isDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={data.targetPosition} className="file-node__handle" />
      <button
        type="button"
        className="file-node__header nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          vscode.postMessage({
            type: 'nodeClicked',
            data: { nodeId: data.filePath },
          });
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
            {data.elements.length > 0 ? data.elements.map((element) => {
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
      <Handle type="source" position={data.sourcePosition} className="file-node__handle" />
    </div>
  );
}

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
  const [zoomLevel, setZoomLevel] = useState(100);
  const [lowDetailMode, setLowDetailMode] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView, setViewport } = useReactFlow();
  const zoomLevelRef = useRef(100);
  const lowDetailModeRef = useRef(false);

  const matchedNodeIds = useMemo(
    () => getMatchedNodeIds(graphData, searchTerm),
    [graphData, searchTerm]
  );

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

  const syncViewportUi = useCallback((viewport) => {
    const nextZoomLevel = Math.round(viewport.zoom * 100);
    if (nextZoomLevel !== zoomLevelRef.current) {
      zoomLevelRef.current = nextZoomLevel;
      setZoomLevel(nextZoomLevel);
    }

    const nextLowDetailMode = viewport.zoom <= LOW_DETAIL_ZOOM_THRESHOLD;
    if (nextLowDetailMode !== lowDetailModeRef.current) {
      lowDetailModeRef.current = nextLowDetailMode;
      setLowDetailMode(nextLowDetailMode);
    }
  }, []);

  useEffect(() => {
    if (!graphData?.nodes?.length) {
      setBaseGraph({ nodes: [], edges: [] });
      setNodes([]);
      setEdges([]);
      setIsLayouting(false);
      return;
    }

    let isCancelled = false;

    const runLayout = async () => {
      setIsLayouting(true);

      try {
        const result = await layoutGraph(graphData, layoutEngine);
        if (isCancelled) {
          return;
        }

        setBaseGraph(result);
        setNodes(result.nodes);
        setEdges(result.edges);

        window.requestAnimationFrame(() => {
          fitView({ padding: 0.18, duration: 320 });
        });
      } catch (error) {
        console.error('[GraphCanvas] Failed to layout graph', error);
      } finally {
        if (!isCancelled) {
          setIsLayouting(false);
        }
      }
    };

    runLayout();

    return () => {
      isCancelled = true;
    };
  }, [fitView, graphData, layoutEngine, layoutNonce, setEdges, setNodes]);

  useEffect(() => {
    if (!graphData?.nodes?.length || baseGraph.nodes.length === 0) {
      return;
    }

    const decorated = decorateGraph(
      baseGraph.nodes,
      baseGraph.edges,
      matchedNodeIds,
      expandedNodeIds,
      handleToggleExpand,
      lowDetailMode
    );
    setNodes(decorated.nodes);
    setEdges(decorated.edges);
  }, [baseGraph, expandedNodeIds, graphData, handleToggleExpand, lowDetailMode, matchedNodeIds, setEdges, setNodes]);

  const handleExport = async () => {
    const viewport = document.querySelector('.react-flow__viewport');
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
  };

  const totalNodes = graphData?.nodes?.length ?? 0;
  const matchedCount = matchedNodeIds ? matchedNodeIds.size : totalNodes;

  return (
    <div className="graph-app">
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
          <button type="button" className="graph-button graph-button--secondary" onClick={() => fitView({ padding: 0.18, duration: 220 })}>
            Fit
          </button>
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
        <div className="graph-stat"><span>Layout</span><strong>{layoutEngine.toUpperCase()}</strong></div>
      </div>

      {isLayouting ? (
        <div className="graph-status">Computing layout...</div>
      ) : null}

      {graphData && totalNodes === 0 ? (
        <div className="graph-empty">
          <div className="graph-empty__card">No analyzable files were found for this workspace.</div>
        </div>
      ) : null}

      <ReactFlow
        className="graph-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMove={(_, viewport) => {
          syncViewportUi(viewport);
        }}
        onMoveEnd={(_, viewport) => {
          if (viewport) {
            syncViewportUi(viewport);
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
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.2} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => (node.data?.isDimmed ? 'rgba(128, 128, 128, 0.32)' : 'rgba(14, 99, 156, 0.85)')}
          maskColor="rgba(0, 0, 0, 0.2)"
        />
      </ReactFlow>
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
