import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as ts from 'typescript';
import { BaseLanguageAnalyzer } from '../base/BaseLanguageAnalyzer';
import { RawScriptFileInterpreter } from '../script/RawScriptFileInterpreter';
import { PreparedScriptFile, ScriptFileInterpreter } from '../script/ScriptFileInterpreter';
import { VueFileInterpreter } from '../script/VueFileInterpreter';
import { ReactFrameworkAnalyzer } from './frameworks/ReactFrameworkAnalyzer';
import {
    TypeScriptFrameworkAnalyzer,
    TypeScriptFrameworkAnalyzerContext,
} from './frameworks/TypeScriptFrameworkAnalyzer';
import { VueFrameworkAnalyzer } from './frameworks/VueFrameworkAnalyzer';
import { TypeScriptAnalysisUtils } from './TypeScriptAnalysisUtils';
import {
    CodeElement,
    CodeElementKind,
    Dependency,
    DependencyType,
    FileAnalysisResult,
} from '../../core/types';
import { LanguageRuleConfig, PathAliasConfig } from '../../config/types';

interface TypeScriptAnalyzerOptions {
    extensions?: string[];
    rootMarkers?: string[];
    pathAliases?: PathAliasConfig[];
    frameworks?: string[];
}

/**
 * TypeScript/JavaScript 系脚本分析器
 * 通过文件解释器兼容普通脚本和 Vue SFC
 */
export class TypeScriptAnalyzer extends BaseLanguageAnalyzer {
    readonly id = 'typescript';
    readonly name = 'TypeScript/JavaScript Analyzer';
    readonly supportedExtensions: string[];
    private readonly rootMarkers: string[];
    private readonly pathAliases: PathAliasConfig[];
    private readonly resolvedImportCache: Map<string, string | null> = new Map();
    private readonly fileExistsCache: Map<string, boolean> = new Map();
    private readonly projectRootCache: Map<string, string | null> = new Map();
    private readonly interpreters: ScriptFileInterpreter[];
    private readonly frameworkAnalyzers: TypeScriptFrameworkAnalyzer[];
    private readonly utils = new TypeScriptAnalysisUtils();

    constructor(config?: TypeScriptAnalyzerOptions | LanguageRuleConfig) {
        super();
        const options = this.resolveOptions(config);
        const rawScriptExtensions = options.extensions
            .filter((extension) => extension !== '.vue');
        this.pathAliases = options.pathAliases;
        this.rootMarkers = options.rootMarkers;
        this.interpreters = [
            ...(options.extensions.includes('.vue') ? [new VueFileInterpreter()] : []),
            new RawScriptFileInterpreter(rawScriptExtensions),
        ];
        this.frameworkAnalyzers = [
            ...(options.frameworks.includes('vue') ? [new VueFrameworkAnalyzer()] : []),
            ...(options.frameworks.includes('react') ? [new ReactFrameworkAnalyzer()] : []),
        ];
        this.supportedExtensions = Array.from(new Set(options.extensions));
    }

