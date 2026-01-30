import * as vscode from 'vscode';
import * as path from 'path';
import { BaseLanguageAnalyzer } from '../base/BaseLanguageAnalyzer';
import {
    CodeElement,
    CodeElementKind,
    Dependency,
    DependencyType,
    FileAnalysisResult,
} from '../../core/types';

/**
 * TypeScript/JavaScript 分析器
 */
export class TypeScriptAnalyzer extends BaseLanguageAnalyzer {
    readonly id = 'typescript';
    readonly name = 'TypeScript/JavaScript Analyzer';
    readonly supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    async analyzeFile(
        filePath: string,
        document: vscode.TextDocument
    ): Promise<FileAnalysisResult> {
        const symbols = await this.getDocumentSymbols(document);
        const elements: CodeElement[] = [];
        const imports: Dependency[] = [];
        const exports: CodeElement[] = [];

        // 转换符号为代码元素
        for (const symbol of symbols) {
            const element = this.convertSymbolToElement(symbol, filePath);
            elements.push(element);

            // 检查是否为导出
            if (this.isExported(symbol, document)) {
                exports.push(element);
            }

            // 递归处理子符号
            if (symbol.children) {
                this.processChildren(symbol.children, filePath, elements);
            }
        }

        // 分析导入语句
        const importDeps = await this.analyzeImports(document, filePath);
        imports.push(...importDeps);

        return {
            filePath,
            elements,
            imports,
            exports,
            timestamp: Date.now(),
        };
    }

    /**
     * 转换 VSCode 符号为代码元素
     */
    private convertSymbolToElement(
        symbol: vscode.DocumentSymbol,
        filePath: string
    ): CodeElement {
        return {
            id: this.generateId(filePath, symbol.name, this.mapSymbolKind(symbol.kind)),
            name: symbol.name,
            kind: this.mapSymbolKind(symbol.kind),
            range: symbol.range,
            filePath,
            signature: symbol.detail,
            children: symbol.children?.map((child) => this.convertSymbolToElement(child, filePath)),
        };
    }

    /**
     * 映射 VSCode 符号类型到自定义类型
     */
    private mapSymbolKind(kind: vscode.SymbolKind): CodeElementKind {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return CodeElementKind.Class;
            case vscode.SymbolKind.Interface:
                return CodeElementKind.Interface;
            case vscode.SymbolKind.Function:
                return CodeElementKind.Function;
            case vscode.SymbolKind.Method:
                return CodeElementKind.Method;
            case vscode.SymbolKind.Variable:
                return CodeElementKind.Variable;
            case vscode.SymbolKind.Constant:
                return CodeElementKind.Constant;
            case vscode.SymbolKind.Property:
                return CodeElementKind.Property;
            case vscode.SymbolKind.Enum:
                return CodeElementKind.Enum;
            case vscode.SymbolKind.Module:
            case vscode.SymbolKind.Namespace:
                return CodeElementKind.Module;
            default:
                return CodeElementKind.Variable;
        }
    }

    /**
     * 处理子符号
     */
    private processChildren(
        children: vscode.DocumentSymbol[],
        filePath: string,
        elements: CodeElement[]
    ): void {
        for (const child of children) {
            const element = this.convertSymbolToElement(child, filePath);
            elements.push(element);

            if (child.children) {
                this.processChildren(child.children, filePath, elements);
            }
        }
    }

    /**
     * 检查符号是否导出
     */
    private isExported(symbol: vscode.DocumentSymbol, document: vscode.TextDocument): boolean {
        const line = document.lineAt(symbol.range.start.line);
        const text = line.text;
        return text.includes('export');
    }

    /**
     * 分析导入语句
     */
    private async analyzeImports(
        document: vscode.TextDocument,
        filePath: string
    ): Promise<Dependency[]> {
        const imports: Dependency[] = [];
        const text = document.getText();

        // 匹配 import 语句的正则表达式
        const importRegex = /import\s+(?:{([^}]+)}|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
        const requireRegex = /(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g;

        let match;

        // 解析 ES6 import
        while ((match = importRegex.exec(text)) !== null) {
            const importPath = match[4];
            const resolvedPath = await this.resolveImportPath(importPath, filePath);

            if (resolvedPath) {
                imports.push({
                    id: `${filePath}->${resolvedPath}`,
                    from: {
                        id: filePath,
                        name: path.basename(filePath),
                        kind: CodeElementKind.File,
                        range: new vscode.Range(0, 0, 0, 0),
                        filePath,
                    },
                    to: {
                        id: resolvedPath,
                        name: path.basename(resolvedPath),
                        kind: CodeElementKind.File,
                        range: new vscode.Range(0, 0, 0, 0),
                        filePath: resolvedPath,
                    },
                    type: DependencyType.Import,
                });
            }
        }

        // 解析 CommonJS require
        while ((match = requireRegex.exec(text)) !== null) {
            const importPath = match[3];
            const resolvedPath = await this.resolveImportPath(importPath, filePath);

            if (resolvedPath) {
                imports.push({
                    id: `${filePath}->${resolvedPath}`,
                    from: {
                        id: filePath,
                        name: path.basename(filePath),
                        kind: CodeElementKind.File,
                        range: new vscode.Range(0, 0, 0, 0),
                        filePath,
                    },
                    to: {
                        id: resolvedPath,
                        name: path.basename(resolvedPath),
                        kind: CodeElementKind.File,
                        range: new vscode.Range(0, 0, 0, 0),
                        filePath: resolvedPath,
                    },
                    type: DependencyType.Import,
                });
            }
        }

        return imports;
    }

    /**
   * 解析导入路径
   */
    private async resolveImportPath(importPath: string, currentFile: string): Promise<string | null> {
        // 跳过 node_modules 导入
        if (!importPath.startsWith('.')) {
            return null;
        }

        const currentDir = path.dirname(currentFile);
        let resolvedPath = path.resolve(currentDir, importPath);

        // 尝试添加扩展名
        const extensions = this.supportedExtensions;
        for (const ext of extensions) {
            const pathWithExt = resolvedPath + ext;
            try {
                const uri = vscode.Uri.file(pathWithExt);
                await vscode.workspace.fs.stat(uri);
                return pathWithExt;
            } catch {
                // 文件不存在，继续尝试
            }
        }

        // 尝试 index 文件
        for (const ext of extensions) {
            const indexPath = path.join(resolvedPath, `index${ext}`);
            try {
                const uri = vscode.Uri.file(indexPath);
                await vscode.workspace.fs.stat(uri);
                return indexPath;
            } catch {
                // 文件不存在，继续尝试
            }
        }

        return null;
    }
}
