/**
 * 图形渲染器
 * 使用 JointJS 渲染代码依赖关系图
 */
class GraphRenderer {
    constructor(containerId) {
        this.namespace = joint.shapes;

        // 创建图模型
        this.graph = new joint.dia.Graph({}, { cellNamespace: this.namespace });

        // 创建画布
        this.paper = new joint.dia.Paper({
            el: document.getElementById(containerId),
            model: this.graph,
            width: '100%',
            height: '100%',
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

        // 当前缩放级别
        this.scale = 1;
    }

    /**
     * 设置平移和缩放
     */
    setupPanAndZoom() {
        let isPanning = false;
        let startPoint = { x: 0, y: 0 };

        // 鼠标滚轮缩放
        this.paper.on('blank:mousewheel', (evt, x, y, delta) => {
            evt.preventDefault();

            const oldScale = this.scale;
            const newScale = delta > 0 ? oldScale * 1.1 : oldScale * 0.9;

            // 限制缩放范围
            this.scale = Math.max(0.2, Math.min(3, newScale));

            this.paper.scale(this.scale, this.scale);
        });

        // 空白处拖拽平移
        this.paper.on('blank:pointerdown', (evt, x, y) => {
            isPanning = true;
            startPoint = { x: evt.clientX, y: evt.clientY };
            this.paper.$el.css('cursor', 'grabbing');
        });

        this.paper.on('blank:pointermove', (evt) => {
            if (!isPanning) return;

            const dx = evt.clientX - startPoint.x;
            const dy = evt.clientY - startPoint.y;

            this.paper.translate(dx, dy);

            startPoint = { x: evt.clientX, y: evt.clientY };
        });

        this.paper.on('blank:pointerup', () => {
            isPanning = false;
            this.paper.$el.css('cursor', 'default');
        });
    }

    /**
     * 设置事件监听
     */
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

        // 元素内部点击（代码元素）
        this.paper.on('element:pointerdblclick', (elementView, evt) => {
            const element = elementView.model;
            const elements = element.get('elements');

            if (elements && elements.length > 0) {
                // 获取点击位置对应的元素
                const bbox = elementView.getBBox();
                const relativeY = evt.clientY - bbox.y;
                const headerHeight = 40;
                const itemHeight = 30;

                if (relativeY > headerHeight) {
                    const index = Math.floor((relativeY - headerHeight) / itemHeight);
                    const codeElement = elements[index];

                    if (codeElement) {
                        vscode.postMessage({
                            type: 'elementClicked',
                            data: {
                                filePath: codeElement.filePath,
                                line: codeElement.range.start.line,
                                character: codeElement.range.start.character
                            }
                        });
                    }
                }
            }
        });
    }

    /**
     * 渲染图数据
     */
    renderGraph(graphData) {
        // 清空现有图
        this.graph.clear();

        if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
            console.log('No graph data to render');
            return;
        }

        const cells = [];

        // 创建节点
        const nodeMap = new Map();
        graphData.nodes.forEach(nodeData => {
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

        // 应用布局
        this.applyLayout(graphData.layout);
    }

    /**
   * 创建节点
   */
    createNode(nodeData) {
        const fileName = nodeData.label;
        const elements = nodeData.elements || [];

        // 计算节点高度 - 增加尺寸
        const headerHeight = 45;
        const itemHeight = 35;
        const padding = 15;
        const nodeHeight = headerHeight + (elements.length * itemHeight) + padding;
        const nodeWidth = 300; // 增加宽度

        // 创建节点内容 HTML
        const elementsHtml = elements
            .filter(el => el.isExported !== false)
            .map(el => {
                const icon = this.getElementIcon(el.kind);
                return `<div class="code-element" style="padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border);">
          <span style="margin-right: 8px; font-size: 16px;">${icon}</span>
          <span style="color: var(--vscode-editor-foreground); font-size: 13px;">${el.name}</span>
          <span style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: 8px;">(${el.kind})</span>
        </div>`;
            })
            .join('');

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
                            borderBottom: '2px solid var(--vscode-panel-border)',
                            backgroundColor: 'var(--vscode-sideBar-background)',
                            color: 'var(--vscode-sideBarTitle-foreground)',
                            fontSize: '14px',
                            borderTopLeftRadius: '5px',
                            borderTopRightRadius: '5px'
                        }
                    }, {
                        tagName: 'div',
                        innerHTML: elementsHtml || '<div style="padding: 12px; color: var(--vscode-descriptionForeground);">No exports</div>',
                        style: {
                            maxHeight: (nodeHeight - headerHeight) + 'px',
                            overflow: 'auto'
                        }
                    }]
                }]
            }]
        });

        // 保存节点数据
        node.set('nodeId', nodeData.id);
        node.set('elements', elements);

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
            router: { name: 'manhattan' },
            connector: { name: 'rounded' },
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
        if (!layoutConfig || layoutConfig.algorithm !== 'dagre') {
            // 如果没有指定布局或不是 dagre，使用默认位置
            return;
        }

        // 使用 Dagre 布局 - 增加间距
        joint.layout.DirectedGraph.layout(this.graph, {
            nodeSep: 100,      // 增加节点水平间距
            edgeSep: 100,      // 增加边间距
            rankSep: 150,      // 增加层级间距
            rankDir: layoutConfig.direction || 'TB',
            marginX: 80,       // 增加左右边距
            marginY: 80        // 增加上下边距
        });
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
    }

    /**
     * 重置缩放
     */
    resetZoom() {
        this.scale = 1;
        this.paper.scale(1, 1);
        this.paper.translate(0, 0);
    }

    /**
     * 重新布局
     */
    relayout() {
        this.applyLayout({ algorithm: 'dagre', direction: 'TB' });
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
