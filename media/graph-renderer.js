/**
 * 图形渲染器
 * 使用 JointJS 渲染代码依赖关系图
 */
class GraphRenderer {
    constructor(containerId) {
        this.namespace = joint.shapes;
        this.containerId = containerId;
        this.defaultLayoutAlgorithm = 'radial';
        this.translation = { x: 0, y: 0 };
        this.minimapSize = { width: 220, height: 150 };
        this.minimapBounds = null;
        this.isMinimapDragging = false;
        this.minimapUpdateFrame = null;
        this.minimapPendingMode = null;
        this.minimapViewportRect = null;
        this.minimapMetrics = null;
        this.compactRender = false;
        this.compactRenderThreshold = 280;
        this.compactEdgeThreshold = 700;
        this.layoutMetadata = {
            treeEdgeKeys: new Set(),
            levelByNodeId: new Map(),
            parentByNode: new Map(),
            componentCenterByNode: new Map()
        };

        // 获取容器
        const container = document.getElementById(containerId);
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // 创建图模型
        this.graph = new joint.dia.Graph({}, { cellNamespace: this.namespace });

        // 创建画布 - 使用明确的尺寸
        this.paper = new joint.dia.Paper({
            el: container,
            model: this.graph,
            width: containerWidth,
            height: containerHeight,
            gridSize: 10,
            drawGrid: {
                name: 'dot',
                args: {
                    color: 'var(--vscode-editorIndentGuide-background)',
                    thickness: 1
                }
            },
            background: {
                color: 'var(--vscode-editor-background)'
            },
            interactive: true,
            cellViewNamespace: this.namespace
        });

        // 启用平移和缩放
        this.setupPanAndZoom();

        // 绑定事件
        this.setupEvents();

        // 监听窗口大小变化
        this.setupResize();

        // 初始化小地图
        this.setupMinimap();

        // 监听图变化，同步小地图
        this.setupGraphObservers();

        // 当前缩放级别
        this.scale = 1;
    }

    /**
     * 设置平移和缩放
     */
    setupPanAndZoom() {
        let isPanning = false;
        let startPoint = { x: 0, y: 0 };
        let startTranslation = { x: 0, y: 0 };
        let activePointerId = null;
        const container = document.getElementById(this.containerId);

        const startPanning = (evt) => {
            isPanning = true;
            activePointerId = evt.pointerId ?? null;
            startPoint = { x: evt.clientX, y: evt.clientY };
            startTranslation = { ...this.translation };
            this.paper.$el.css('cursor', 'grabbing');
        };

        const updatePanning = (evt) => {
            if (!isPanning) {
                return;
            }

            if (activePointerId !== null && evt.pointerId !== undefined && evt.pointerId !== activePointerId) {
                return;
            }

            const dx = evt.clientX - startPoint.x;
            const dy = evt.clientY - startPoint.y;

            this.setPaperTranslation(startTranslation.x + dx, startTranslation.y + dy, 'viewport');
        };

        const stopPanning = (evt) => {
            if (!isPanning) {
                return;
            }

            if (activePointerId !== null && evt?.pointerId !== undefined && evt.pointerId !== activePointerId) {
                return;
            }

            isPanning = false;
            activePointerId = null;
            this.paper.$el.css('cursor', 'default');
        };

        // 鼠标滚轮缩放 - 以鼠标位置为锚点
        container.addEventListener('wheel', (evt) => {
            evt.preventDefault();

            const rect = container.getBoundingClientRect();
            const offsetX = evt.clientX - rect.left;
            const offsetY = evt.clientY - rect.top;
            const previousScale = this.scale;
            const zoomFactor = evt.deltaY < 0 ? 1.08 : 0.92;
            const nextScale = Math.max(0.2, Math.min(3, previousScale * zoomFactor));

            if (nextScale === previousScale) {
                return;
            }

            const graphX = (offsetX - this.translation.x) / previousScale;
            const graphY = (offsetY - this.translation.y) / previousScale;

            this.scale = nextScale;
            this.paper.scale(nextScale, nextScale);
            this.setPaperTranslation(
                offsetX - (graphX * nextScale),
                offsetY - (graphY * nextScale),
                'viewport'
            );
        }, { passive: false });

        // 空白处拖拽平移
        this.paper.on('blank:pointerdown', (evt, x, y) => {
            startPanning(evt);
        });

        this.paper.on('blank:pointermove', (evt) => {
            updatePanning(evt);
        });

        this.paper.on('blank:pointerup', (evt) => {
            stopPanning(evt);
        });

        this.paper.on('cell:pointerup', () => {
            this.scheduleMinimapUpdate();
        });

        document.addEventListener('pointermove', (evt) => {
            updatePanning(evt);
        });

        document.addEventListener('pointerup', (evt) => {
            stopPanning(evt);
        });
    }

    /**
     * 设置事件监听
     */
    // 设置事件监听 - 使用 jQuery 事件委托处理 HTML 元素点击
    setupEvents() {
        // 节点点击事件
        this.paper.on('element:pointerclick', (elementView) => {
            const element = elementView.model;
            const nodeId = element.get('nodeId');

            if (nodeId) {
                // 发送消息到扩展
                vscode.postMessage({
                    type: 'nodeClicked',
                    data: { nodeId }
                });
            }
        });

        // 设置事件监听 - 使用 jQuery 事件委托处理 HTML 元素点击
        $(document).on('click', '.code-element-item', (evt) => {
            // 阻止冒泡，避免触发 jointjs 的 blank:pointerclick
            evt.stopPropagation();

            const target = $(evt.currentTarget);
            const filePath = target.data('filepath');
            const line = target.data('line');
            const character = target.data('character');

            console.log('[GraphRenderer] Code element clicked via jQuery:', { filePath, line, character });

            if (filePath) {
                vscode.postMessage({
                    type: 'elementClicked',
                    data: {
                        filePath,
                        line: parseInt(line),
                        character: parseInt(character)
                    }
                });
            }
        });
    }

    /**
     * 设置窗口大小调整
     */
    setupResize() {
        window.addEventListener('resize', () => {
            const container = document.getElementById(this.containerId);
            if (container) {
                const width = container.clientWidth;
                const height = container.clientHeight;
                this.paper.setDimensions(width, height);
                this.scheduleMinimapUpdate('full');
            }
        });
    }

    setupMinimap() {
        const minimap = document.getElementById('minimap');
        if (!minimap) {
            return;
        }

        const syncFromPointer = (evt) => {
            if (!this.minimapBounds) {
                return;
            }

            const pointX = evt.clientX - this.minimapBounds.left;
            const pointY = evt.clientY - this.minimapBounds.top;
            this.centerViewportOnMinimapPoint(pointX, pointY);
        };

        minimap.addEventListener('pointerdown', (evt) => {
            evt.preventDefault();
            minimap.setPointerCapture(evt.pointerId);
            this.isMinimapDragging = true;
            syncFromPointer(evt);
        });

        minimap.addEventListener('pointermove', (evt) => {
            if (!this.isMinimapDragging) {
                return;
            }

            syncFromPointer(evt);
        });

        minimap.addEventListener('pointerup', (evt) => {
            this.isMinimapDragging = false;
            if (minimap.hasPointerCapture(evt.pointerId)) {
                minimap.releasePointerCapture(evt.pointerId);
            }
        });

        minimap.addEventListener('pointerleave', () => {
            this.isMinimapDragging = false;
        });
    }

    setupGraphObservers() {
        this.graph.on('add remove reset change:position', () => {
            this.scheduleMinimapUpdate('full');
        });
    }

    /**
     * 渲染图数据
     */
    renderGraph(graphData) {
        // 清空现有图
        this.graph.clear();

        if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
            return;
        }

        this.compactRender = graphData.nodes.length >= this.compactRenderThreshold
            || graphData.edges.length >= this.compactEdgeThreshold;

        const cells = [];

        // 创建节点
        const nodeMap = new Map();
        graphData.nodes.forEach((nodeData, index) => {
            const node = this.createNode(nodeData);
            cells.push(node);
            nodeMap.set(nodeData.id, node);
        });

        // 创建连线
        graphData.edges.forEach(edgeData => {
            const edge = this.createEdge(edgeData, nodeMap);
            if (edge) {
                cells.push(edge);
            }
        });

        // 添加到图中
        this.graph.resetCells(cells);
        this.graph.getLinks().forEach((link) => link.toBack());
        this.graph.getElements().forEach((element) => element.toFront());

