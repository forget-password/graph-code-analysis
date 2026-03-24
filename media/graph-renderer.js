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

            this.setPaperTranslation(startTranslation.x + dx, startTranslation.y + dy);
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

        // 鼠标滚轮缩放
        this.paper.on('blank:mousewheel', (evt, x, y, delta) => {
            evt.preventDefault();

            const oldScale = this.scale;
            const newScale = delta > 0 ? oldScale * 1.1 : oldScale * 0.9;

            // 限制缩放范围
            this.scale = Math.max(0.2, Math.min(3, newScale));

            this.paper.scale(this.scale, this.scale);
            this.scheduleMinimapUpdate();
        });

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
                this.scheduleMinimapUpdate();
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
            this.scheduleMinimapUpdate();
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
        this.scheduleMinimapUpdate();
    }


    /**
     * 创建节点
     */
    createNode(nodeData) {
        const fileName = nodeData.label;
        const elements = nodeData.elements || [];

        console.log(`Creating node for ${fileName}:`);
        console.log(`  - Elements count: ${elements.length}`);

        // 详细打印前几个元素，检查属性
        if (elements.length > 0) {
            console.log(`  - First element:`, JSON.stringify(elements[0], null, 2));
        }

        console.log(`  - Position:`, nodeData.position);

        // 计算节点高度 - 控制最大高度，避免出现超长矩形卡片
        const headerHeight = 45;
        const itemHeight = 35;
        const padding = 15;
        const maxContentHeight = 280;
        const contentHeight = Math.min((elements.length * itemHeight) + padding, maxContentHeight);
        const nodeHeight = headerHeight + contentHeight;
        const nodeWidth = 280;

        console.log(`  - Node size: ${nodeWidth}x${nodeHeight}`);

        // 创建节点内容 HTML - 显示所有元素，不过滤
        const elementsHtml = elements
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

        console.log(`  - Generated HTML length: ${elementsHtml.length}`);
        if (elementsHtml.length < 200) {
            console.log(`  - Generated HTML: ${elementsHtml}`);
        } else {
            console.log(`  - Generated HTML (first 200 chars): ${elementsHtml.substring(0, 200)}...`);
        }

        console.log(`  - Total elements to display: ${elements.length}`);

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
        node.set('htmlContent', elementsHtml || '<div style="padding: 12px; color: #666666;">No elements</div>');

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

        const components = this.getConnectedComponents(elements.map((element) => element.id), adjacency)
            .sort((left, right) => right.length - left.length);

        const componentLayouts = components.map((componentIds) =>
            this.buildRadialComponentLayout(componentIds, adjacency, elementMap)
        );

        const centers = this.getComponentCenters(componentLayouts);

        componentLayouts.forEach((layout, index) => {
            const center = centers[index];

            layout.positions.forEach((relativePosition, cellId) => {
                const element = elementMap.get(cellId);
                if (!element) {
                    return;
                }

                const size = element.size();
                element.position(
                    center.x + relativePosition.x - (size.width / 2),
                    center.y + relativePosition.y - (size.height / 2)
                );
            });
        });

        this.scheduleMinimapUpdate();
    }

    applyEdgeStyle(style) {
        this.graph.getLinks().forEach((link) => {
            link.vertices([]);

            if (style === 'dagre') {
                link.set('router', {
                    name: 'manhattan',
                    args: {
                        padding: 30
                    }
                });
                link.set('connector', { name: 'rounded' });
                link.attr('line/strokeOpacity', 1);
                link.attr('line/strokeWidth', 2);
                return;
            }

            link.unset('router');
            link.set('connector', { name: 'smooth' });
            link.attr('line/strokeOpacity', 0.78);
            link.attr('line/strokeWidth', 1.6);
        });
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

        const levels = new Map([[rootId, 0]]);
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

        const positions = new Map();
        const placedAngles = new Map();
        positions.set(rootId, { x: 0, y: 0 });
        placedAngles.set(rootId, -Math.PI / 2);

        [...layerMap.keys()]
            .sort((left, right) => left - right)
            .filter((level) => level > 0)
            .forEach((level) => {
                const layerIds = layerMap.get(level);
                const orderedIds = this.orderLayerNodes(layerIds, adjacency, placedAngles);
                const radius = this.getLayerRadius(level, orderedIds, elementMap);
                const angleStep = (Math.PI * 2) / Math.max(orderedIds.length, 1);
                const baseOffset = level % 2 === 0 ? angleStep / 2 : 0;

                orderedIds.forEach((nodeId, index) => {
                    const evenlySpacedAngle = (-Math.PI / 2) + baseOffset + (index * angleStep);
                    const preferredAngle = this.getPreferredAngle(nodeId, adjacency, placedAngles);
                    const angle = Number.isFinite(preferredAngle)
                        ? this.interpolateAngle(evenlySpacedAngle, preferredAngle, 0.35)
                        : evenlySpacedAngle;

                    placedAngles.set(nodeId, this.normalizeAngle(angle));
                    positions.set(nodeId, {
                        x: Math.cos(angle) * radius,
                        y: Math.sin(angle) * radius
                    });
                });
            });

        const radius = componentIds.reduce((maxRadius, nodeId) => {
            const position = positions.get(nodeId) || { x: 0, y: 0 };
            const size = elementMap.get(nodeId)?.size() || { width: 280, height: 220 };
            return Math.max(maxRadius, Math.hypot(position.x, position.y) + (Math.max(size.width, size.height) / 2));
        }, 0);

        return { positions, radius };
    }

    orderLayerNodes(layerIds, adjacency, placedAngles) {
        return [...layerIds].sort((leftId, rightId) => {
            const leftAngle = this.getPreferredAngle(leftId, adjacency, placedAngles);
            const rightAngle = this.getPreferredAngle(rightId, adjacency, placedAngles);

            if (Number.isFinite(leftAngle) && Number.isFinite(rightAngle) && leftAngle !== rightAngle) {
                return leftAngle - rightAngle;
            }

            return (adjacency.get(rightId)?.size || 0) - (adjacency.get(leftId)?.size || 0);
        });
    }

    getLayerRadius(level, layerIds, elementMap) {
        const maxWidth = layerIds.reduce((max, nodeId) => {
            const width = elementMap.get(nodeId)?.size().width || 280;
            return Math.max(max, width);
        }, 280);
        const maxHeight = layerIds.reduce((max, nodeId) => {
            const height = elementMap.get(nodeId)?.size().height || 220;
            return Math.max(max, height);
        }, 220);

        const circumferenceRadius = (layerIds.length * (maxWidth + 120)) / (2 * Math.PI);
        const radialRadius = level * Math.max(maxHeight + 140, 360);
        return Math.max(circumferenceRadius, radialRadius, 260);
    }

    getPreferredAngle(nodeId, adjacency, placedAngles) {
        const neighborAngles = [...(adjacency.get(nodeId) || [])]
            .filter((neighborId) => placedAngles.has(neighborId))
            .map((neighborId) => placedAngles.get(neighborId));

        if (neighborAngles.length === 0) {
            return Number.NaN;
        }

        return this.averageAngles(neighborAngles);
    }

    averageAngles(angles) {
        const vector = angles.reduce((result, angle) => ({
            x: result.x + Math.cos(angle),
            y: result.y + Math.sin(angle)
        }), { x: 0, y: 0 });

        return Math.atan2(vector.y, vector.x);
    }

    interpolateAngle(fromAngle, toAngle, weight) {
        const shortestDelta = Math.atan2(
            Math.sin(toAngle - fromAngle),
            Math.cos(toAngle - fromAngle)
        );

        return fromAngle + (shortestDelta * weight);
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

    getComponentCenters(componentLayouts) {
        const container = document.getElementById(this.containerId);
        const width = container?.clientWidth || this.paper.options.width || 1600;
        const height = container?.clientHeight || this.paper.options.height || 900;
        const viewportCenter = {
            x: width / 2,
            y: height / 2
        };

        if (componentLayouts.length <= 1) {
            return [viewportCenter];
        }

        const centers = [viewportCenter];
        const orbitCount = componentLayouts.length - 1;
        const orbitBaseRadius = Math.max(componentLayouts[0].radius + 420, 760);

        componentLayouts.slice(1).forEach((layout, index) => {
            const angle = (-Math.PI / 2) + ((index * Math.PI * 2) / orbitCount);
            const distance = orbitBaseRadius + (layout.radius * 0.65);

            centers.push({
                x: viewportCenter.x + (Math.cos(angle) * distance),
                y: viewportCenter.y + (Math.sin(angle) * distance)
            });
        });

        return centers;
    }

    setPaperTranslation(x, y) {
        this.translation = { x, y };
        this.paper.translate(x, y);
        this.scheduleMinimapUpdate();
    }

    scheduleMinimapUpdate() {
        if (this.minimapUpdateFrame) {
            cancelAnimationFrame(this.minimapUpdateFrame);
        }

        this.minimapUpdateFrame = requestAnimationFrame(() => {
            this.minimapUpdateFrame = null;
            this.updateMinimap();
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
        const viewport = this.getVisibleGraphBounds();

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

        const viewportRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        viewportRect.setAttribute('x', `${offsetX + ((viewport.x - bounds.x) * miniScale)}`);
        viewportRect.setAttribute('y', `${offsetY + ((viewport.y - bounds.y) * miniScale)}`);
        viewportRect.setAttribute('width', `${Math.max(viewport.width * miniScale, 12)}`);
        viewportRect.setAttribute('height', `${Math.max(viewport.height * miniScale, 12)}`);
        viewportRect.setAttribute('rx', '6');
        viewportRect.setAttribute('fill', 'rgba(255, 255, 255, 0.08)');
        viewportRect.setAttribute('stroke', 'rgba(255, 208, 102, 0.95)');
        viewportRect.setAttribute('stroke-width', '1.5');
        viewportRect.setAttribute('class', 'minimap-viewport');
        svg.appendChild(viewportRect);

        minimap.appendChild(svg);
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
            (paperHeight / 2) - (graphY * this.scale)
        );
    }

    /**
     * 适应视图
     */
    fitToView() {
        console.log('fitToView called');
        const bbox = this.graph.getBBox();
        console.log('Graph bounding box:', bbox);

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
        console.log('After fitToView, scale:', this.scale);
        this.scheduleMinimapUpdate();
    }

    /**
     * 重置缩放
     */
    resetZoom() {
        this.scale = 1;
        this.paper.scale(1, 1);
        this.setPaperTranslation(0, 0);
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
