import * as vscode from 'vscode';
import { CodeAnalyzer } from '../core/analyzer/CodeAnalyzer';
import { GraphViewPanel } from '../view/panel/GraphViewPanel';

/**
 * 分析文件夹命令
 */
export async function analyzeFolderCommand(context: vscode.ExtensionContext): Promise<void> {
    // 选择文件夹
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Folder to Analyze',
    });

    if (!folderUri || folderUri.length === 0) {
        return;
    }

    const folderPath = folderUri[0].fsPath;

    // 显示进度
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing code...',
            cancellable: false,
        },
        async (progress) => {
            const analyzer = new CodeAnalyzer();

            // 分析文件夹
            const graphData = await analyzer.analyzeFolder(folderPath, (percent, message) => {
                progress.report({ increment: percent, message });
            });

            // 打开图形视图
            GraphViewPanel.createOrShow(context, graphData);

            vscode.window.showInformationMessage(
                `Analysis complete! Found ${graphData.nodes.length} files with ${graphData.edges.length} dependencies.`
            );
        }
    );
}

/**
 * 打开图形视图命令
 */
export function openGraphCommand(context: vscode.ExtensionContext): void {
    GraphViewPanel.createOrShow(context);
}