        // 手动注入 HTML 内容 (Fix for interior HTML not rendering)
        this.graph.getElements().forEach(element => {
            const htmlContent = element.get('htmlContent');
            if (htmlContent) {
                const view = element.findView(this.paper);
                if (view) {
                    const listContainer = view.$el.find('.code-list-container');
                    if (listContainer.length) {
                        listContainer.html(htmlContent);
                    }
                }
            }
        });

        // 应用布局
        this.applyLayout(graphData.layout);
        this.scheduleMinimapUpdate('full');
    }


    /**
     * 创建节点
     */
    createNode(nodeData) {
        const fileName = nodeData.label;
        const elements = nodeData.elements || [];
        const previewLimit = this.compactRender ? 3 : 8;
        const visibleElements = elements.slice(0, previewLimit);
        const hiddenElementCount = Math.max(elements.length - visibleElements.length, 0);

        // 计算节点高度 - 控制最大高度，避免出现超长矩形卡片
        const headerHeight = this.compactRender ? 34 : 38;
        const itemHeight = this.compactRender ? 22 : 26;
        const padding = this.compactRender ? 8 : 10;
        const maxContentHeight = this.compactRender ? 82 : 156;
        const previewRowCount = visibleElements.length + (hiddenElementCount > 0 ? 1 : 0);
        const contentHeight = Math.min((previewRowCount * itemHeight) + padding, maxContentHeight);
        const nodeHeight = headerHeight + contentHeight;
        const nodeWidth = this.compactRender ? 200 : 220;

        // 创建节点内容 HTML - 大图时只渲染少量预览，降低 DOM 负担
        const elementsHtml = visibleElements
            .map((el, idx) => {
                const icon = this.getElementIcon(el.kind);
                const exportBadge = el.isExported ? '<span style="color: #89d185; font-size: 11px;">📤</span> ' : '';

                // 确保 range 存在且正确访问
                let line = 0;
                let char = 0;

                if (el.range) {
                    if (Array.isArray(el.range) && el.range.length > 0) {
                        // Handle localized vscode.Range that comes as array [start, end]
                        line = el.range[0].line;
                        char = el.range[0].character;
                    } else if (el.range.start) {
                        // Handle standard vscode.Range object
                        line = el.range.start.line;
                        char = el.range.start.character;
                    }
                }

                // 添加 data 属性用于点击事件
                return `<div class="code-element code-element-item" 
                    data-filepath="${el.filePath}"
                    data-line="${line}"
                    data-character="${char}"
                    style="
                    padding: 8px 12px; 
                    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
                    background: rgba(0, 0, 0, 0.05);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                ">
          <span style="margin-right: 8px; font-size: 16px;">${icon}</span>
          ${exportBadge}<span style="color: #000000; font-size: 13px; font-weight: 500;">${el.name}</span>
          <span style="color: #666666; font-size: 11px; margin-left: auto;">(${el.kind})</span>
        </div>`;
            })
            .join('');
        const summaryHtml = hiddenElementCount > 0
            ? `<div style="
                    padding: 6px 12px;
                    color: #666666;
                    font-size: 11px;
                    background: rgba(0, 0, 0, 0.03);
                    border-top: 1px solid rgba(128, 128, 128, 0.14);
                ">+ ${hiddenElementCount} more symbols</div>`
            : '';

        const node = new joint.shapes.standard.Rectangle({
            position: {
                x: nodeData.position?.x || 50,
                y: nodeData.position?.y || 50
            },
            size: { width: nodeWidth, height: nodeHeight },
            attrs: {
                body: {
                    fill: 'var(--vscode-editor-background)',
                    stroke: 'rgba(128, 128, 128, 0.3)', // 暗淡的灰白色边框
                    strokeWidth: 1.5,
                    rx: 5, // 圆角半径
                    ry: 5
                },
                label: {
                    text: '',
                    fill: 'var(--vscode-editor-foreground)'
                }
            },
            markup: [{
                tagName: 'rect',
                selector: 'body'
            }, {
                tagName: 'foreignObject',
                selector: 'foreignObject',
                attributes: {
                    width: nodeWidth,
                    height: nodeHeight
                },
                children: [{
                    tagName: 'div',
                    namespaceURI: 'http://www.w3.org/1999/xhtml',
                    selector: 'content',
                    style: {
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden',
                        borderRadius: '5px'
                    },
                    children: [{
                        tagName: 'div',
                        textContent: `📄 ${fileName}`,
                        style: {
                            padding: '12px',
                            fontWeight: 'bold',
                            borderBottom: '2px solid rgba(128, 128, 128, 0.3)',
                            backgroundColor: 'rgba(200, 200, 200, 0.3)',
                            color: '#000000',
                            fontSize: '14px',
                            borderTopLeftRadius: '5px',
                            borderTopRightRadius: '5px',
                            pointerEvents: 'none',
                            userSelect: 'none',
                            cursor: 'grab'
                        }
                    }, {
                        tagName: 'div',
                        attributes: {
                            class: 'code-list-container'
                        },
                        style: {
                            maxHeight: (nodeHeight - headerHeight) + 'px',
                            overflow: 'auto',
                            backgroundColor: '#ffffff',
                            pointerEvents: 'none'
                        }
                    }]
                }]
            }]
        });

        // 保存节点数据
        node.set('nodeId', nodeData.id);
        node.set('elements', elements);
        node.set(
            'htmlContent',
            `${elementsHtml}${summaryHtml}` || '<div style="padding: 12px; color: #666666;">No elements</div>'
        );

        return node;
    }

    /**
     * 创建连线
     */
    createEdge(edgeData, nodeMap) {
        const sourceNode = nodeMap.get(edgeData.source.nodeId);
        const targetNode = nodeMap.get(edgeData.target.nodeId);

        if (!sourceNode || !targetNode) {
            console.warn('Source or target node not found for edge:', edgeData);
            return null;
        }

        const color = this.getEdgeColor(edgeData.type);

        const link = new joint.shapes.standard.Link({
            source: { id: sourceNode.id },
            target: { id: targetNode.id },
            attrs: {
                line: {
                    stroke: color,
                    strokeWidth: 2,
                    targetMarker: {
                        type: 'path',
                        d: 'M 10 -5 0 0 10 5 z',
                        fill: color
                    }
                }
            },
            vertices: edgeData.vertices || []
        });
        link.set('edgeType', edgeData.type);

        return link;
    }

    /**
    * 应用布局
    */
    applyLayout(layoutConfig) {
        const algorithm = layoutConfig?.algorithm || this.defaultLayoutAlgorithm;

        if (algorithm === 'dagre') {
            // 保留 Dagre，兼容需要分层阅读的场景
            joint.layout.DirectedGraph.layout(this.graph, {
                nodeSep: 100,
                edgeSep: 100,
                rankSep: 150,
                rankDir: layoutConfig.direction || 'TB',
                marginX: 80,
                marginY: 80
            });
            this.applyEdgeStyle('dagre');
            return;
        }

        // 非 Dagre 布局统一采用中心扩散式布局，避免形成横向/纵向长方形编排
        this.applyRadialLayout();
        this.applyEdgeStyle('radial');
    }

    applyRadialLayout() {
        const elements = this.graph.getElements();
        if (elements.length === 0) {
            return;
        }

        const elementMap = new Map(elements.map((element) => [element.id, element]));
        const adjacency = new Map(elements.map((element) => [element.id, new Set()]));

        this.graph.getLinks().forEach((link) => {
            const sourceId = link.get('source')?.id;
            const targetId = link.get('target')?.id;

            if (!sourceId || !targetId || sourceId === targetId) {
                return;
            }

            if (!adjacency.has(sourceId) || !adjacency.has(targetId)) {
                return;
            }

            adjacency.get(sourceId).add(targetId);
            adjacency.get(targetId).add(sourceId);
        });

        const nodeIds = elements.map((element) => element.id);
        const isolatedNodeIds = nodeIds.filter((nodeId) => (adjacency.get(nodeId)?.size || 0) === 0);
        const connectedComponents = this.getConnectedComponents(nodeIds, adjacency)
            .filter((componentIds) => componentIds.some((nodeId) => (adjacency.get(nodeId)?.size || 0) > 0))
            .sort((left, right) => right.length - left.length);

        const componentLayouts = connectedComponents.map((componentIds) =>
            this.buildRadialComponentLayout(componentIds, adjacency, elementMap)
        );

        if (isolatedNodeIds.length > 0) {
            componentLayouts.push(this.buildIsolatedCloudLayout(isolatedNodeIds, elementMap));
        }

        const centers = this.getComponentCenters(componentLayouts);
        const treeEdgeKeys = new Set();
        const levelByNodeId = new Map();
        const rootNodeIds = new Set();
        const parentByNode = new Map();
        const componentCenterByNode = new Map();

        componentLayouts.forEach((layout, index) => {
            const center = centers[index];
            rootNodeIds.add(layout.rootId);

            layout.parentByNode.forEach((parentId, nodeId) => {
                parentByNode.set(nodeId, parentId);
                if (parentId) {
                    treeEdgeKeys.add(this.getUndirectedEdgeKey(parentId, nodeId));
                }
            });

            layout.levelByNode.forEach((level, nodeId) => {
                levelByNodeId.set(nodeId, level);
            });

            layout.positions.forEach((relativePosition, cellId) => {
                const element = elementMap.get(cellId);
                if (!element) {
                    return;
                }

                const size = element.size();
                componentCenterByNode.set(cellId, center);
                element.position(
                    center.x + relativePosition.x - (size.width / 2),
                    center.y + relativePosition.y - (size.height / 2)
                );
            });
        });

        this.resolveRenderedNodeOverlaps(elements, rootNodeIds);

        this.layoutMetadata = {
            treeEdgeKeys,
            levelByNodeId,
            parentByNode,
            componentCenterByNode
        };
        this.scheduleMinimapUpdate('full');
    }

    applyEdgeStyle(style) {
        const links = this.graph.getLinks();
        const routingData = links.map((link) => this.getLinkRoutingData(link));
        const routeByLinkId = new Map(routingData.map((route) => [route.linkId, route]));
        const outgoingGroups = this.buildRoutingGroups(routingData, 'outgoing');
        const incomingGroups = this.buildRoutingGroups(routingData, 'incoming');

        links.forEach((link) => {
            const route = routeByLinkId.get(link.id);
            if (style === 'dagre') {
                if (route?.sourceId) {
                    link.source({ id: route.sourceId });
                }
                if (route?.targetId) {
                    link.target({ id: route.targetId });
                }
                link.vertices([]);
                link.set('router', {
                    name: 'manhattan',
                    args: {
                        padding: 30
                    }
                });
                link.set('connector', { name: 'normal' });
                link.attr('line/strokeOpacity', 1);
                link.attr('line/strokeWidth', 2);
                return;
            }

            if (!route) {
                return;
            }

            const { edgeColor, isTreeEdge, levelDelta } = route;
            const sourceGroupKey = `${route.sourceId}:${route.sourceSide}:outgoing`;
            const targetGroupKey = `${route.targetId}:${route.targetSide}:incoming`;
            const outgoingSlot = this.getSlotInfo(outgoingGroups.get(sourceGroupKey) || [route], route);
            const incomingSlot = this.getSlotInfo(incomingGroups.get(targetGroupKey) || [route], route);

            this.applyLinkAnchors(link, route, outgoingSlot, incomingSlot);

            link.unset('router');
            link.set('connector', { name: 'normal' });
            link.vertices(this.buildOrthogonalRouteVertices(route, outgoingGroups, incomingGroups));

            if (isTreeEdge) {
                link.attr('line/stroke', edgeColor);
                link.attr('line/strokeOpacity', 0.86);
                link.attr('line/strokeWidth', 1.8);
                link.attr('line/strokeDasharray', 'none');
                link.attr('line/targetMarker/fill', edgeColor);
                link.attr('line/targetMarker/stroke', edgeColor);
                link.attr('line/targetMarker/d', 'M 7 -3.5 0 0 7 3.5 z');
                link.attr('line/targetMarker/opacity', 0.92);
                return;
            }

            link.attr('line/stroke', edgeColor);
            link.attr('line/strokeOpacity', levelDelta === 0 ? 0.045 : 0.025);
            link.attr('line/strokeWidth', levelDelta === 0 ? 0.55 : 0.5);
            link.attr('line/strokeDasharray', levelDelta === 0 ? '2 6' : '2 7');
            link.attr('line/targetMarker/fill', edgeColor);
            link.attr('line/targetMarker/stroke', edgeColor);
            link.attr('line/targetMarker/d', 'M 5 -2.5 0 0 5 2.5 z');
            link.attr('line/targetMarker/opacity', levelDelta === 0 ? 0.04 : 0.025);
        });
    }

    applyLinkAnchors(link, route, outgoingSlot, incomingSlot) {
        if (route.sourceId) {
            link.source({
                id: route.sourceId,
                anchor: this.getNodeAnchorConfig(route.sourceElement, route.sourceSide, outgoingSlot, 'outgoing'),
                connectionPoint: { name: 'anchor' }
            });
        }

        if (route.targetId) {
            link.target({
                id: route.targetId,
                anchor: this.getNodeAnchorConfig(route.targetElement, route.targetSide, incomingSlot, 'incoming'),
                connectionPoint: { name: 'anchor' }
            });
        }
    }

    getLinkRoutingData(link) {
        const sourceId = link.get('source')?.id;
        const targetId = link.get('target')?.id;
        const sourceElement = link.getSourceElement();
        const targetElement = link.getTargetElement();
        const sourceLevel = this.layoutMetadata.levelByNodeId.get(sourceId) ?? 0;
        const targetLevel = this.layoutMetadata.levelByNodeId.get(targetId) ?? 0;
        const levelDelta = Math.abs(sourceLevel - targetLevel);
        const edgeKey = sourceId && targetId ? this.getUndirectedEdgeKey(sourceId, targetId) : '';
        const isTreeEdge = this.layoutMetadata.treeEdgeKeys.has(edgeKey);
        const edgeColor = this.getEdgeColor(link.get('edgeType'));
        const sourceCenter = sourceElement ? this.getElementCenter(sourceElement) : { x: 0, y: 0 };
        const targetCenter = targetElement ? this.getElementCenter(targetElement) : { x: 0, y: 0 };
        const componentCenter = this.layoutMetadata.componentCenterByNode.get(sourceId)
            || this.layoutMetadata.componentCenterByNode.get(targetId)
            || { x: 0, y: 0 };
        const sourceSide = this.getPreferredNodeSide(sourceId, sourceCenter, targetCenter, componentCenter, sourceLevel, targetLevel, isTreeEdge, true);
        const targetSide = this.getPreferredNodeSide(targetId, targetCenter, sourceCenter, componentCenter, targetLevel, sourceLevel, isTreeEdge, false);

        return {
            linkId: link.id,
            sourceId,
            targetId,
            sourceElement,
            targetElement,
            sourceCenter,
            targetCenter,
            sourceLevel,
            targetLevel,
            levelDelta,
            isTreeEdge,
            edgeColor,
            sourceSide,
            targetSide
        };
    }

    buildRoutingGroups(routingData, mode) {
        const groups = new Map();

        routingData.forEach((route) => {
            const nodeId = mode === 'outgoing' ? route.sourceId : route.targetId;
            const side = mode === 'outgoing' ? route.sourceSide : route.targetSide;
            const groupKey = `${nodeId}:${side}:${mode}`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(route);
        });

        groups.forEach((routes, groupKey) => {
            const side = mode === 'outgoing' ? routes[0]?.sourceSide : routes[0]?.targetSide;
            routes.sort((left, right) => {
                const leftCenter = mode === 'outgoing' ? left.targetCenter : left.sourceCenter;
                const rightCenter = mode === 'outgoing' ? right.targetCenter : right.sourceCenter;
                return this.getPerpendicularCoordinate(leftCenter, side) - this.getPerpendicularCoordinate(rightCenter, side);
            });
        });

        return groups;
    }

    getPreferredNodeSide(nodeId, nodeCenter, otherCenter, componentCenter, nodeLevel, otherLevel, isTreeEdge, isSource) {
        if (!nodeId) {
            return 'right';
        }

        const componentDx = nodeCenter.x - componentCenter.x;
        const componentDy = nodeCenter.y - componentCenter.y;
        const radialSide = this.getDominantSide(componentDx, componentDy, otherCenter.x - nodeCenter.x, otherCenter.y - nodeCenter.y);

        if (!isTreeEdge) {
            return isSource
                ? this.getDominantSide(otherCenter.x - nodeCenter.x, otherCenter.y - nodeCenter.y)
                : this.getOppositeSide(this.getDominantSide(nodeCenter.x - otherCenter.x, nodeCenter.y - otherCenter.y));
        }

        if (nodeLevel < otherLevel) {
            return radialSide;
        }

        if (nodeLevel > otherLevel) {
            return this.getOppositeSide(radialSide);
        }

        return isSource
            ? this.getDominantSide(otherCenter.x - nodeCenter.x, otherCenter.y - nodeCenter.y)
            : this.getOppositeSide(this.getDominantSide(nodeCenter.x - otherCenter.x, nodeCenter.y - otherCenter.y));
    }

    getDominantSide(dx, dy, fallbackDx = 1, fallbackDy = 0) {
        const actualDx = dx === 0 && dy === 0 ? fallbackDx : dx;
        const actualDy = dx === 0 && dy === 0 ? fallbackDy : dy;

        if (Math.abs(actualDx) >= Math.abs(actualDy)) {
            return actualDx >= 0 ? 'right' : 'left';
        }

        return actualDy >= 0 ? 'bottom' : 'top';
    }

    getOppositeSide(side) {
        const sideMap = {
            left: 'right',
            right: 'left',
            top: 'bottom',
            bottom: 'top'
        };
        return sideMap[side] || 'right';
    }

    getPerpendicularCoordinate(point, side) {
        return side === 'left' || side === 'right' ? point.y : point.x;
    }

    getSideVector(side) {
        const vectors = {
            left: { x: -1, y: 0 },
            right: { x: 1, y: 0 },
            top: { x: 0, y: -1 },
            bottom: { x: 0, y: 1 }
        };
        return vectors[side] || vectors.right;
    }

    getNodeSlotOffset(slotIndex = 0, slotCount = 1, mode = 'outgoing') {
        const progress = slotCount <= 1 ? 0.5 : ((slotIndex + 1) / (slotCount + 1));
        const segment = mode === 'outgoing'
            ? { start: 0.18, end: 0.46 }
            : { start: 0.56, end: 0.84 };

        return segment.start + ((segment.end - segment.start) * progress);
    }

    getNodeAnchorConfig(element, side, slotInfo, mode = 'outgoing') {
        const size = element?.size() || { width: 220, height: 150 };
        const offsetRatio = this.getNodeSlotOffset(slotInfo?.slotIndex, slotInfo?.slotCount, mode);

        if (side === 'left' || side === 'right') {
            return {
                name: side,
                args: {
                    dy: (offsetRatio - 0.5) * size.height
                }
            };
        }

        return {
            name: side,
            args: {
                dx: (offsetRatio - 0.5) * size.width
            }
        };
    }

    getNodeBoundaryPoint(element, side, slotIndex = 0, slotCount = 1, mode = 'outgoing') {
        const position = element.position();
        const size = element.size();
        const offsetRatio = this.getNodeSlotOffset(slotIndex, slotCount, mode);

        if (side === 'left' || side === 'right') {
            return {
                x: side === 'left' ? position.x : position.x + size.width,
                y: position.y + (size.height * offsetRatio)
            };
        }

        return {
            x: position.x + (size.width * offsetRatio),
            y: side === 'top' ? position.y : position.y + size.height
        };
    }

    getSlotInfo(routes, route) {
        const slotIndex = Math.max(0, routes.findIndex((item) => item.linkId === route.linkId));
        return {
            slotIndex,
            slotCount: Math.max(routes.length, 1)
        };
    }

    getNodeBundlePoint(element, side, mode = 'outgoing') {
        const position = element.position();
        const size = element.size();
        const vector = this.getSideVector(side);
        const segmentCenter = mode === 'outgoing' ? 0.32 : 0.68;

        if (side === 'left' || side === 'right') {
            return {
                x: (side === 'left' ? position.x : position.x + size.width) + (vector.x * 34),
                y: position.y + (size.height * segmentCenter)
            };
        }

        return {
            x: position.x + (size.width * segmentCenter),
            y: (side === 'top' ? position.y : position.y + size.height) + (vector.y * 34)
        };
    }

    buildOrthogonalRouteVertices(route, outgoingGroups, incomingGroups) {
        if (!route.sourceElement || !route.targetElement) {
            return [];
        }

        const outgoingKey = `${route.sourceId}:${route.sourceSide}:outgoing`;
        const incomingKey = `${route.targetId}:${route.targetSide}:incoming`;
        const outgoingRoutes = outgoingGroups.get(outgoingKey) || [route];
        const incomingRoutes = incomingGroups.get(incomingKey) || [route];
        const outgoingSlot = this.getSlotInfo(outgoingRoutes, route);
        const incomingSlot = this.getSlotInfo(incomingRoutes, route);

        const sourcePoint = this.getNodeBoundaryPoint(
            route.sourceElement,
            route.sourceSide,
            outgoingSlot.slotIndex,
            outgoingSlot.slotCount,
            'outgoing'
        );
        const targetPoint = this.getNodeBoundaryPoint(
            route.targetElement,
            route.targetSide,
            incomingSlot.slotIndex,
            incomingSlot.slotCount,
            'incoming'
        );
        const sourceVector = this.getSideVector(route.sourceSide);
        const targetVector = this.getSideVector(route.targetSide);
        const sourceStem = {
            x: sourcePoint.x + (sourceVector.x * 16),
            y: sourcePoint.y + (sourceVector.y * 16)
        };
        const sourceBundle = this.getNodeBundlePoint(route.sourceElement, route.sourceSide, 'outgoing');
        const targetStem = {
            x: targetPoint.x + (targetVector.x * 16),
            y: targetPoint.y + (targetVector.y * 16)
        };
        const vertices = [sourceStem, sourceBundle];
        const sourceHorizontal = route.sourceSide === 'left' || route.sourceSide === 'right';
        const sourceHashOffset = (this.hashNodeId(route.sourceId) % 7) * 10;
        const branchSpread = ((outgoingSlot.slotIndex - ((outgoingSlot.slotCount - 1) / 2)) * 14);

        if (sourceHorizontal) {
            const branchX = sourceBundle.x + (sourceVector.x * (sourceHashOffset + branchSpread));
            vertices.push({ x: branchX, y: sourceBundle.y });
            vertices.push({ x: branchX, y: targetStem.y });
        } else {
            const branchY = sourceBundle.y + (sourceVector.y * (sourceHashOffset + branchSpread));
            vertices.push({ x: sourceBundle.x, y: branchY });
            vertices.push({ x: targetStem.x, y: branchY });
        }

        vertices.push(targetStem);
        return this.dedupeVertices(vertices);
    }

    dedupeVertices(vertices) {
        return vertices.filter((vertex, index) => {
            if (index === 0) {
                return true;
            }

            const previous = vertices[index - 1];
            return previous.x !== vertex.x || previous.y !== vertex.y;
        });
    }

    hashNodeId(nodeId) {
        return [...String(nodeId || '')].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) % 997, 7);
    }

    getElementCenter(element) {
        const position = element.position();
        const size = element.size();
        return {
            x: position.x + (size.width / 2),
            y: position.y + (size.height / 2)
        };
    }

    getConnectedComponents(nodeIds, adjacency) {
        const visited = new Set();
        const components = [];

        nodeIds.forEach((nodeId) => {
            if (visited.has(nodeId)) {
                return;
            }

            const queue = [nodeId];
            const component = [];
            visited.add(nodeId);

            while (queue.length > 0) {
                const currentId = queue.shift();
                component.push(currentId);

                adjacency.get(currentId).forEach((neighborId) => {
                    if (visited.has(neighborId)) {
                        return;
                    }

                    visited.add(neighborId);
                    queue.push(neighborId);
                });
            }

            components.push(component);
        });

        return components;
    }

    componentHasCycle(componentIds, adjacency, startNodeId) {
        if (!startNodeId) {
            return false;
        }

        const componentSet = new Set(componentIds);
        const visited = new Set();
        const stack = [[startNodeId, null]];

        while (stack.length > 0) {
            const [nodeId, parentId] = stack.pop();

            if (visited.has(nodeId)) {
                continue;
            }

            visited.add(nodeId);

            for (const neighborId of (adjacency.get(nodeId) || [])) {
                if (!componentSet.has(neighborId)) {
                    continue;
                }

                if (!visited.has(neighborId)) {
                    stack.push([neighborId, nodeId]);
                    continue;
                }

                if (neighborId !== parentId) {
                    return true;
                }
            }
        }

        return false;
    }

    buildRadialComponentLayout(componentIds, adjacency, elementMap) {
        const componentSet = new Set(componentIds);
        const rootId = componentIds.reduce((bestId, currentId) => {
            if (!bestId) {
                return currentId;
            }

            const currentDegree = adjacency.get(currentId)?.size || 0;
            const bestDegree = adjacency.get(bestId)?.size || 0;
            return currentDegree > bestDegree ? currentId : bestId;
        }, null);
        const hasCycle = this.componentHasCycle(componentIds, adjacency, rootId);

        const levels = new Map([[rootId, 0]]);
        const parentByNode = new Map([[rootId, null]]);
        const childMap = new Map(componentIds.map((nodeId) => [nodeId, []]));
        const visited = new Set([rootId]);
        const queue = [rootId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentLevel = levels.get(currentId) || 0;
            const neighbors = [...(adjacency.get(currentId) || [])]
                .filter((neighborId) => componentSet.has(neighborId))
                .sort((leftId, rightId) => (adjacency.get(rightId)?.size || 0) - (adjacency.get(leftId)?.size || 0));

            neighbors.forEach((neighborId) => {
                if (visited.has(neighborId)) {
                    return;
                }

                visited.add(neighborId);
                levels.set(neighborId, currentLevel + 1);
                parentByNode.set(neighborId, currentId);
                childMap.get(currentId).push(neighborId);
                queue.push(neighborId);
            });
        }

        const layerMap = new Map();
        componentIds.forEach((nodeId) => {
            const level = levels.get(nodeId) || 0;
            if (!layerMap.has(level)) {
                layerMap.set(level, []);
            }
            layerMap.get(level).push(nodeId);
        });

        const subtreeWeight = new Map();
        const computeSubtreeWeight = (nodeId) => {
            const children = childMap.get(nodeId) || [];
            const structuralWeight = 1 + (Math.min(adjacency.get(nodeId)?.size || 0, 4) * 0.35);
            const total = structuralWeight + children.reduce((sum, childId) => sum + computeSubtreeWeight(childId), 0);
            subtreeWeight.set(nodeId, total);
            return total;
        };
        computeSubtreeWeight(rootId);

        const spanByNode = new Map();
        this.assignTreeSectors(rootId, childMap, subtreeWeight, spanByNode, -Math.PI, Math.PI);

        const positions = new Map([[rootId, { x: 0, y: 0 }]]);
        const levelByNode = new Map(levels);

        this.seedOrganicPositions(rootId, positions, childMap, spanByNode, subtreeWeight, levels);
        this.relaxOrganicComponentLayout(
            componentIds,
            positions,
            adjacency,
            elementMap,
            levels,
            spanByNode,
            parentByNode,
            rootId
        );
        this.enforceCloudBands(componentIds, positions, levels, rootId, hasCycle);
        this.resolveComponentRectOverlaps(componentIds, positions, elementMap, 18, hasCycle ? null : rootId);
        this.compactComponentLayout(componentIds, positions, adjacency, elementMap, rootId);
        this.enforceCloudBands(componentIds, positions, levels, rootId, hasCycle);
        this.resolveComponentRectOverlaps(componentIds, positions, elementMap, 16, hasCycle ? null : rootId);
        this.centerComponentPositions(positions, rootId);

        const radius = componentIds.reduce((maxRadius, nodeId) => {
            const position = positions.get(nodeId) || { x: 0, y: 0 };
            const size = elementMap.get(nodeId)?.size() || { width: 220, height: 150 };
            return Math.max(maxRadius, Math.hypot(position.x, position.y) + (Math.max(size.width, size.height) / 2));
        }, 0);

        return { positions, radius, parentByNode, levelByNode, rootId: hasCycle ? null : rootId };
    }

    buildIsolatedCloudLayout(componentIds, elementMap) {
        const sortedIds = [...componentIds].sort((leftId, rightId) => {
            const leftLabel = elementMap.get(leftId)?.get('nodeId') || leftId;
            const rightLabel = elementMap.get(rightId)?.get('nodeId') || rightId;
            return leftLabel.localeCompare(rightLabel);
        });
        const positions = new Map();
        const levelByNode = new Map();
        const parentByNode = new Map();
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const rootId = sortedIds[0] || null;

        sortedIds.forEach((nodeId, index) => {
            const size = elementMap.get(nodeId)?.size() || { width: 220, height: 150 };
            const radius = 36 + (Math.sqrt(index + 1) * (Math.max(size.width, size.height) * 0.38));
            const angle = (-Math.PI / 2) + (index * goldenAngle);
            positions.set(nodeId, {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius
            });
            levelByNode.set(nodeId, 1000);
            parentByNode.set(nodeId, null);
        });

        this.resolveComponentRectOverlaps(sortedIds, positions, elementMap, 14, rootId);
        this.compactComponentLayout(sortedIds, positions, new Map(), elementMap, rootId);
        this.resolveComponentRectOverlaps(sortedIds, positions, elementMap, 12, rootId);
        if (rootId) {
            this.centerComponentPositions(positions, rootId);
        }

        const radius = sortedIds.reduce((maxRadius, nodeId) => {
            const position = positions.get(nodeId) || { x: 0, y: 0 };
            const size = elementMap.get(nodeId)?.size() || { width: 220, height: 150 };
            return Math.max(maxRadius, Math.hypot(position.x, position.y) + (Math.max(size.width, size.height) / 2));
        }, 0);

        return { positions, radius, parentByNode, levelByNode, rootId };
    }

    seedOrganicPositions(nodeId, positions, childMap, spanByNode, subtreeWeight, levels) {
        const children = childMap.get(nodeId) || [];
        if (children.length === 0) {
            return;
        }

        const parentPosition = positions.get(nodeId) || { x: 0, y: 0 };
        const siblingCount = children.length;

        children
            .slice()
            .sort((leftId, rightId) => (subtreeWeight.get(rightId) || 0) - (subtreeWeight.get(leftId) || 0))
            .forEach((childId, index) => {
                const level = levels.get(childId) || 1;
                const angle = spanByNode.get(childId)?.center || (-Math.PI / 2);
                const siblingOffset = siblingCount > 1
                    ? (index - ((siblingCount - 1) / 2)) / ((siblingCount - 1) / 2 || 1)
                    : 0;
                const branchDistance = 122 + Math.min(level * 12, 34) + Math.min((subtreeWeight.get(childId) || 1) * 2.4, 14);
                const lateralOffset = siblingOffset * Math.min(22 + (siblingCount * 4), 48);
                const forward = {
                    x: Math.cos(angle) * branchDistance,
                    y: Math.sin(angle) * branchDistance
                };
                const lateral = {
                    x: -Math.sin(angle) * lateralOffset,
                    y: Math.cos(angle) * lateralOffset
                };

                positions.set(childId, {
                    x: parentPosition.x + forward.x + lateral.x,
                    y: parentPosition.y + forward.y + lateral.y
                });

                this.seedOrganicPositions(childId, positions, childMap, spanByNode, subtreeWeight, levels);
            });
    }

    relaxOrganicComponentLayout(componentIds, positions, adjacency, elementMap, levels, spanByNode, parentByNode, rootId) {
        const velocities = new Map(componentIds.map((nodeId) => [nodeId, { x: 0, y: 0 }]));
        const edges = [];
        const seenEdges = new Set();

        componentIds.forEach((nodeId) => {
            (adjacency.get(nodeId) || new Set()).forEach((neighborId) => {
                const edgeKey = this.getUndirectedEdgeKey(nodeId, neighborId);
                if (seenEdges.has(edgeKey)) {
                    return;
                }

                seenEdges.add(edgeKey);
                edges.push([nodeId, neighborId]);
            });
        });

        for (let iteration = 0; iteration < 56; iteration += 1) {
            const forces = new Map(componentIds.map((nodeId) => [nodeId, { x: 0, y: 0 }]));

            for (let i = 0; i < componentIds.length; i += 1) {
                for (let j = i + 1; j < componentIds.length; j += 1) {
                    const leftId = componentIds[i];
                    const rightId = componentIds[j];
                    const leftPosition = positions.get(leftId) || { x: 0, y: 0 };
                    const rightPosition = positions.get(rightId) || { x: 0, y: 0 };
                    const dx = rightPosition.x - leftPosition.x;
                    const dy = rightPosition.y - leftPosition.y;
                    const distance = Math.max(Math.hypot(dx, dy), 1);
                    const leftSize = elementMap.get(leftId)?.size() || { width: 220, height: 150 };
                    const rightSize = elementMap.get(rightId)?.size() || { width: 220, height: 150 };
                    const idealSpacing = ((Math.max(leftSize.width, leftSize.height) + Math.max(rightSize.width, rightSize.height)) / 2) + 16;
                    const influenceRadius = idealSpacing + 72;

                    if (distance > influenceRadius) {
                        continue;
                    }

                    const directionX = dx / distance;
                    const directionY = dy / distance;
                    const overlapForce = Math.max(idealSpacing - distance, 0) * 0.34;
                    const repulsionForce = 900 / (distance * distance);
                    const forceMagnitude = overlapForce + repulsionForce;

                    forces.get(leftId).x -= directionX * forceMagnitude;
                    forces.get(leftId).y -= directionY * forceMagnitude;
                    forces.get(rightId).x += directionX * forceMagnitude;
                    forces.get(rightId).y += directionY * forceMagnitude;
                }
            }

            edges.forEach(([sourceId, targetId]) => {
                const sourcePosition = positions.get(sourceId) || { x: 0, y: 0 };
                const targetPosition = positions.get(targetId) || { x: 0, y: 0 };
                const dx = targetPosition.x - sourcePosition.x;
                const dy = targetPosition.y - sourcePosition.y;
                const distance = Math.max(Math.hypot(dx, dy), 1);
                const isTreeEdge = parentByNode.get(sourceId) === targetId || parentByNode.get(targetId) === sourceId;
                const sourceLevel = levels.get(sourceId) || 0;
                const targetLevel = levels.get(targetId) || 0;
                const targetLength = isTreeEdge
                    ? 126 + (Math.min(sourceLevel, targetLevel) * 6)
                    : 156 + (Math.abs(sourceLevel - targetLevel) * 10);
                const stiffness = isTreeEdge ? 0.034 : 0.016;
                const stretch = distance - targetLength;
                const forceX = (dx / distance) * stretch * stiffness;
                const forceY = (dy / distance) * stretch * stiffness;

                forces.get(sourceId).x += forceX;
                forces.get(sourceId).y += forceY;
                forces.get(targetId).x -= forceX;
                forces.get(targetId).y -= forceY;
            });

            componentIds.forEach((nodeId) => {
                if (nodeId === rootId) {
                    return;
                }

                const nodePosition = positions.get(nodeId) || { x: 0, y: 0 };
                const level = levels.get(nodeId) || 1;
                const parentId = parentByNode.get(nodeId);
                const force = forces.get(nodeId);

                force.x += -nodePosition.x * 0.0021;
                force.y += -nodePosition.y * 0.0021;

                if (parentId) {
                    const parentPosition = positions.get(parentId) || { x: 0, y: 0 };
                    const preferredAngle = spanByNode.get(nodeId)?.center || Math.atan2(
                        nodePosition.y - parentPosition.y,
                        nodePosition.x - parentPosition.x
                    );
                    const preferredDistance = 126 + Math.min(level * 10, 28);
                    const preferredPosition = {
                        x: parentPosition.x + (Math.cos(preferredAngle) * preferredDistance),
                        y: parentPosition.y + (Math.sin(preferredAngle) * preferredDistance)
                    };

                    force.x += (preferredPosition.x - nodePosition.x) * 0.034;
                    force.y += (preferredPosition.y - nodePosition.y) * 0.034;
                }
            });

            componentIds.forEach((nodeId) => {
                const velocity = velocities.get(nodeId);

                if (nodeId === rootId) {
                    positions.set(nodeId, { x: 0, y: 0 });
                    velocity.x = 0;
                    velocity.y = 0;
                    return;
                }

                const force = forces.get(nodeId);
                velocity.x = (velocity.x + force.x) * 0.72;
                velocity.y = (velocity.y + force.y) * 0.72;

                const speed = Math.hypot(velocity.x, velocity.y);
                const maxSpeed = 11;
                if (speed > maxSpeed) {
                    velocity.x = (velocity.x / speed) * maxSpeed;
                    velocity.y = (velocity.y / speed) * maxSpeed;
                }

                const position = positions.get(nodeId) || { x: 0, y: 0 };
                positions.set(nodeId, {
                    x: position.x + velocity.x,
                    y: position.y + velocity.y
                });
            });
        }
    }

    centerComponentPositions(positions, rootId) {
        const rootPosition = positions.get(rootId) || { x: 0, y: 0 };
        if (rootPosition.x === 0 && rootPosition.y === 0) {
            return;
        }

        positions.forEach((position, nodeId) => {
            positions.set(nodeId, {
                x: position.x - rootPosition.x,
                y: position.y - rootPosition.y
            });
        });
    }

    enforceCloudBands(componentIds, positions, levels, rootId, hasCycle) {
        componentIds.forEach((nodeId) => {
            if (nodeId === rootId) {
                positions.set(nodeId, { x: 0, y: 0 });
                return;
            }

            const position = positions.get(nodeId) || { x: 0, y: 0 };
            const level = levels.get(nodeId) || 1;
            const distance = Math.max(Math.hypot(position.x, position.y), 1);
            const angle = Math.atan2(position.y, position.x);
            const minDistance = hasCycle
                ? 92 + ((level - 1) * 58)
                : 126 + ((level - 1) * 76);
            const maxDistance = hasCycle
                ? minDistance + 96
                : minDistance + 74;
            const clampedDistance = Math.max(minDistance, Math.min(maxDistance, distance));

            positions.set(nodeId, {
                x: Math.cos(angle) * clampedDistance,
                y: Math.sin(angle) * clampedDistance
            });
        });
    }

    compactComponentLayout(componentIds, positions, adjacency, elementMap, rootId) {
        const iterations = 12;
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            componentIds.forEach((nodeId) => {
                if (nodeId === rootId) {
                    return;
                }

                const position = positions.get(nodeId) || { x: 0, y: 0 };
                const neighbors = [...(adjacency.get(nodeId) || [])].filter((neighborId) => positions.has(neighborId));
                let target = { x: 0, y: 0 };

                if (neighbors.length > 0) {
                    target = neighbors.reduce((acc, neighborId) => {
                        const neighborPosition = positions.get(neighborId) || { x: 0, y: 0 };
                        return {
                            x: acc.x + neighborPosition.x,
                            y: acc.y + neighborPosition.y
                        };
                    }, { x: 0, y: 0 });
                    target.x /= neighbors.length;
                    target.y /= neighbors.length;
                }

                const size = elementMap.get(nodeId)?.size() || { width: 220, height: 150 };
                const pull = Math.max(0.05, 0.11 - (Math.max(size.width, size.height) / 2600));
                positions.set(nodeId, {
                    x: position.x + ((target.x - position.x) * pull),
                    y: position.y + ((target.y - position.y) * pull)
                });
            });

            this.resolveComponentRectOverlaps(componentIds, positions, elementMap, 14, rootId);
        }
    }

    resolveComponentRectOverlaps(componentIds, positions, elementMap, minGap = 12, pinnedNodeId = null) {
        for (let iteration = 0; iteration < 90; iteration += 1) {
            let moved = false;

            for (let i = 0; i < componentIds.length; i += 1) {
                for (let j = i + 1; j < componentIds.length; j += 1) {
                    const leftId = componentIds[i];
                    const rightId = componentIds[j];
                    const leftPosition = positions.get(leftId) || { x: 0, y: 0 };
                    const rightPosition = positions.get(rightId) || { x: 0, y: 0 };
                    const leftSize = elementMap.get(leftId)?.size() || { width: 220, height: 150 };
                    const rightSize = elementMap.get(rightId)?.size() || { width: 220, height: 150 };
                    const dx = rightPosition.x - leftPosition.x;
                    const dy = rightPosition.y - leftPosition.y;
                    const overlapX = ((leftSize.width + rightSize.width) / 2) + minGap - Math.abs(dx);
                    const overlapY = ((leftSize.height + rightSize.height) / 2) + minGap - Math.abs(dy);

                    if (overlapX <= 0 || overlapY <= 0) {
                        continue;
                    }

                    moved = true;
                    const moveAlongX = overlapX < overlapY;
                    const directionX = dx === 0 ? (leftId < rightId ? -1 : 1) : Math.sign(dx);
                    const directionY = dy === 0 ? (leftId < rightId ? -1 : 1) : Math.sign(dy);
                    const shift = moveAlongX
                        ? { x: (overlapX / 2) * directionX, y: 0 }
                        : { x: 0, y: (overlapY / 2) * directionY };

                    if (leftId === pinnedNodeId && rightId !== pinnedNodeId) {
                        positions.set(rightId, {
                            x: rightPosition.x + (shift.x * 2),
                            y: rightPosition.y + (shift.y * 2)
                        });
                        continue;
                    }

                    if (rightId === pinnedNodeId && leftId !== pinnedNodeId) {
                        positions.set(leftId, {
                            x: leftPosition.x - (shift.x * 2),
                            y: leftPosition.y - (shift.y * 2)
                        });
                        continue;
                    }

                    positions.set(leftId, {
                        x: leftPosition.x - shift.x,
                        y: leftPosition.y - shift.y
                    });
                    positions.set(rightId, {
                        x: rightPosition.x + shift.x,
                        y: rightPosition.y + shift.y
                    });
                }
            }

            if (!moved) {
                break;
            }
        }
    }

    resolveRenderedNodeOverlaps(elements, rootNodeIds = new Set()) {
        const minGap = 12;

        for (let iteration = 0; iteration < 80; iteration += 1) {
            let moved = false;

            for (let i = 0; i < elements.length; i += 1) {
                for (let j = i + 1; j < elements.length; j += 1) {
                    const left = elements[i];
                    const right = elements[j];
                    const leftPosition = left.position();
                    const rightPosition = right.position();
                    const leftSize = left.size();
                    const rightSize = right.size();
                    const leftCenter = {
                        x: leftPosition.x + (leftSize.width / 2),
                        y: leftPosition.y + (leftSize.height / 2)
                    };
                    const rightCenter = {
                        x: rightPosition.x + (rightSize.width / 2),
                        y: rightPosition.y + (rightSize.height / 2)
                    };
                    const dx = rightCenter.x - leftCenter.x;
                    const dy = rightCenter.y - leftCenter.y;
                    const overlapX = ((leftSize.width + rightSize.width) / 2) + minGap - Math.abs(dx);
                    const overlapY = ((leftSize.height + rightSize.height) / 2) + minGap - Math.abs(dy);

                    if (overlapX <= 0 || overlapY <= 0) {
                        continue;
                    }

                    moved = true;

                    const moveAlongX = overlapX < overlapY;
                    const directionX = dx === 0 ? (left.id < right.id ? -1 : 1) : Math.sign(dx);
                    const directionY = dy === 0 ? (left.id < right.id ? -1 : 1) : Math.sign(dy);
                    const shift = moveAlongX
                        ? { x: (overlapX / 2) * directionX, y: 0 }
                        : { x: 0, y: (overlapY / 2) * directionY };

                    const leftPinned = rootNodeIds.has(left.id);
                    const rightPinned = rootNodeIds.has(right.id);

                    if (leftPinned && !rightPinned) {
                        right.position(rightPosition.x + (shift.x * 2), rightPosition.y + (shift.y * 2));
                        continue;
                    }

                    if (rightPinned && !leftPinned) {
                        left.position(leftPosition.x - (shift.x * 2), leftPosition.y - (shift.y * 2));
                        continue;
                    }

                    left.position(leftPosition.x - shift.x, leftPosition.y - shift.y);
                    right.position(rightPosition.x + shift.x, rightPosition.y + shift.y);
                }
            }

            if (!moved) {
                break;
            }
        }
    }

    assignTreeSectors(nodeId, childMap, subtreeWeight, spanByNode, startAngle, endAngle) {
        const span = endAngle - startAngle;
        spanByNode.set(nodeId, {
            start: startAngle,
            end: endAngle,
            center: startAngle + (span / 2),
            span
        });

        const children = childMap.get(nodeId) || [];
        if (children.length === 0) {
            return;
        }

        const totalWeight = children.reduce((sum, childId) => sum + (subtreeWeight.get(childId) || 1), 0);
        const gap = children.length > 1
            ? Math.min(0.18, (span * 0.24) / (children.length - 1))
            : 0;
        const usableSpan = span - (gap * Math.max(children.length - 1, 0));
        let cursor = startAngle;

        children
            .slice()
            .sort((leftId, rightId) => (subtreeWeight.get(rightId) || 0) - (subtreeWeight.get(leftId) || 0))
            .forEach((childId, index) => {
                const childSpan = usableSpan * ((subtreeWeight.get(childId) || 1) / Math.max(totalWeight, 1));
                this.assignTreeSectors(childId, childMap, subtreeWeight, spanByNode, cursor, cursor + childSpan);
                cursor += childSpan + gap;
            });
    }

    resolveLayerRadius(layerIds, initialRadius, spanByNode, elementMap) {
        if (layerIds.length <= 1) {
            return initialRadius;
        }

        const orderedNodes = [...layerIds].sort(
            (leftId, rightId) => (spanByNode.get(leftId)?.center || 0) - (spanByNode.get(rightId)?.center || 0)
        );

        return orderedNodes.reduce((resolvedRadius, nodeId, index) => {
            const nextNodeId = orderedNodes[(index + 1) % orderedNodes.length];
            if (!nextNodeId) {
                return resolvedRadius;
            }

            const currentAngle = spanByNode.get(nodeId)?.center || 0;
            const nextAngle = (spanByNode.get(nextNodeId)?.center || 0) + (index === orderedNodes.length - 1 ? Math.PI * 2 : 0);
            const angleGap = Math.max(nextAngle - currentAngle, 0.18);
            const currentWidth = elementMap.get(nodeId)?.size().width || 248;
            const nextWidth = elementMap.get(nextNodeId)?.size().width || 248;
            const requiredArc = ((currentWidth + nextWidth) / 2) + 170;

            return Math.max(resolvedRadius, requiredArc / angleGap);
        }, initialRadius);
    }

    normalizeAngle(angle) {
        let normalized = angle;
        while (normalized <= -Math.PI) {
            normalized += Math.PI * 2;
        }
        while (normalized > Math.PI) {
            normalized -= Math.PI * 2;
        }
        return normalized;
    }

    getUndirectedEdgeKey(leftId, rightId) {
        return [leftId, rightId].sort().join('::');
    }

    getViewportCenter() {
        const container = document.getElementById(this.containerId);
        const width = container?.clientWidth || this.paper.options.width || 1600;
        const height = container?.clientHeight || this.paper.options.height || 900;
        return {
            x: width / 2,
            y: height / 2
        };
    }

    getComponentCenters(componentLayouts) {
        const viewportCenter = this.getViewportCenter();

        if (componentLayouts.length <= 1) {
            return [viewportCenter];
        }

        const centers = [viewportCenter];
        const spiralAngle = Math.PI * (3 - Math.sqrt(5));

        componentLayouts.slice(1).forEach((layout, index) => {
            const step = index + 1;
            const angle = (-Math.PI / 2) + (step * spiralAngle);
            let distance = componentLayouts[0].radius + layout.radius + 280 + (Math.sqrt(step) * 80);
            let candidate = {
                x: viewportCenter.x + (Math.cos(angle) * distance),
                y: viewportCenter.y + (Math.sin(angle) * distance)
            };

            while (centers.some((center, centerIndex) => {
                const otherRadius = componentLayouts[centerIndex]?.radius || componentLayouts[0].radius;
                const dx = candidate.x - center.x;
                const dy = candidate.y - center.y;
                return Math.hypot(dx, dy) < (otherRadius + layout.radius + 220);
            })) {
                distance += 90;
                candidate = {
                    x: viewportCenter.x + (Math.cos(angle) * distance),
                    y: viewportCenter.y + (Math.sin(angle) * distance)
                };
            }

            centers.push(candidate);
        });

        return centers;
    }

    setPaperTranslation(x, y, minimapMode = 'viewport') {
        this.translation = { x, y };
        this.paper.translate(x, y);
        this.scheduleMinimapUpdate(minimapMode);
    }

    scheduleMinimapUpdate(mode = 'full') {
        const priority = mode === 'full' ? 2 : 1;
        const pendingPriority = this.minimapPendingMode === 'full' ? 2 : (this.minimapPendingMode === 'viewport' ? 1 : 0);
        if (priority > pendingPriority) {
            this.minimapPendingMode = mode;
        }

        if (this.minimapUpdateFrame) {
            return;
        }

        this.minimapUpdateFrame = requestAnimationFrame(() => {
            const updateMode = this.minimapPendingMode || 'full';
            this.minimapPendingMode = null;
            this.minimapUpdateFrame = null;

            if (updateMode === 'full') {
                this.updateMinimap();
                return;
            }

            this.updateMinimapViewport();
        });
    }

    updateMinimap() {
        const minimap = document.getElementById('minimap');
        if (!minimap) {
            return;
        }

        const elements = this.graph.getElements();
        minimap.innerHTML = '';

        if (elements.length === 0) {
            minimap.innerHTML = '<div class="minimap-empty">No graph</div>';
            return;
        }

        const bbox = this.graph.getBBox(elements);
        const padding = 60;
        const bounds = {
            x: bbox.x - padding,
            y: bbox.y - padding,
            width: Math.max(bbox.width + (padding * 2), 1),
            height: Math.max(bbox.height + (padding * 2), 1)
        };

        this.minimapBounds = minimap.getBoundingClientRect();
        this.minimapContentBounds = bounds;

        const widthScale = this.minimapSize.width / bounds.width;
        const heightScale = this.minimapSize.height / bounds.height;
        const miniScale = Math.min(widthScale, heightScale);
        const offsetX = (this.minimapSize.width - (bounds.width * miniScale)) / 2;
        const offsetY = (this.minimapSize.height - (bounds.height * miniScale)) / 2;
        this.minimapMetrics = { bounds, miniScale, offsetX, offsetY };

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${this.minimapSize.width} ${this.minimapSize.height}`);
        svg.setAttribute('width', `${this.minimapSize.width}`);
        svg.setAttribute('height', `${this.minimapSize.height}`);
        svg.classList.add('minimap-svg');

        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('x', '0');
        background.setAttribute('y', '0');
        background.setAttribute('width', `${this.minimapSize.width}`);
        background.setAttribute('height', `${this.minimapSize.height}`);
        background.setAttribute('rx', '10');
        background.setAttribute('fill', 'rgba(0, 0, 0, 0.06)');
        svg.appendChild(background);

        this.graph.getLinks().forEach((link) => {
            const source = link.getSourceElement();
            const target = link.getTargetElement();

            if (!source || !target) {
                return;
            }

            const sourcePosition = source.position();
            const sourceSize = source.size();
            const targetPosition = target.position();
            const targetSize = target.size();
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${offsetX + ((sourcePosition.x + (sourceSize.width / 2) - bounds.x) * miniScale)}`);
            line.setAttribute('y1', `${offsetY + ((sourcePosition.y + (sourceSize.height / 2) - bounds.y) * miniScale)}`);
            line.setAttribute('x2', `${offsetX + ((targetPosition.x + (targetSize.width / 2) - bounds.x) * miniScale)}`);
            line.setAttribute('y2', `${offsetY + ((targetPosition.y + (targetSize.height / 2) - bounds.y) * miniScale)}`);
            line.setAttribute('stroke', 'rgba(120, 120, 120, 0.45)');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        elements.forEach((element) => {
            const position = element.position();
            const size = element.size();
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', `${offsetX + ((position.x - bounds.x) * miniScale)}`);
            rect.setAttribute('y', `${offsetY + ((position.y - bounds.y) * miniScale)}`);
            rect.setAttribute('width', `${Math.max(size.width * miniScale, 4)}`);
            rect.setAttribute('height', `${Math.max(size.height * miniScale, 4)}`);
            rect.setAttribute('rx', '2');
            rect.setAttribute('fill', 'rgba(55, 148, 255, 0.75)');
            rect.setAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
            rect.setAttribute('stroke-width', '0.8');
            svg.appendChild(rect);
        });

        this.minimapViewportRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.minimapViewportRect.setAttribute('rx', '6');
        this.minimapViewportRect.setAttribute('fill', 'rgba(255, 255, 255, 0.08)');
        this.minimapViewportRect.setAttribute('stroke', 'rgba(255, 208, 102, 0.95)');
        this.minimapViewportRect.setAttribute('stroke-width', '1.5');
        this.minimapViewportRect.setAttribute('class', 'minimap-viewport');
        svg.appendChild(this.minimapViewportRect);

        minimap.appendChild(svg);
        this.updateMinimapViewport();
    }

    updateMinimapViewport() {
        if (!this.minimapViewportRect || !this.minimapMetrics) {
            return;
        }

        const viewport = this.getVisibleGraphBounds();
        const { bounds, miniScale, offsetX, offsetY } = this.minimapMetrics;

        this.minimapViewportRect.setAttribute('x', `${offsetX + ((viewport.x - bounds.x) * miniScale)}`);
        this.minimapViewportRect.setAttribute('y', `${offsetY + ((viewport.y - bounds.y) * miniScale)}`);
        this.minimapViewportRect.setAttribute('width', `${Math.max(viewport.width * miniScale, 12)}`);
        this.minimapViewportRect.setAttribute('height', `${Math.max(viewport.height * miniScale, 12)}`);
    }

    getVisibleGraphBounds() {
        const paperWidth = this.paper.options.width || 1;
        const paperHeight = this.paper.options.height || 1;
        const scale = this.scale || 1;

        return {
            x: (-this.translation.x) / scale,
            y: (-this.translation.y) / scale,
            width: paperWidth / scale,
            height: paperHeight / scale
        };
    }

    centerViewportOnMinimapPoint(pointX, pointY) {
        if (!this.minimapContentBounds) {
            return;
        }

        const bounds = this.minimapContentBounds;
        const widthScale = this.minimapSize.width / bounds.width;
        const heightScale = this.minimapSize.height / bounds.height;
        const miniScale = Math.min(widthScale, heightScale);
        const offsetX = (this.minimapSize.width - (bounds.width * miniScale)) / 2;
        const offsetY = (this.minimapSize.height - (bounds.height * miniScale)) / 2;

        const graphX = bounds.x + ((pointX - offsetX) / miniScale);
        const graphY = bounds.y + ((pointY - offsetY) / miniScale);
        const paperWidth = this.paper.options.width || 1;
        const paperHeight = this.paper.options.height || 1;

        this.setPaperTranslation(
            (paperWidth / 2) - (graphX * this.scale),
            (paperHeight / 2) - (graphY * this.scale),
            'viewport'
        );
    }

    /**
     * 适应视图
     */
    fitToView() {
        this.paper.scaleContentToFit({
            padding: 50,
            maxScale: 1.5,
            minScale: 0.2
        });

        this.scale = this.paper.scale().sx;
        const translation = this.paper.translate();
        this.translation = {
            x: translation.tx,
            y: translation.ty
        };
        this.scheduleMinimapUpdate('viewport');
    }

    /**
     * 重置缩放
     */
    resetZoom() {
        this.scale = 1;
        this.paper.scale(1, 1);
        this.setPaperTranslation(0, 0, 'viewport');
    }

    /**
     * 重新布局
     */
    relayout() {
        this.applyLayout({ algorithm: this.defaultLayoutAlgorithm });
    }

    /**
     * 导出为 PNG
     */
    exportToPNG() {
        this.paper.toPNG((dataURL) => {
            const link = document.createElement('a');
            link.download = 'dependency-graph.png';
            link.href = dataURL;
            link.click();
        }, {
            padding: 20,
            backgroundColor: 'var(--vscode-editor-background)'
        });
    }

    /**
     * 获取元素图标
     */
    getElementIcon(kind) {
        const icons = {
            'class': '🏛️',
            'interface': '📋',
            'function': '⚡',
            'method': '🔧',
            'variable': '📦',
            'constant': '🔒',
            'property': '🏷️',
            'enum': '🎯',
            'module': '📚'
        };
        return icons[kind] || '📦';
    }

    /**
     * 获取连线颜色
     */
    getEdgeColor(type) {
        const colors = {
            'import': '#3794ff',
            'export': '#3794ff',
            'extends': '#89d185',
            'implements': '#b180d7',
            'uses': '#cccccc',
            'calls': '#f48771'
        };
        return colors[type] || '#cccccc';
    }
}

// 导出到全局
window.GraphRenderer = GraphRenderer;
