import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { analyzeFolderCommand, openGraphCommand } from './commands';
import { LanguageConfigManager } from './config/LanguageConfigManager';
import { LanguageRuleConfig } from './config/types';
import { PluginManager } from './core/PluginManager';
import { ConfigurableRegexAnalyzer } from './plugins/configurable/ConfigurableRegexAnalyzer';
import { TypeScriptAnalyzer } from './plugins/typescript/TypeScriptAnalyzer';
import { SidebarProvider } from './view/SidebarProvider';

let activeFileWatcher: vscode.FileSystemWatcher | undefined;

/**
 * 扩展激活时调用
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Code Analysis extension is now active!');

    // 注册左侧边栏 SidebarProvider
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
    );

    let languageConfigManager = createLanguageConfigManager();
    await reloadLanguageAnalyzers(languageConfigManager);
    await rebuildFileWatcher();
    // 注册命令
    const analyzeFolderCmd = vscode.commands.registerCommand('codeAnalysis.analyzeFolder', (uri?: vscode.Uri) => analyzeFolderCommand(context, uri));
    const openGraphCmd = vscode.commands.registerCommand('codeAnalysis.openGraph', () => openGraphCommand(context));

    const openLanguageConfigCmd = vscode.commands.registerCommand(
        'codeAnalysis.openLanguageConfig',
        async () => {
            languageConfigManager = createLanguageConfigManager();
            await languageConfigManager.ensureConfigFile();
            const document = await vscode.workspace.openTextDocument(languageConfigManager.getConfigPath());
            await vscode.window.showTextDocument(document);
        }
    );

    const reloadLanguageConfigCmd = vscode.commands.registerCommand(
        'codeAnalysis.reloadLanguageConfig',
        async () => {
            languageConfigManager = createLanguageConfigManager();
            await reloadLanguageAnalyzers(languageConfigManager);
            await rebuildFileWatcher();
            vscode.window.showInformationMessage('Code Analysis language config reloaded');
        }
    );

    context.subscriptions.push(
        analyzeFolderCmd,
        openGraphCmd,
        openLanguageConfigCmd,
        reloadLanguageConfigCmd
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!event.affectsConfiguration('codeAnalysis')) {
                return;
            }

            languageConfigManager = createLanguageConfigManager();
            await reloadLanguageAnalyzers(languageConfigManager);
            await rebuildFileWatcher();
            console.log('Code Analysis configuration changed and reloaded');
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const currentManager = createLanguageConfigManager();
            if (document.uri.fsPath !== currentManager.getConfigPath()) {
                return;
            }

            languageConfigManager = currentManager;
            await reloadLanguageAnalyzers(languageConfigManager);
            await rebuildFileWatcher();
            vscode.window.showInformationMessage('Code Analysis language config reloaded from home config');
        })
    );

    if (activeFileWatcher) {
        context.subscriptions.push(activeFileWatcher);
    }

    console.log('Code Analysis extension activated successfully!');
}

function createLanguageConfigManager(): LanguageConfigManager {
    const configuration = vscode.workspace.getConfiguration('codeAnalysis');
    const customConfigPath = configuration.get<string>('languageConfigPath');
    return new LanguageConfigManager(customConfigPath || undefined);
}

async function reloadLanguageAnalyzers(configManager: LanguageConfigManager): Promise<void> {
    const pluginManager = PluginManager.getInstance();
    const languageConfig = await configManager.loadConfig();

    pluginManager.clear();

    languageConfig.languages
        .filter((language) => language.enabled !== false)
        .forEach((language) => registerLanguage(pluginManager, language));

    console.log(
        `Loaded ${pluginManager.getAllAnalyzers().length} analyzers from ${configManager.getConfigPath()}`
    );
}

function registerLanguage(pluginManager: PluginManager, language: LanguageRuleConfig): void {
    if (language.analyzer === 'typescript') {
        pluginManager.registerAnalyzer(new TypeScriptAnalyzer(language), {
            id: language.id,
            name: language.name,
            extensions: language.extensions,
            enabled: language.enabled !== false,
            config: language,
        });
        return;
    }

    pluginManager.registerAnalyzer(new ConfigurableRegexAnalyzer(language), {
        id: language.id,
        name: language.name,
        extensions: language.extensions,
        enabled: language.enabled !== false,
        config: language,
    });
}

async function rebuildFileWatcher(): Promise<void> {
    activeFileWatcher?.dispose();

    const pluginManager = PluginManager.getInstance();
    const supportedExtensions = pluginManager.getSupportedExtensions();

    if (supportedExtensions.length === 0) {
        activeFileWatcher = undefined;
        return;
    }

    activeFileWatcher = vscode.workspace.createFileSystemWatcher(
        createWatcherGlob(supportedExtensions)
    );

    activeFileWatcher.onDidChange((uri) => {
        console.log('File changed:', uri.fsPath);
        // TODO: 增量更新分析结果
    });

    activeFileWatcher.onDidCreate((uri) => {
        console.log('File created:', uri.fsPath);
        // TODO: 分析新文件
    });

    activeFileWatcher.onDidDelete((uri) => {
        console.log('File deleted:', uri.fsPath);
        // TODO: 从图中移除节点
    });
}

function createWatcherGlob(extensions: string[]): string {
    const normalizedExtensions = Array.from(
        new Set(
            extensions
                .map((extension) => extension.replace(/^\./, '').trim())
                .filter(Boolean)
        )
    );

    if (normalizedExtensions.length === 1) {
        return `**/*.${normalizedExtensions[0]}`;
    }

    return `**/*.{${normalizedExtensions.join(',')}}`;
}

/**
 * 扩展停用时调用
 */
export function deactivate() {
    activeFileWatcher?.dispose();
    console.log('Code Analysis extension is now deactivated');
}
