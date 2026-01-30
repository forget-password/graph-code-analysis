import * as vscode from 'vscode';
import { CodeElement, FileAnalysisResult } from '../types';

/**
 * 语言分析器接口
 * 所有语言插件必须实现此接口
 */
export interface ILanguageAnalyzer {
    /**
     * 分析器 ID
     */
    readonly id: string;

    /**
     * 分析器名称
     */
    readonly name: string;

    /**
     * 支持的文件扩展名
     */
    readonly supportedExtensions: string[];

    /**
     * 分析文件
     * @param filePath 文件路径
     * @param document VSCode 文档对象
     * @returns 文件分析结果
     */
    analyzeFile(filePath: string, document: vscode.TextDocument): Promise<FileAnalysisResult>;

    /**
     * 查找引用关系
     * @param element 代码元素
     * @returns 引用位置列表
     */
    findReferences(element: CodeElement): Promise<vscode.Location[]>;

    /**
     * 查找定义
     * @param document 文档
     * @param position 位置
     * @returns 定义位置列表
     */
    findDefinitions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]>;

    /**
     * 是否支持该文件
     * @param filePath 文件路径
     * @returns 是否支持
     */
    supportsFile(filePath: string): boolean;
}
