import * as vscode from 'vscode';
import { PluginManager } from './core/PluginManager';
import { TypeScriptAnalyzer } from './plugins/typescript/TypeScriptAnalyzer';
import { analyzeFolderCommand, openGraphCommand } from './commands';

/**
 * 扩展激活时调用
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Code Analysis extension is now active!');

    // 初始化插件管理器
    const pluginManager = PluginManager.getInstance();

    // 注册内置语言分析器
    pluginManager.registerAnalyzer(new TypeScriptAnalyzer());

    // 注册命令
    const analyzeFolderCmd = vscode.commands.registerCommand(
        'codeAnalysis.analyzeFolder',
        () => analyzeFolderCommand(context)
    );

    const openGraphCmd = vscode.commands.registerCommand(
        'codeAnalysis.openGraph',
        () => openGraphCommand(context)
    );

    context.subscriptions.push(analyzeFolderCmd, openGraphCmd);

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('codeAnalysis')) {
                console.log('Code Analysis configuration changed');
                // TODO: 重新加载配置
            }
        })
    );

    // 监听文件变化（用于增量更新）
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,vue}');

    fileWatcher.onDidChange((uri) => {
        console.log('File changed:', uri.fsPath);
        // TODO: 增量更新分析结果
    });

    fileWatcher.onDidCreate((uri) => {
        console.log('File created:', uri.fsPath);
        // TODO: 分析新文件
    });

    fileWatcher.onDidDelete((uri) => {
        console.log('File deleted:', uri.fsPath);
        // TODO: 从图中移除节点
    });

    context.subscriptions.push(fileWatcher);

    console.log('Code Analysis extension activated successfully!');
}

/**
 * 扩展停用时调用
 */
export function deactivate() {
    console.log('Code Analysis extension is now deactivated');
}
