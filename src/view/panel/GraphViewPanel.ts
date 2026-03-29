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
            GraphViewPanel.currentPanel.refreshWebview();
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
        if (data.nodeId.startsWith('external:')) {
            vscode.window.showInformationMessage(`External dependency: ${data.nodeId.replace(/^external:[^:]+:/, '')}`);
            return;
        }

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

    private refreshWebview(): void {
        this.update();
        if (this.graphData) {
            this.panel.webview.postMessage({
                type: 'updateGraph',
                data: this.graphData,
            });
        }
    }

    /**
   * 获取 HTML 内容
   */
    private getHtmlContent(): string {
        const webview = this.panel.webview;

        // 获取资源 URI
        const cacheBuster = `v=${Date.now()}`;
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'graph-app.css')
        ).with({ query: cacheBuster });
        const graphAppUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'graph-app.js')
        ).with({ query: cacheBuster });

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
      script-src 'nonce-${nonce}' ${webview.cspSource};
      img-src ${webview.cspSource} data:;
      font-src ${webview.cspSource};
    ">
    <title>Code Dependency Graph</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${graphAppUri}"></script>
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
