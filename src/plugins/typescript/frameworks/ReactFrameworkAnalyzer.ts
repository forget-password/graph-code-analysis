import * as path from 'path';
import * as ts from 'typescript';
import { CodeElement, CodeElementKind } from '../../../core/types';
import {
    TypeScriptFrameworkAnalyzer,
    TypeScriptFrameworkAnalyzerContext,
} from './TypeScriptFrameworkAnalyzer';

/**
 * React Hooks / Class 组件语义分析
 */
export class ReactFrameworkAnalyzer implements TypeScriptFrameworkAnalyzer {
    readonly id = 'react';
    private readonly reactClassBases = new Set([
        'Component',
        'PureComponent',
        'React.Component',
        'React.PureComponent',
    ]);
    private readonly reactFactories = new Set([
        'memo',
        'forwardRef',
        'React.memo',
        'React.forwardRef',
    ]);

    supports(context: TypeScriptFrameworkAnalyzerContext): boolean {
        const { preparedFile } = context;
        const isJsxFile = preparedFile.scriptKind === ts.ScriptKind.JSX
            || preparedFile.scriptKind === ts.ScriptKind.TSX;

        if (!isJsxFile) {
            return false;
        }

        return !(preparedFile.metadata?.hints?.includes('vue') ?? false);
    }

    analyze(context: TypeScriptFrameworkAnalyzerContext) {
        const elements: CodeElement[] = [];

        context.sourceFile.forEachChild((node) => {
            const element = this.analyzeTopLevelNode(node, context);
            if (element) {
                elements.push(element);
            }
        });

        return { elements };
    }

    private analyzeTopLevelNode(
        node: ts.Node,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        if (ts.isClassDeclaration(node)) {
            return this.createClassComponent(node, context);
        }

        if (ts.isFunctionDeclaration(node)) {
            return this.createFunctionComponent(node, node.name?.text, context);
        }

        if (ts.isVariableStatement(node)) {
            return this.createVariableComponent(node, context);
        }

        if (ts.isExportAssignment(node)) {
            return this.createDefaultExportComponent(node, context);
        }

        return null;
    }

    private createClassComponent(
        node: ts.ClassDeclaration,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const name = node.name?.text;
        if (!name || !this.isPascalCase(name) || !this.isReactClassComponent(node, context)) {
            return null;
        }

        const { filePath, sourceFile, utils } = context;
        return utils.createCodeElement(
            name,
            CodeElementKind.Component,
            node,
            sourceFile,
            filePath,
            utils.isNodeExported(node),
            {
                children: utils.getChildren(node, sourceFile, filePath),
                modifiers: ['react', 'class-component'],
                signature: this.getClassSignature(node),
            }
        );
    }

    private createFunctionComponent(
        node: ts.FunctionDeclaration,
        explicitName: string | undefined,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const name = explicitName;
        if (!name || !this.isPascalCase(name) || !this.isReactFunctionComponent(node, context)) {
            return null;
        }

        const { filePath, sourceFile, utils } = context;
        return utils.createCodeElement(
            name,
            CodeElementKind.Component,
            node,
            sourceFile,
            filePath,
            utils.isNodeExported(node),
            {
                modifiers: this.getFunctionComponentModifiers(node),
            }
        );
    }

    private createVariableComponent(
        node: ts.VariableStatement,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const { filePath, sourceFile, utils } = context;

        for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
                continue;
            }

            const name = declaration.name.text;
            if (!this.isPascalCase(name)) {
                continue;
            }

            const initializer = this.unwrapReactFactoryInitializer(declaration.initializer);
            if (!initializer || !this.isReactFunctionLike(initializer) || !this.isReactFunctionComponent(initializer, context)) {
                continue;
            }

