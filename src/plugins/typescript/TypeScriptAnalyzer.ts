import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as ts from 'typescript';
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
    private readonly resolvedImportCache: Map<string, string | null> = new Map();
    private readonly fileExistsCache: Map<string, boolean> = new Map();

    async analyzeFile(
        filePath: string,
        content: string
    ): Promise<FileAnalysisResult> {
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );
        const elements = this.parseWithTypeScript(filePath, content, sourceFile);
        const imports = await this.analyzeImports(sourceFile, filePath);
        const exports = elements.filter((element) => element.isExported);

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
        sourceFile: ts.SourceFile,
        filePath: string
    ): Promise<Dependency[]> {
        const imports: Dependency[] = [];
        const seenImports = new Set<string>();

        const addImport = async (importPath: string | undefined) => {
            if (!importPath || seenImports.has(importPath)) {
                return;
            }

            seenImports.add(importPath);
            const resolvedPath = await this.resolveImportPath(importPath, filePath);
            if (resolvedPath) {
                imports.push(this.createImportDependency(filePath, resolvedPath));
            }
        };

        const pendingImports: Promise<void>[] = [];

        sourceFile.forEachChild((node) => {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                const moduleSpecifier = node.moduleSpecifier;
                if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
                    pendingImports.push(addImport(moduleSpecifier.text));
                }
                return;
            }

            if (!ts.isVariableStatement(node)) {
                return;
            }

            node.declarationList.declarations.forEach((declaration) => {
                const initializer = declaration.initializer;
                if (
                    initializer
                    && ts.isCallExpression(initializer)
                    && ts.isIdentifier(initializer.expression)
                    && initializer.expression.text === 'require'
                    && initializer.arguments.length > 0
                    && ts.isStringLiteralLike(initializer.arguments[0])
                ) {
                    pendingImports.push(addImport(initializer.arguments[0].text));
                }
            });
        });

        await Promise.all(pendingImports);
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

        const cacheKey = `${currentFile}::${importPath}`;
        if (this.resolvedImportCache.has(cacheKey)) {
            return this.resolvedImportCache.get(cacheKey) ?? null;
        }

        const currentDir = path.dirname(currentFile);
        const resolvedPath = path.resolve(currentDir, importPath);
        const candidates: string[] = [];
        const resolvedExt = path.extname(resolvedPath).toLowerCase();

        if (this.supportedExtensions.includes(resolvedExt)) {
            candidates.push(resolvedPath);
        }

        this.supportedExtensions.forEach((ext) => {
            candidates.push(`${resolvedPath}${ext}`);
            candidates.push(path.join(resolvedPath, `index${ext}`));
        });

        for (const candidate of candidates) {
            if (await this.fileExists(candidate)) {
                this.resolvedImportCache.set(cacheKey, candidate);
                return candidate;
            }
        }

        this.resolvedImportCache.set(cacheKey, null);
        return null;
    }

    private createImportDependency(filePath: string, resolvedPath: string): Dependency {
        return {
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
        };
    }

    private async fileExists(filePath: string): Promise<boolean> {
        if (this.fileExistsCache.has(filePath)) {
            return this.fileExistsCache.get(filePath) ?? false;
        }

        try {
            await fs.access(filePath);
            this.fileExistsCache.set(filePath, true);
            return true;
        } catch {
            this.fileExistsCache.set(filePath, false);
            return false;
        }
    }
    /**
     * 使用 TypeScript 编译器 API 解析文件
     */
    private parseWithTypeScript(
        filePath: string,
        content: string,
        existingSourceFile?: ts.SourceFile
    ): CodeElement[] {
        const elements: CodeElement[] = [];
        const sourceFile = existingSourceFile || ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );

        const visit = (node: ts.Node) => {
            let element: CodeElement | null = null;
            let isExported = false;

            // 检查是否导出
            if (ts.canHaveModifiers(node)) {
                const modifiers = ts.getModifiers(node);
                isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
            }

            switch (node.kind) {
                case ts.SyntaxKind.ClassDeclaration: {
                    const classNode = node as ts.ClassDeclaration;
                    if (classNode.name) {
                        element = this.createCodeElement(
                            classNode.name.text,
                            CodeElementKind.Class,
                            classNode,
                            sourceFile,
                            filePath,
                            isExported
                        );
                    }
                    break;
                }
                case ts.SyntaxKind.InterfaceDeclaration: {
                    const interfaceNode = node as ts.InterfaceDeclaration;
                    element = this.createCodeElement(
                        interfaceNode.name.text,
                        CodeElementKind.Interface,
                        interfaceNode,
                        sourceFile,
                        filePath,
                        isExported
                    );
                    break;
                }
                case ts.SyntaxKind.FunctionDeclaration: {
                    const funcNode = node as ts.FunctionDeclaration;
                    if (funcNode.name) {
                        element = this.createCodeElement(
                            funcNode.name.text,
                            CodeElementKind.Function,
                            funcNode,
                            sourceFile,
                            filePath,
                            isExported
                        );
                    }
                    break;
                }
                case ts.SyntaxKind.MethodDeclaration: {
                    const methodNode = node as ts.MethodDeclaration;
                    if (ts.isIdentifier(methodNode.name)) {
                        element = this.createCodeElement(
                            methodNode.name.text,
                            CodeElementKind.Method,
                            methodNode,
                            sourceFile,
                            filePath,
                            isExported
                        );
                    }
                    break;
                }
                case ts.SyntaxKind.VariableStatement: {
                    const varStmt = node as ts.VariableStatement;
                    for (const decl of varStmt.declarationList.declarations) {
                        if (ts.isIdentifier(decl.name)) {
                            const kind = varStmt.declarationList.flags & ts.NodeFlags.Const
                                ? CodeElementKind.Constant
                                : CodeElementKind.Variable;

                            const varElement = this.createCodeElement(
                                decl.name.text,
                                kind,
                                decl,
                                sourceFile,
                                filePath,
                                isExported
                            );

                            // Check for object literal initializer
                            if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                                varElement.children = this.getObjectLiteralProperties(decl.initializer, sourceFile, filePath);
                            }

                            elements.push(varElement);
                        }
                    }
                    break;
                }
                case ts.SyntaxKind.ModuleDeclaration: {
                    const moduleNode = node as ts.ModuleDeclaration;
                    if (ts.isIdentifier(moduleNode.name)) {
                        element = this.createCodeElement(
                            moduleNode.name.text,
                            CodeElementKind.Module,
                            moduleNode,
                            sourceFile,
                            filePath,
                            isExported
                        );
                    }
                    break;
                }
                case ts.SyntaxKind.EnumDeclaration: {
                    const enumNode = node as ts.EnumDeclaration;
                    element = this.createCodeElement(
                        enumNode.name.text,
                        CodeElementKind.Enum,
                        enumNode,
                        sourceFile,
                        filePath,
                        isExported
                    );
                    break;
                }
            }

            if (element) {
                // 如果是容器类型，递归查找子节点
                if ([ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.ModuleDeclaration, ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.EnumDeclaration].includes(node.kind)) {
                    const children: CodeElement[] = [];
                    ts.forEachChild(node, (child) => {
                        // 简单的递归逻辑：对于子节点，我们需要将其添加到当前元素的 children 中
                        // 这里我们需要稍微调整 visit 函数或者创建一个新的递归函数来处理 children
                        // 为了简单起见，我们在这里不深度递归构建完整的树，而是依赖顶层的遍历
                        // 实际的 AST 遍历通常需要携带上下文
                    });

                    // 重新实现子节点遍历逻辑
                    element.children = this.getChildren(node, sourceFile, filePath);
                }

                elements.push(element);
            } else {
                // 继续遍历子节点
                ts.forEachChild(node, visit);
            }
        };

        ts.forEachChild(sourceFile, visit);

        return elements;
    }

    private getObjectLiteralProperties(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile, filePath: string): CodeElement[] {
        const properties: CodeElement[] = [];

        for (const prop of node.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                const element = this.createCodeElement(
                    prop.name.text,
                    CodeElementKind.Property,
                    prop,
                    sourceFile,
                    filePath,
                    false
                );
                properties.push(element);
            }
        }

        return properties;
    }

    private getChildren(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): CodeElement[] {
        const children: CodeElement[] = [];

        node.forEachChild(child => {
            let element: CodeElement | null = null;
            let isExported = false; // 类成员的导出通常由 public/private 控制，或者是隐含的

            // 简单处理方法和属性
            if (ts.isMethodDeclaration(child) && ts.isIdentifier(child.name)) {
                element = this.createCodeElement(
                    child.name.text,
                    CodeElementKind.Method,
                    child,
                    sourceFile,
                    filePath,
                    false
                );
            } else if (ts.isPropertyDeclaration(child) && ts.isIdentifier(child.name)) {
                element = this.createCodeElement(
                    child.name.text,
                    CodeElementKind.Property,
                    child,
                    sourceFile,
                    filePath,
                    false
                );
            }

            if (element) {
                children.push(element);
            }
        });

        return children;
    }

    private createCodeElement(
        name: string,
        kind: CodeElementKind,
        node: ts.Node,
        sourceFile: ts.SourceFile,
        filePath: string,
        isExported: boolean
    ): CodeElement {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        return {
            id: this.generateId(filePath, name, kind),
            name,
            kind,
            range: new vscode.Range(
                new vscode.Position(start.line, start.character),
                new vscode.Position(end.line, end.character)
            ),
            filePath,
            isExported,
            children: []
        };
    }
}