    async analyzeFile(
        filePath: string,
        content: string
    ): Promise<FileAnalysisResult> {
        const preparedFile = this.prepareFile(filePath, content);
        const sourceFile = ts.createSourceFile(
            filePath,
            preparedFile.content,
            ts.ScriptTarget.Latest,
            true,
            preparedFile.scriptKind
        );
        const elements = this.collectElements(filePath, preparedFile, sourceFile);
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

    private prepareFile(filePath: string, content: string): PreparedScriptFile {
        const interpreter = this.interpreters.find((candidate) =>
            candidate.canInterpret(filePath, content)
        );

        if (interpreter) {
            return interpreter.prepare(filePath, content);
        }

        return new RawScriptFileInterpreter().prepare(filePath, content);
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
        const cacheKey = `${currentFile}::${importPath}`;
        if (this.resolvedImportCache.has(cacheKey)) {
            return this.resolvedImportCache.get(cacheKey) ?? null;
        }

        const basePaths = await this.resolveImportBasePaths(importPath, currentFile);

        for (const basePath of basePaths) {
            const candidates: string[] = [];
            const resolvedExt = path.extname(basePath).toLowerCase();

            if (this.supportedExtensions.includes(resolvedExt)) {
                candidates.push(basePath);
            }

            this.supportedExtensions.forEach((ext) => {
                candidates.push(`${basePath}${ext}`);
                candidates.push(path.join(basePath, `index${ext}`));
            });

            for (const candidate of candidates) {
                if (await this.fileExists(candidate)) {
                    this.resolvedImportCache.set(cacheKey, candidate);
                    return candidate;
                }
            }
        }

        this.resolvedImportCache.set(cacheKey, null);
        return null;
    }

    private async resolveImportBasePaths(importPath: string, currentFile: string): Promise<string[]> {
        const currentDir = path.dirname(currentFile);

        if (importPath.startsWith('.')) {
            return [path.resolve(currentDir, importPath)];
        }

        const projectRoot = await this.findProjectRoot(currentFile);
        if (!projectRoot) {
            return [];
        }

        for (const alias of this.pathAliases) {
            if (!importPath.startsWith(alias.prefix)) {
                continue;
            }

            const remainder = importPath.slice(alias.prefix.length);
            const targetBase = alias.base === 'currentDir'
                ? currentDir
                : projectRoot;
            return [path.join(targetBase, alias.target, remainder)];
        }

        return [];
    }

    private async findProjectRoot(filePath: string): Promise<string | null> {
        let currentDir = path.dirname(filePath);
        const visitedDirs: string[] = [];

        while (true) {
            if (this.projectRootCache.has(currentDir)) {
                const cached = this.projectRootCache.get(currentDir) ?? null;
                visitedDirs.forEach((dir) => this.projectRootCache.set(dir, cached));
                return cached;
            }

            visitedDirs.push(currentDir);

            for (const marker of this.rootMarkers) {
                if (await this.fileExists(path.join(currentDir, marker))) {
                    visitedDirs.forEach((dir) => this.projectRootCache.set(dir, currentDir));
                    return currentDir;
                }
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                visitedDirs.forEach((dir) => this.projectRootCache.set(dir, null));
                return null;
            }

            currentDir = parentDir;
        }
    }

    private resolveOptions(config?: TypeScriptAnalyzerOptions | LanguageRuleConfig): Required<TypeScriptAnalyzerOptions> {
        const extensions = config?.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'];
        const rootMarkers = config?.rootMarkers ?? ['package.json', 'tsconfig.json', 'jsconfig.json', '.git'];
        const pathAliases = config?.pathAliases ?? [
            { prefix: '@/', target: 'src', base: 'projectRoot' },
            { prefix: '~/', target: '', base: 'projectRoot' },
        ];
        const frameworks = config?.frameworks ?? ['vue', 'react'];

        return {
            extensions,
            rootMarkers,
            pathAliases,
            frameworks,
        };
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
    private collectElements(
        filePath: string,
        preparedFile: PreparedScriptFile,
        sourceFile: ts.SourceFile
    ): CodeElement[] {
        const elements = this.collectBaseElements(filePath, sourceFile);
        const frameworkContext: TypeScriptFrameworkAnalyzerContext = {
            filePath,
            preparedFile,
            sourceFile,
            utils: this.utils,
        };
        const frameworkElements = this.frameworkAnalyzers
            .filter((analyzer) => analyzer.supports(frameworkContext))
            .flatMap((analyzer) => analyzer.analyze(frameworkContext).elements);

        return [...frameworkElements, ...elements];
    }

    private collectBaseElements(
        filePath: string,
        sourceFile: ts.SourceFile
    ): CodeElement[] {
        const elements: CodeElement[] = [];

        const visit = (node: ts.Node) => {
            let element: CodeElement | null = null;
            const isExported = this.utils.isNodeExported(node);

            switch (node.kind) {
                case ts.SyntaxKind.ClassDeclaration: {
                    const classNode = node as ts.ClassDeclaration;
                    if (classNode.name) {
                        element = this.utils.createCodeElement(
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
                    element = this.utils.createCodeElement(
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
                        element = this.utils.createCodeElement(
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
                    const methodName = this.utils.getPropertyNameText(methodNode.name);
                    if (methodName) {
                        element = this.utils.createCodeElement(
                            methodName,
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
                        if (!ts.isIdentifier(decl.name)) {
                            continue;
                        }

                        const kind = varStmt.declarationList.flags & ts.NodeFlags.Const
                            ? CodeElementKind.Constant
                            : CodeElementKind.Variable;

                        const varElement = this.utils.createCodeElement(
                            decl.name.text,
                            kind,
                            decl,
                            sourceFile,
                            filePath,
                            isExported
                        );

                        if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                            varElement.children = this.utils.getObjectLiteralProperties(
                                decl.initializer,
                                sourceFile,
                                filePath
                            );
                        }

                        elements.push(varElement);
                    }
                    break;
                }
                case ts.SyntaxKind.ModuleDeclaration: {
                    const moduleNode = node as ts.ModuleDeclaration;
                    if (ts.isIdentifier(moduleNode.name)) {
                        element = this.utils.createCodeElement(
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
                    element = this.utils.createCodeElement(
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
                if (
                    [
                        ts.SyntaxKind.ClassDeclaration,
                        ts.SyntaxKind.ModuleDeclaration,
                        ts.SyntaxKind.InterfaceDeclaration,
                        ts.SyntaxKind.EnumDeclaration,
                    ].includes(node.kind)
                ) {
                    element.children = this.utils.getChildren(node, sourceFile, filePath);
                }

                elements.push(element);
            } else {
                ts.forEachChild(node, visit);
            }
        };

        ts.forEachChild(sourceFile, visit);
        return elements;
    }
}