            return utils.createCodeElement(
                name,
                CodeElementKind.Component,
                declaration,
                sourceFile,
                filePath,
                utils.isNodeExported(node),
                {
                    modifiers: this.getFunctionComponentModifiers(initializer),
                }
            );
        }

        return null;
    }

    private createDefaultExportComponent(
        node: ts.ExportAssignment,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const expression = this.unwrapReactFactoryInitializer(node.expression);
        if (!expression) {
            return null;
        }

        const { filePath, sourceFile, utils } = context;
        const fallbackName = path.basename(filePath, path.extname(filePath));

        if (ts.isClassExpression(expression) && this.isReactClassComponent(expression, context)) {
            return utils.createCodeElement(
                expression.name?.text || fallbackName,
                CodeElementKind.Component,
                node,
                sourceFile,
                filePath,
                true,
                {
                    children: utils.getChildren(expression, sourceFile, filePath),
                    modifiers: ['react', 'class-component'],
                    signature: this.getClassSignature(expression),
                }
            );
        }

        if (this.isReactFunctionLike(expression) && this.isReactFunctionComponent(expression, context)) {
            return utils.createCodeElement(
                this.getFunctionLikeName(expression) || fallbackName,
                CodeElementKind.Component,
                node,
                sourceFile,
                filePath,
                true,
                {
                    modifiers: this.getFunctionComponentModifiers(expression),
                }
            );
        }

        return null;
    }

    private isReactClassComponent(
        node: ts.ClassLikeDeclarationBase,
        context: TypeScriptFrameworkAnalyzerContext
    ): boolean {
        const heritageClause = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
        if (!heritageClause) {
            return false;
        }

        return heritageClause.types.some((heritageType) => {
            const baseName = context.utils.getExpressionText(heritageType.expression);
            return baseName ? this.reactClassBases.has(baseName) : false;
        });
    }

    private isReactFunctionComponent(
        node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
        context: TypeScriptFrameworkAnalyzerContext
    ): boolean {
        return this.hasRenderableReturn(node.body) || this.containsHookCalls(node.body);
    }

    private hasRenderableReturn(body: ts.ConciseBody | undefined): boolean {
        if (!body) {
            return false;
        }

        if (!ts.isBlock(body)) {
            return this.isRenderableExpression(body);
        }

        let found = false;
        const visit = (node: ts.Node) => {
            if (found) {
                return;
            }

            if (ts.isReturnStatement(node) && node.expression && this.isRenderableExpression(node.expression)) {
                found = true;
                return;
            }

            ts.forEachChild(node, visit);
        };

        visit(body);
        return found;
    }

    private isRenderableExpression(expression: ts.Expression): boolean {
        if (ts.isParenthesizedExpression(expression)) {
            return this.isRenderableExpression(expression.expression);
        }

        if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
            return true;
        }

        if (ts.isConditionalExpression(expression)) {
            return this.isRenderableExpression(expression.whenTrue)
                || this.isRenderableExpression(expression.whenFalse);
        }

        if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return this.isRenderableExpression(expression.right);
        }

        if (ts.isCallExpression(expression)) {
            const callee = expression.expression;
            const calleeText = ts.isPropertyAccessExpression(callee)
                ? callee.getText()
                : ts.isIdentifier(callee)
                    ? callee.text
                    : undefined;
            return calleeText === 'React.createElement' || calleeText === 'createElement';
        }

        return false;
    }

    private containsHookCalls(node: ts.Node | undefined): boolean {
        if (!node) {
            return false;
        }

        let found = false;
        const visit = (child: ts.Node) => {
            if (found) {
                return;
            }

            if (ts.isCallExpression(child)) {
                const hookName = this.getHookName(child.expression);
                if (hookName && /^use[A-Z0-9]/.test(hookName)) {
                    found = true;
                    return;
                }
            }

            ts.forEachChild(child, visit);
        };

        visit(node);
        return found;
    }

    private getHookName(expression: ts.LeftHandSideExpression): string | undefined {
        if (ts.isIdentifier(expression)) {
            return expression.text;
        }

        if (ts.isPropertyAccessExpression(expression)) {
            return expression.name.text;
        }

        return undefined;
    }

    private unwrapReactFactoryInitializer(
        expression: ts.Expression
    ): ts.Expression | undefined {
        let current: ts.Expression | undefined = expression;

        while (current && ts.isCallExpression(current)) {
            const callee = ts.isPropertyAccessExpression(current.expression)
                ? current.expression.getText()
                : ts.isIdentifier(current.expression)
                    ? current.expression.text
                    : undefined;

            if (!callee || !this.reactFactories.has(callee) || current.arguments.length === 0) {
                break;
            }

            const firstArg: ts.Expression | undefined = current.arguments[0];
            if (!firstArg) {
                break;
            }

            current = firstArg;
        }

        return current;
    }

    private getFunctionLikeName(
        node: ts.FunctionExpression | ts.ArrowFunction
    ): string | undefined {
        if (ts.isFunctionExpression(node)) {
            return node.name?.text;
        }

        return undefined;
    }

    private getFunctionComponentModifiers(
        node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
    ): string[] {
        return this.containsHookCalls(node.body)
            ? ['react', 'hooks-component']
            : ['react', 'function-component'];
    }

    private getClassSignature(node: ts.ClassLikeDeclarationBase): string | undefined {
        const heritageClause = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
        return heritageClause?.types[0]?.getText();
    }

    private isReactFunctionLike(
        node: ts.Expression
    ): node is ts.FunctionExpression | ts.ArrowFunction {
        return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    }

    private isPascalCase(name: string): boolean {
        return /^[A-Z][A-Za-z0-9]*$/.test(name);
    }
}
