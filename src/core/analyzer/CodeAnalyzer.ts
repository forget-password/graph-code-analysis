import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PluginManager } from '../PluginManager';
import { FileAnalysisResult, GraphData, GraphNode, GraphEdge, DependencyType } from '../types';

/**
 * 代码分析器
 * 负责分析整个文件夹的代码结构
 */
export class CodeAnalyzer {
    private pluginManager: PluginManager;
    private analysisCache: Map<string, FileAnalysisResult> = new Map();

    constructor() {
        this.pluginManager = PluginManager.getInstance();
    }

    /**
     * 分析文件夹
     */
    async analyzeFolder(
        folderPath: string,
        progressCallback?: (progress: number, message: string) => void
    ): Promise<GraphData> {
        const config = vscode.workspace.getConfiguration('codeAnalysis');
        const excludePatterns = config.get<string[]>('excludePatterns', []);
        const maxDepth = config.get<number>('maxDepth', 10);

        // 获取所有支持的文件
        const files = await this.findFiles(folderPath, excludePatterns, maxDepth);
        console.log(`Found ${files.length} files to analyze`);

        // 分析所有文件
        const results: FileAnalysisResult[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progressCallback?.(
                (i / files.length) * 100,
                `Analyzing ${path.basename(file)} (${i + 1}/${files.length})`
            );

            const result = await this.analyzeFile(file);
            if (result) {
                results.push(result);
            }
        }

        progressCallback?.(100, 'Building dependency graph...');

        // 构建图数据
        const graphData = this.buildGraphData(results);
        return graphData;
    }

    /**
     * 分析单个文件
     */
    async analyzeFile(filePath: string): Promise<FileAnalysisResult | null> {
        // 检查缓存
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        // 获取合适的分析器
        const analyzer = this.pluginManager.getAnalyzerForFile(filePath);
        if (!analyzer) {
            console.log(`No analyzer found for file: ${filePath}`);
            return null;
        }

        try {
            // 打开文档
            const document = await vscode.workspace.openTextDocument(filePath);

            // 分析文件
            const result = await analyzer.analyzeFile(filePath, document);

            // 缓存结果
            this.analysisCache.set(filePath, result);

            return result;
        } catch (error) {
            console.error(`Error analyzing file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 查找文件
     */
    private async findFiles(
        folderPath: string,
        excludePatterns: string[],
        maxDepth: number
    ): Promise<string[]> {
        const files: string[] = [];
        const supportedExtensions = this.pluginManager.getSupportedExtensions();

        await this.traverseDirectory(folderPath, folderPath, files, excludePatterns, maxDepth, 0);

        // 过滤支持的文件
        return files.filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return supportedExtensions.includes(ext);
        });
    }

    /**
     * 递归遍历目录
     */
    private async traverseDirectory(
        rootPath: string,
        currentPath: string,
        files: string[],
        excludePatterns: string[],
        maxDepth: number,
        currentDepth: number
    ): Promise<void> {
        if (currentDepth > maxDepth) {
            return;
        }

        try {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relativePath = path.relative(rootPath, fullPath);

                // 检查是否应该排除
                if (this.shouldExclude(relativePath, excludePatterns)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await this.traverseDirectory(
                        rootPath,
                        fullPath,
                        files,
                        excludePatterns,
                        maxDepth,
                        currentDepth + 1
                    );
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${currentPath}:`, error);
        }
    }

    /**
     * 检查是否应该排除
     */
    private shouldExclude(relativePath: string, patterns: string[]): boolean {
        return patterns.some((pattern) => {
            // 简单的通配符匹配
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativePath);
        });
    }

    /**
     * 构建图数据
     */
    private buildGraphData(results: FileAnalysisResult[]): GraphData {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        // 创建节点
        for (const result of results) {
            nodes.push({
                id: result.filePath,
                label: path.basename(result.filePath),
                position: { x: 0, y: 0 }, // 将由布局算法计算
                elements: result.elements,
                collapsed: false,
                filePath: result.filePath,
            });
        }

        // 创建边（基于导入关系）
        for (const result of results) {
            for (const importDep of result.imports) {
                edges.push({
                    id: importDep.id,
                    source: {
                        nodeId: importDep.from.filePath,
                    },
                    target: {
                        nodeId: importDep.to.filePath,
                    },
                    type: DependencyType.Import,
                });
            }
        }

        return {
            nodes,
            edges,
            layout: {
                algorithm: 'dagre',
                direction: 'TB',
            },
        };
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.analysisCache.clear();
    }

    /**
     * 清除特定文件的缓存
     */
    clearFileCache(filePath: string): void {
        this.analysisCache.delete(filePath);
    }
}
