import * as vscode from 'vscode';
import * as path from 'path';
import { ILanguageAnalyzer } from '../../core/analyzer/ILanguageAnalyzer';
import { CodeElement, FileAnalysisResult } from '../../core/types';

/**
 * 语言分析器基类
 * 提供通用功能实现
 */
export abstract class BaseLanguageAnalyzer implements ILanguageAnalyzer {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly supportedExtensions: string[];

    /**
     * 检查文件是否支持
     */
    supportsFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.includes(ext);
    }

    /**
     * 分析文件（子类必须实现）
     */
    abstract analyzeFile(
        filePath: string,
        content: string
    ): Promise<FileAnalysisResult>;

    /**
     * 查找引用（使用 VSCode 内置功能）
     */
    async findReferences(element: CodeElement): Promise<vscode.Location[]> {
        const uri = vscode.Uri.file(element.filePath);
        const position = element.range.start;

        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                position
            );
            return locations || [];
        } catch (error) {
            console.error('Error finding references:', error);
            return [];
        }
    }

    /**
     * 查找定义（使用 VSCode 内置功能）
     */
    async findDefinitions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                document.uri,
                position
            );
            return locations || [];
        } catch (error) {
            console.error('Error finding definitions:', error);
            return [];
        }
    }

    /**
     * 获取文档符号（通用方法）
     */
    protected async getDocumentSymbols(
        document: vscode.TextDocument
    ): Promise<vscode.DocumentSymbol[]> {
        const maxRetries = 3;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    document.uri
                );

                if (symbols && symbols.length > 0) {
                    return symbols;
                }

                // 如果结果为空，等待后重试（除最后一次尝试外）
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error(`Error getting document symbols (attempt ${i + 1}):`, error);

                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        return [];
    }

    /**
     * 生成唯一 ID
     */
    protected generateId(filePath: string, name: string, kind: string): string {
        return `${filePath}#${kind}#${name}`;
    }
}
