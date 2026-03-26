import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as ts from 'typescript';
import { BaseLanguageAnalyzer } from '../base/BaseLanguageAnalyzer';
import { RawScriptFileInterpreter } from '../script/RawScriptFileInterpreter';
import { PreparedScriptFile, ScriptFileInterpreter } from '../script/ScriptFileInterpreter';
import { VueFileInterpreter } from '../script/VueFileInterpreter';
import {
    CodeElement,
    CodeElementKind,
    Dependency,
    DependencyType,
    FileAnalysisResult,
} from '../../core/types';

/**
 * TypeScript/JavaScript 系脚本分析器
 * 通过文件解释器兼容普通脚本和 Vue SFC
 */
export class TypeScriptAnalyzer extends BaseLanguageAnalyzer {
    readonly id = 'typescript';
    readonly name = 'TypeScript/JavaScript Analyzer';
    readonly supportedExtensions: string[];
    private readonly resolvedImportCache: Map<string, string | null> = new Map();
    private readonly fileExistsCache: Map<string, boolean> = new Map();
    private readonly projectRootCache: Map<string, string | null> = new Map();
    private readonly interpreters: ScriptFileInterpreter[] = [
        new VueFileInterpreter(),
        new RawScriptFileInterpreter(),
    ];

    constructor() {
        super();
        this.supportedExtensions = Array.from(
            new Set(this.interpreters.flatMap((interpreter) => interpreter.supportedExtensions))
        );
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

        if (importPath.startsWith('@/')) {
            return [path.join(projectRoot, 'src', importPath.slice(2))];
        }

        if (importPath.startsWith('~/')) {
            return [path.join(projectRoot, importPath.slice(2))];
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

            for (const marker of ['package.json', 'tsconfig.json', 'jsconfig.json', '.git']) {
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
        const elements: CodeElement[] = [];

        const visit = (node: ts.Node) => {
            let element: CodeElement | null = null;
            let isExported = false;

            if (ts.canHaveModifiers(node)) {
                const modifiers = ts.getModifiers(node);
                isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) || false;
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
                    const methodName = this.getPropertyNameText(methodNode.name);
                    if (methodName) {
                        element = this.createCodeElement(
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

                        const varElement = this.createCodeElement(
                            decl.name.text,
                            kind,
                            decl,
                            sourceFile,
                            filePath,
                            isExported
                        );

                        if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                            varElement.children = this.getObjectLiteralProperties(
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
                case ts.SyntaxKind.ExportAssignment: {
                    element = this.createVueComponentElement(
                        node as ts.ExportAssignment,
                        filePath,
                        preparedFile,
                        sourceFile
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
                    element.children = this.getChildren(node, sourceFile, filePath);
                }

                elements.push(element);
            } else {
                ts.forEachChild(node, visit);
            }
        };

        ts.forEachChild(sourceFile, visit);

        if (preparedFile.framework !== 'standard' && !elements.some((item) => item.kind === CodeElementKind.Component)) {
            elements.unshift(this.createSyntheticVueComponent(filePath, preparedFile, sourceFile));
        }

        return elements;
    }

    private createVueComponentElement(
        exportNode: ts.ExportAssignment,
        filePath: string,
        preparedFile: PreparedScriptFile,
        sourceFile: ts.SourceFile
    ): CodeElement | null {
        if (preparedFile.framework === 'standard') {
            return null;
        }

        const optionsNode = this.getVueComponentOptions(exportNode.expression);
        const componentName = optionsNode
            ? this.getVueComponentName(optionsNode) || preparedFile.componentName || path.basename(filePath)
            : preparedFile.componentName || path.basename(filePath);

        const element = this.createCodeElement(
            componentName,
            CodeElementKind.Component,
            exportNode,
            sourceFile,
            filePath,
            true
        );

        if (optionsNode) {
            element.children = this.getVueOptionChildren(optionsNode, sourceFile, filePath);
        }

        const componentFactory = this.getVueComponentFactoryElement(
            exportNode.expression,
            sourceFile,
            filePath
        );
        if (componentFactory) {
            element.children = [componentFactory, ...(element.children ?? [])];
        }

        return element;
    }

    private createSyntheticVueComponent(
        filePath: string,
        preparedFile: PreparedScriptFile,
        sourceFile: ts.SourceFile
    ): CodeElement {
        const endPosition = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd());

        return {
            id: this.generateId(
                filePath,
                preparedFile.componentName || path.basename(filePath, path.extname(filePath)),
                CodeElementKind.Component
            ),
            name: preparedFile.componentName || path.basename(filePath, path.extname(filePath)),
            kind: CodeElementKind.Component,
            range: new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(endPosition.line, endPosition.character)
            ),
            filePath,
            isExported: true,
            children: [],
        };
    }

    private getVueComponentOptions(expression: ts.Expression): ts.ObjectLiteralExpression | null {
        if (ts.isObjectLiteralExpression(expression)) {
            return expression;
        }

        if (ts.isCallExpression(expression) && expression.arguments.length > 0) {
            const firstArg = expression.arguments[0];
            if (ts.isObjectLiteralExpression(firstArg)) {
                return firstArg;
            }
        }

        return null;
    }

    private getVueComponentFactoryElement(
        expression: ts.Expression,
        sourceFile: ts.SourceFile,
        filePath: string
    ): CodeElement | null {
        if (!ts.isCallExpression(expression)) {
            return null;
        }

        const factoryName = this.getExpressionText(expression.expression);
        if (!factoryName) {
            return null;
        }

        return this.createCodeElement(
            factoryName,
            CodeElementKind.Function,
            expression.expression,
            sourceFile,
            filePath,
            false
        );
    }

    private getVueComponentName(optionsNode: ts.ObjectLiteralExpression): string | undefined {
        for (const property of optionsNode.properties) {
            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            if (this.getPropertyNameText(property.name) !== 'name') {
                continue;
            }

            if (ts.isStringLiteralLike(property.initializer)) {
                return property.initializer.text;
            }
        }

        return undefined;
    }

    private getVueOptionChildren(
        optionsNode: ts.ObjectLiteralExpression,
        sourceFile: ts.SourceFile,
        filePath: string
    ): CodeElement[] {
        const children: CodeElement[] = [];

        for (const property of optionsNode.properties) {
            if (ts.isMethodDeclaration(property)) {
                const methodName = this.getPropertyNameText(property.name);
                if (methodName) {
                    children.push(
                        this.createCodeElement(
                            methodName,
                            CodeElementKind.Method,
                            property,
                            sourceFile,
                            filePath,
                            false
                        )
                    );
                }
                continue;
            }

            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            const optionName = this.getPropertyNameText(property.name);
            if (!optionName) {
                continue;
            }

            if (ts.isObjectLiteralExpression(property.initializer)) {
                if (['methods', 'computed', 'props', 'emits', 'components'].includes(optionName)) {
                    children.push(
                        ...this.getNestedVueOptionMembers(
                            property.initializer,
                            sourceFile,
                            filePath,
                            optionName
                        )
                    );
                    continue;
                }

                const optionElement = this.createCodeElement(
                    optionName,
                    CodeElementKind.Property,
                    property,
                    sourceFile,
                    filePath,
                    false
                );
                optionElement.children = this.getObjectLiteralProperties(
                    property.initializer,
                    sourceFile,
                    filePath
                );
                children.push(optionElement);
                continue;
            }

            const kind = this.isFunctionLikeExpression(property.initializer)
                ? CodeElementKind.Method
                : CodeElementKind.Property;
            children.push(
                this.createCodeElement(
                    optionName,
                    kind,
                    property,
                    sourceFile,
                    filePath,
                    false
                )
            );
        }

        return children;
    }

    private getNestedVueOptionMembers(
        node: ts.ObjectLiteralExpression,
        sourceFile: ts.SourceFile,
        filePath: string,
        optionName: string
    ): CodeElement[] {
        const children: CodeElement[] = [];

        for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
                continue;
            }

            if (ts.isMethodDeclaration(property)) {
                const memberName = this.getPropertyNameText(property.name);
                if (memberName) {
                    children.push(
                        this.createCodeElement(
                            memberName,
                            CodeElementKind.Method,
                            property,
                            sourceFile,
                            filePath,
                            false
                        )
                    );
                }
                continue;
            }

            if (ts.isShorthandPropertyAssignment(property)) {
                const kind = this.getVueOptionMemberKind(optionName);
                children.push(
                    this.createCodeElement(
                        property.name.text,
                        kind,
                        property,
                        sourceFile,
                        filePath,
                        false
                    )
                );
                continue;
            }

            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            const memberName = this.getPropertyNameText(property.name);
            if (!memberName) {
                continue;
            }

            const kind = this.getVueOptionMemberKind(optionName);
            const child = this.createCodeElement(
                memberName,
                kind,
                property,
                sourceFile,
                filePath,
                false
            );

            if (ts.isObjectLiteralExpression(property.initializer)) {
                child.children = this.getObjectLiteralProperties(
                    property.initializer,
                    sourceFile,
                    filePath
                );
            }

            children.push(child);
        }

        return children;
    }

    private getVueOptionMemberKind(optionName: string): CodeElementKind {
        if (optionName === 'methods' || optionName === 'computed') {
            return CodeElementKind.Method;
        }

        if (optionName === 'components') {
            return CodeElementKind.Module;
        }

        return CodeElementKind.Property;
    }

    private isFunctionLikeExpression(node: ts.Expression): boolean {
        return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    }

    private getObjectLiteralProperties(
        node: ts.ObjectLiteralExpression,
        sourceFile: ts.SourceFile,
        filePath: string
    ): CodeElement[] {
        const properties: CodeElement[] = [];

        for (const prop of node.properties) {
            if (ts.isSpreadAssignment(prop)) {
                continue;
            }

            if (ts.isMethodDeclaration(prop)) {
                const methodName = this.getPropertyNameText(prop.name);
                if (methodName) {
                    properties.push(
                        this.createCodeElement(
                            methodName,
                            CodeElementKind.Method,
                            prop,
                            sourceFile,
                            filePath,
                            false
                        )
                    );
                }
                continue;
            }

            if (ts.isShorthandPropertyAssignment(prop)) {
                properties.push(
                    this.createCodeElement(
                        prop.name.text,
                        CodeElementKind.Property,
                        prop,
                        sourceFile,
                        filePath,
                        false
                    )
                );
                continue;
            }

            if (!ts.isPropertyAssignment(prop)) {
                continue;
            }

            const propName = this.getPropertyNameText(prop.name);
            if (!propName) {
                continue;
            }

            const element = this.createCodeElement(
                propName,
                this.isFunctionLikeExpression(prop.initializer)
                    ? CodeElementKind.Method
                    : CodeElementKind.Property,
                prop,
                sourceFile,
                filePath,
                false
            );

            if (ts.isObjectLiteralExpression(prop.initializer)) {
                element.children = this.getObjectLiteralProperties(
                    prop.initializer,
                    sourceFile,
                    filePath
                );
            }

            properties.push(element);
        }

        return properties;
    }

    private getChildren(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): CodeElement[] {
        const children: CodeElement[] = [];

        node.forEachChild((child) => {
            let element: CodeElement | null = null;

            if (ts.isMethodDeclaration(child)) {
                const methodName = this.getPropertyNameText(child.name);
                if (methodName) {
                    element = this.createCodeElement(
                        methodName,
                        CodeElementKind.Method,
                        child,
                        sourceFile,
                        filePath,
                        false
                    );
                }
            } else if (ts.isPropertyDeclaration(child)) {
                const propertyName = this.getPropertyNameText(child.name);
                if (propertyName) {
                    element = this.createCodeElement(
                        propertyName,
                        CodeElementKind.Property,
                        child,
                        sourceFile,
                        filePath,
                        false
                    );
                }
            }

            if (element) {
                children.push(element);
            }
        });

        return children;
    }

    private getPropertyNameText(name: ts.PropertyName | ts.MemberName | undefined): string | undefined {
        if (!name) {
            return undefined;
        }

        if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
            return name.text;
        }

        if (ts.isComputedPropertyName(name) && ts.isIdentifier(name.expression)) {
            return name.expression.text;
        }

        return undefined;
    }

    private getExpressionText(expression: ts.Expression): string | undefined {
        if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
            return expression.text;
        }

        if (ts.isPropertyAccessExpression(expression)) {
            return expression.getText();
        }

        return undefined;
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
            children: [],
        };
    }
}
