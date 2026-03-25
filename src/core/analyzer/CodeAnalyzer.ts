import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { PluginManager } from '../PluginManager';
import {
    FileAnalysisResult,
    GraphData,
    GraphNode,
    GraphEdge,
    DependencyType,
    GraphLayoutAlgorithm,
} from '../types';

/**
 * 代码分析器
 * 负责分析整个文件夹的代码结构
 */
export class CodeAnalyzer {
    private pluginManager: PluginManager;
    private analysisCache: Map<string, FileAnalysisResult> = new Map();
    private readonly defaultConcurrency = Math.max(4, Math.min(os.cpus().length || 4, 12));

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
        const layoutAlgorithm = config.get<GraphLayoutAlgorithm>('layout', 'elk');
        const analysisConcurrency = Math.max(
            1,
            config.get<number>('analysisConcurrency', this.defaultConcurrency)
        );

        // 获取所有支持的文件
        const files = await this.findFiles(folderPath, excludePatterns, maxDepth);
        console.log(`Found ${files.length} files to analyze`);

        // 并发分析所有文件
        const results = await this.analyzeFiles(
            files,
            analysisConcurrency,
            progressCallback
        );

        progressCallback?.(100, 'Building dependency graph...');

        // 构建图数据
        const graphData = this.buildGraphData(results, layoutAlgorithm);
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
            // 直接读取文本，避免为大批量文件创建 VS Code 文档实例
            const content = await fs.readFile(filePath, 'utf8');

            // 分析文件
            const result = await analyzer.analyzeFile(filePath, content);

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
        const excludeMatchers = excludePatterns.map((pattern) => this.createExcludeRegex(pattern));

        await this.traverseDirectory(
            folderPath,
            folderPath,
            files,
            excludeMatchers,
            supportedExtensions,
            maxDepth,
            0
        );

        return files;
    }

    /**
     * 递归遍历目录
     */
    private async traverseDirectory(
        rootPath: string,
        currentPath: string,
        files: string[],
        excludeMatchers: RegExp[],
        supportedExtensions: string[],
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
                if (this.shouldExclude(relativePath, excludeMatchers)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await this.traverseDirectory(
                        rootPath,
                        fullPath,
                        files,
                        excludeMatchers,
                        supportedExtensions,
                        maxDepth,
                        currentDepth + 1
                    );
                } else if (entry.isFile()) {
                    const ext = path.extname(fullPath).toLowerCase();
                    if (supportedExtensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${currentPath}:`, error);
        }
    }

    /**
     * 检查是否应该排除
     */
    private shouldExclude(relativePath: string, matchers: RegExp[]): boolean {
        return matchers.some((matcher) => matcher.test(relativePath));
    }

    private createExcludeRegex(pattern: string): RegExp {
        return new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    }

    private async analyzeFiles(
        files: string[],
        concurrency: number,
        progressCallback?: (progress: number, message: string) => void
    ): Promise<FileAnalysisResult[]> {
        const safeConcurrency = Math.max(1, Math.min(concurrency, files.length || 1));
        const results: Array<FileAnalysisResult | null> = new Array(files.length).fill(null);
        let nextIndex = 0;
        let completed = 0;

        const worker = async () => {
            while (true) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                if (currentIndex >= files.length) {
                    return;
                }

                const file = files[currentIndex];
                const result = await this.analyzeFile(file);
                results[currentIndex] = result;

                completed += 1;
                progressCallback?.(
                    (completed / Math.max(files.length, 1)) * 100,
                    `Analyzing ${path.basename(file)} (${completed}/${files.length})`
                );
            }
        };

        await Promise.all(
            Array.from({ length: safeConcurrency }, () => worker())
        );

        return results.filter((result): result is FileAnalysisResult => result !== null);
    }

    /**
     * 构建图数据
     */
    private buildGraphData(
        results: FileAnalysisResult[],
        layoutAlgorithm: GraphLayoutAlgorithm
    ): GraphData {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const seenEdges = new Set<string>();

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
                const edgeKey = `${importDep.from.filePath}->${importDep.to.filePath}:${importDep.type}`;
                if (seenEdges.has(edgeKey)) {
                    continue;
                }

                seenEdges.add(edgeKey);
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
                algorithm: layoutAlgorithm,
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
