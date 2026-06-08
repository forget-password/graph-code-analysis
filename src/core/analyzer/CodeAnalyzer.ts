import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { PluginManager } from '../PluginManager';
import {
  CodeElement,
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
  private analysisCache: Map<string, { mtimeMs: number; result: FileAnalysisResult }> = new Map();
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
    const results = await this.analyzeFiles(files, analysisConcurrency, progressCallback);

    progressCallback?.(100, 'Building dependency graph...');

    // 构建图数据
    const graphData = this.buildGraphData(results, layoutAlgorithm);
    return graphData;
  }

  /**
   * 分析单个文件
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult | null> {
    try {
      const stat = await fs.stat(filePath);
      
      // 检查缓存
      const cached = this.analysisCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.result;
      }

      // 获取合适的分析器
      const analyzer = this.pluginManager.getAnalyzerForFile(filePath);
      if (!analyzer) {
        // console.log(`No analyzer found for file: ${filePath}`);
        return null;
      }

      // 直接读取文本，避免为大批量文件创建 VS Code 文档实例
      const content = await fs.readFile(filePath, 'utf8');

      // 分析文件
      const result = await analyzer.analyzeFile(filePath, content);

      // 缓存结果
      this.analysisCache.set(filePath, { mtimeMs: stat.mtimeMs, result });

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
    const normalizedPath = relativePath.split(path.sep).join('/');
    return matchers.some((matcher) => matcher.test(normalizedPath));
  }

  private createExcludeRegex(pattern: string): RegExp {
    const normalizedPattern = pattern
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    if (!normalizedPattern) {
      return /^$/;
    }

    // handle **/dir/** pattern efficiently
    if (normalizedPattern.startsWith('**/') && normalizedPattern.endsWith('/**')) {
      const middle = normalizedPattern.slice(3, -3);
      if (!middle.includes('/') && !middle.includes('*')) {
        const escapedSegment = middle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|/)${escapedSegment}(?:/|$)`);
      }
    }

    // Plain segment names like "dist" exclude that directory/file segment and everything below it.
    if (!normalizedPattern.includes('/') && !normalizedPattern.includes('*')) {
      const escapedSegment = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|/)${escapedSegment}(?:/|$)`);
    }

    let escapedGlob = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    escapedGlob = escapedGlob.replace(/\*\*/g, '___GLOBSTAR___');
    escapedGlob = escapedGlob.replace(/\*/g, '[^/]*');
    escapedGlob = escapedGlob.replace(/___GLOBSTAR___/g, '.*');
    
    // Make leading **/ and trailing /** optional so it matches bare directories at root
    escapedGlob = escapedGlob.replace(/^\\.\\*\\\//, '(?:.*/)?');
    escapedGlob = escapedGlob.replace(/\\\/\\.\\*$/, '(?:/.*)?');

    return new RegExp(`^${escapedGlob}$`);
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

    await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));

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
    const nodeIds = new Set<string>();

    // 创建节点
    for (const result of results) {
      nodes.push({
        id: result.filePath,
        label: path.basename(result.filePath),
        position: { x: 0, y: 0 }, // 将由布局算法计算
        elements: this.flattenElements(result.elements),
        collapsed: false,
        filePath: result.filePath,
      });
      nodeIds.add(result.filePath);
    }

    // 创建边（基于导入关系）
    for (const result of results) {
      for (const importDep of result.imports) {
        const edgeKey = `${importDep.from.filePath}->${importDep.to.filePath}:${importDep.type}`;
        if (seenEdges.has(edgeKey)) {
          continue;
        }

        seenEdges.add(edgeKey);

        if (!nodeIds.has(importDep.to.filePath)) {
          nodes.push({
            id: importDep.to.filePath,
            label: importDep.to.name,
            position: { x: 0, y: 0 },
            elements: [],
            collapsed: false,
            filePath: importDep.to.filePath,
            isVirtual: true,
          });
          nodeIds.add(importDep.to.filePath);
        }

        edges.push({
          id: importDep.id,
          source: {
            nodeId: importDep.to.filePath,
          },
          target: {
            nodeId: importDep.from.filePath,
          },
          type: DependencyType.Import,
        });
      }
    }

    this.detectCircularDependencies(nodes, edges);

    return {
      nodes,
      edges,
      layout: {
        algorithm: layoutAlgorithm,
        direction: 'TB',
      },
    };
  }

  private flattenElements(elements: CodeElement[]): CodeElement[] {
    const flattened: CodeElement[] = [];

    const visit = (element: CodeElement) => {
      flattened.push(element);
      (element.children ?? []).forEach(visit);
    };

    elements.forEach(visit);
    return flattened;
  }

  /**
   * 检测循环依赖并标记相关连线
   * 使用 Tarjan 的强连通分量 (SCC) 算法
   */
  private detectCircularDependencies(nodes: GraphNode[], edges: GraphEdge[]) {
    const adjList = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      if (!adjList.has(edge.source.nodeId)) {
        adjList.set(edge.source.nodeId, []);
      }
      adjList.get(edge.source.nodeId)!.push(edge);
    }

    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: Set<string>[] = [];

    const strongconnect = (nodeId: string) => {
      indices.set(nodeId, index);
      lowlink.set(nodeId, index);
      index++;
      stack.push(nodeId);
      onStack.add(nodeId);

      const neighbors = adjList.get(nodeId) || [];
      for (const edge of neighbors) {
        const w = edge.target.nodeId;
        if (!indices.has(w)) {
          strongconnect(w);
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, indices.get(w)!));
        }
      }

      if (lowlink.get(nodeId) === indices.get(nodeId)) {
        const scc = new Set<string>();
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.add(w);
        } while (w !== nodeId);
        
        if (scc.size > 1) {
          sccs.push(scc);
        } else {
          // Check for self loops
          const selfLoop = (adjList.get(nodeId) || []).some(e => e.target.nodeId === nodeId);
          if (selfLoop) sccs.push(scc);
        }
      }
    };

    for (const node of nodes) {
      if (!indices.has(node.id)) {
        strongconnect(node.id);
      }
    }

    // Mark edges that belong to a cycle
    const nodeToScc = new Map<string, Set<string>>();
    for (const scc of sccs) {
      for (const nodeId of scc) {
        nodeToScc.set(nodeId, scc);
      }
    }

    for (const edge of edges) {
      const sourceScc = nodeToScc.get(edge.source.nodeId);
      const targetScc = nodeToScc.get(edge.target.nodeId);
      if (sourceScc && sourceScc === targetScc) {
        edge.isCircular = true;
      }
    }
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
