import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'graph-code-analysis.sidebar';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview();

    const triggerAnalysis = () => {
      if (webviewView.visible) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          vscode.commands.executeCommand('codeAnalysis.analyzeFolder', workspaceFolders[0].uri);
        }
      }
    };

    webviewView.onDidChangeVisibility(() => {
      triggerAnalysis();
    });

    // 首次加载也尝试触发一次
    triggerAnalysis();
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Code Analysis</title>
        <style>
          body { padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
          .container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; gap: 16px; }
          .icon { font-size: 32px; }
          button { 
            padding: 8px 12px; 
            background: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            border: none; 
            cursor: pointer; 
            border-radius: 4px;
            font-size: 14px;
          }
          button:hover { background: var(--vscode-button-hoverBackground); }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">🔍</div>
          <p>Analysis graph is opened in the main editor area.</p>
        </div>
      </body>
      </html>`;
  }
}
