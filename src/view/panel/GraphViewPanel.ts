import * as vscode from 'vscode';
import { GraphData } from '../../core/types';

/**
 * 图形视图面板
 */
export class GraphViewPanel {
    public static currentPanel: GraphViewPanel | undefined;
    private static readonly viewType = 'codeAnalysisGraph';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly context: vscode.ExtensionContext;
    private disposables: vscode.Disposable[] = [];
    private graphData: GraphData | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;

        // 设置 webview 内容
        this.update();

        // 监听面板关闭
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // 处理来自 webview 的消息
        this.panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message),
            null,
            this.disposables
        );
    }

    /**
     * 创建或显示面板
     */
    public static createOrShow(context: vscode.ExtensionContext, graphData?: GraphData): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已存在面板，则显示它
        if (GraphViewPanel.currentPanel) {
            GraphViewPanel.currentPanel.panel.reveal(column);
            if (graphData) {
                GraphViewPanel.currentPanel.updateGraphData(graphData);
            }
            return;
        }

        // 创建新面板
        const panel = vscode.window.createWebviewPanel(
            GraphViewPanel.viewType,
            'Code Dependency Graph',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
            }
        );

        GraphViewPanel.currentPanel = new GraphViewPanel(panel, context.extensionUri, context);
        if (graphData) {
            GraphViewPanel.currentPanel.updateGraphData(graphData);
        }
    }

    /**
     * 更新图数据
     */
    public updateGraphData(graphData: GraphData): void {
        console.log('GraphViewPanel.updateGraphData called with:', graphData);
        this.graphData = graphData;
        this.panel.webview.postMessage({
            type: 'updateGraph',
            data: graphData,
        });
        console.log('Posted updateGraph message to webview');
    }

    /**
     * 处理来自 webview 的消息
     */
    private async handleMessage(message: any): Promise<void> {
        console.log(`[GraphViewPanel] Received message: ${message.type}`, message.data);
        switch (message.type) {
            case 'nodeClicked':
                console.log('[GraphViewPanel] Handling nodeClicked...');
                await this.handleNodeClick(message.data);
                break;
            case 'elementClicked':
                await this.handleElementClick(message.data);
                break;
            case 'saveLayout':
                this.handleSaveLayout(message.data);
                break;
            case 'ready':
                // Webview 已准备好，发送图数据
                if (this.graphData) {
                    this.updateGraphData(this.graphData);
                }
                break;
        }
    }

    /**
     * 处理节点点击
     */
    private async handleNodeClick(data: { nodeId: string }): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(data.nodeId);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${data.nodeId}`);
        }
    }

    /**
     * 处理元素点击
     */
    private async handleElementClick(data: {
        filePath: string;
        line: number;
        character: number;
    }): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(data.filePath);
            const editor = await vscode.window.showTextDocument(document);

            const position = new vscode.Position(data.line, data.character);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to navigate to element`);
        }
    }

    /**
     * 处理保存布局
     */
    private async handleSaveLayout(data: any): Promise<void> {
        if (!this.context) {
            console.warn('No context available for saving layout');
            return;
        }

        try {
            // 保存布局数据到工作区状态
            await this.context.workspaceState.update('graphLayout', {
                nodes: data.nodes,
                scale: data.scale,
                center: data.center,
                timestamp: Date.now()
            });

            vscode.window.showInformationMessage('Graph layout saved');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save graph layout');
            console.error('Error saving layout:', error);
        }
    }

    /**
     * 加载保存的布局
     */
    private async loadSavedLayout(): Promise<any | undefined> {
        if (!this.context) {
            return undefined;
        }

        try {
            const layout = this.context.workspaceState.get('graphLayout');
            return layout;
        } catch (error) {
            console.error('Error loading layout:', error);
            return undefined;
        }
    }

    /**
     * 更新 webview 内容
     */
    private update(): void {
        this.panel.webview.html = this.getHtmlContent();
    }

    /**
   * 获取 HTML 内容
   */
    private getHtmlContent(): string {
        const webview = this.panel.webview;

        // 获取资源 URI
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
        );
        const graphRendererUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'graph-renderer.js')
        );
        const searchFilterUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'search-filter.js')
        );
        const contextMenuUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'context-menu.js')
        );

        // 生成 nonce 用于 CSP
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;
      img-src ${webview.cspSource} data:;
      font-src ${webview.cspSource};
    ">
    <title>Code Dependency Graph</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
    <div id="toolbar">
        <button id="fit-btn" title="Fit to View">🔍 Fit</button>
        <button id="reset-zoom-btn" title="Reset Zoom">↺ Reset Zoom</button>
        <button id="relayout-btn" title="Re-layout Graph">📐 Layout</button>
        <button id="export-btn" title="Export as PNG">💾 Export</button>
    </div>
    
    <div id="info-panel">
        <div class="stat"><span class="stat-label">Nodes:</span> <span id="node-count">0</span></div>
        <div class="stat"><span class="stat-label">Edges:</span> <span id="edge-count">0</span></div>
        <div class="stat"><span class="stat-label">Zoom:</span> <span id="zoom-level">100%</span></div>
    </div>

    <div id="minimap-panel">
        <div id="minimap"></div>
    </div>

    <div id="graph-container">
        <div id="loading">
            <div class="spinner"></div>
            <div>Loading graph...</div>
        </div>
    </div>

    <!-- Load JointJS and dependencies from CDN -->
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/backbone.js/1.4.1/backbone-min.js"></script>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/jointjs/3.7.7/joint.min.js"></script>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/graphlib/2.1.8/graphlib.min.js"></script>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
    
    <!-- Load custom graph renderer -->
    <script nonce="${nonce}" src="${graphRendererUri}"></script>
    <script nonce="${nonce}" src="${searchFilterUri}"></script>
    <script nonce="${nonce}" src="${contextMenuUri}"></script>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let graphRenderer = null;
        let searchFilter = null;
        let contextMenu = null;
        let graphData = null;

        // 初始化
        function init() {
            // 等待 JointJS 加载完成
            if (typeof joint === 'undefined') {
                setTimeout(init, 100);
                return;
            }

            // 创建图形渲染器
            graphRenderer = new GraphRenderer('graph-container');
            
            // 创建搜索过滤器
            searchFilter = new SearchFilter(graphRenderer);
            
            // 创建右键菜单
            contextMenu = new ContextMenu(graphRenderer);
            
            // 隐藏加载提示
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            // 绑定工具栏事件
            setupToolbar();

            // 通知扩展已准备好
            vscode.postMessage({ type: 'ready' });
        }

        // 设置工具栏
        function setupToolbar() {
            document.getElementById('fit-btn').addEventListener('click', () => {
                if (graphRenderer) {
                    graphRenderer.fitToView();
                    updateZoomLevel();
                }
            });

            document.getElementById('reset-zoom-btn').addEventListener('click', () => {
                if (graphRenderer) {
                    graphRenderer.resetZoom();
                    updateZoomLevel();
                }
            });

            document.getElementById('relayout-btn').addEventListener('click', () => {
                if (graphRenderer) {
                    graphRenderer.relayout();
                }
            });

            document.getElementById('export-btn').addEventListener('click', () => {
                if (graphRenderer) {
                    graphRenderer.exportToPNG();
                }
            });
        }

        // 更新缩放级别显示
        function updateZoomLevel() {
            if (graphRenderer) {
                const zoom = Math.round(graphRenderer.scale * 100);
                document.getElementById('zoom-level').textContent = zoom + '%';
            }
        }

        // 接收来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateGraph':
                    graphData = message.data;
                    renderGraph(graphData);
                    break;
            }
        });

        // 渲染图
        function renderGraph(data) {
            if (!graphRenderer) {
                console.error('Graph renderer not initialized');
                return;
            }

            console.log('Rendering graph with data:', data);
            
            // 渲染图
            graphRenderer.renderGraph(data);

            // 更新统计信息
            document.getElementById('node-count').textContent = data.nodes.length;
            document.getElementById('edge-count').textContent = data.edges.length;

            // 自动适应视图
            setTimeout(() => {
                graphRenderer.fitToView();
                updateZoomLevel();
            }, 100);
        }

        // 启动
        init();
    </script>
</body>
</html>`;
    }

    /**
     * 生成随机 nonce
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    /**
     * 释放资源
     */
    public dispose(): void {
        GraphViewPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
