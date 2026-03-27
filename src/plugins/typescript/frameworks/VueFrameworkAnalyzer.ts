import * as path from 'path';
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { CodeElement, CodeElementKind } from '../../../core/types';
import {
    TypeScriptFrameworkAnalyzer,
    TypeScriptFrameworkAnalyzerContext,
} from './TypeScriptFrameworkAnalyzer';

/**
 * Vue 组件语义分析
 */
export class VueFrameworkAnalyzer implements TypeScriptFrameworkAnalyzer {
    readonly id = 'vue';

    supports(context: TypeScriptFrameworkAnalyzerContext): boolean {
        return this.hasHint(context, 'vue');
    }

    analyze(context: TypeScriptFrameworkAnalyzerContext) {
        const { filePath, preparedFile, sourceFile, utils } = context;
        const elements: CodeElement[] = [];

        sourceFile.forEachChild((node) => {
            if (!ts.isExportAssignment(node)) {
                return;
            }

            const element = this.createVueComponentElement(node, context);
            if (element) {
                elements.push(element);
            }
        });

        if (elements.length === 0) {
            elements.push(this.createSyntheticVueComponent(filePath, preparedFile, sourceFile));
        }

        return { elements };
    }

    private createVueComponentElement(
        exportNode: ts.ExportAssignment,
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const { filePath, preparedFile, sourceFile, utils } = context;
        const optionsNode = this.getVueComponentOptions(exportNode.expression);
        const componentName = optionsNode
            ? this.getVueComponentName(optionsNode, utils) || this.getComponentName(filePath, preparedFile)
            : this.getComponentName(filePath, preparedFile);
        const modifiers = this.buildVueModifiers(preparedFile);

        const element = utils.createCodeElement(
            componentName,
            CodeElementKind.Component,
            exportNode,
            sourceFile,
            filePath,
            true,
            { modifiers }
        );

        if (optionsNode) {
            element.children = this.getVueOptionChildren(optionsNode, context);
        }

        const componentFactory = this.getVueComponentFactoryElement(
            exportNode.expression,
            context
        );
        if (componentFactory) {
            element.children = [componentFactory, ...(element.children ?? [])];
        }

        return element;
    }

    private createSyntheticVueComponent(
        filePath: string,
        preparedFile: TypeScriptFrameworkAnalyzerContext['preparedFile'],
        sourceFile: ts.SourceFile
    ): CodeElement {
        const endPosition = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd());
        const name = this.getComponentName(filePath, preparedFile);

        return {
            id: `${filePath}#${CodeElementKind.Component}#${name}`,
            name,
            kind: CodeElementKind.Component,
            range: new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(endPosition.line, endPosition.character)
            ),
            filePath,
            isExported: true,
            children: [],
            modifiers: this.buildVueModifiers(preparedFile),
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
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement | null {
        const { filePath, sourceFile, utils } = context;

        if (!ts.isCallExpression(expression)) {
            return null;
        }

        const factoryName = utils.getExpressionText(expression.expression);
        if (!factoryName) {
            return null;
        }

        return utils.createCodeElement(
            factoryName,
            CodeElementKind.Function,
            expression.expression,
            sourceFile,
            filePath,
            false
        );
    }

    private getVueComponentName(
        optionsNode: ts.ObjectLiteralExpression,
        utils: TypeScriptFrameworkAnalyzerContext['utils']
    ): string | undefined {
        for (const property of optionsNode.properties) {
            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            if (utils.getPropertyNameText(property.name) !== 'name') {
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
        context: TypeScriptFrameworkAnalyzerContext
    ): CodeElement[] {
        const { filePath, sourceFile, utils } = context;
        const children: CodeElement[] = [];

        for (const property of optionsNode.properties) {
            if (ts.isMethodDeclaration(property)) {
                const methodName = utils.getPropertyNameText(property.name);
                if (methodName) {
                    children.push(
                        utils.createCodeElement(
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

            const optionName = utils.getPropertyNameText(property.name);
            if (!optionName) {
                continue;
            }

            if (ts.isObjectLiteralExpression(property.initializer)) {
                if (['methods', 'computed', 'props', 'emits', 'components'].includes(optionName)) {
                    children.push(
                        ...this.getNestedVueOptionMembers(
                            property.initializer,
                            context,
                            optionName
                        )
                    );
                    continue;
                }

                const optionElement = utils.createCodeElement(
                    optionName,
                    CodeElementKind.Property,
                    property,
                    sourceFile,
                    filePath,
                    false
                );
                optionElement.children = utils.getObjectLiteralProperties(
                    property.initializer,
                    sourceFile,
                    filePath
                );
                children.push(optionElement);
                continue;
            }

            const kind = utils.isFunctionLikeExpression(property.initializer)
                ? CodeElementKind.Method
                : CodeElementKind.Property;
            children.push(
                utils.createCodeElement(
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
        context: TypeScriptFrameworkAnalyzerContext,
        optionName: string
    ): CodeElement[] {
        const { filePath, sourceFile, utils } = context;
        const children: CodeElement[] = [];

        for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
                continue;
            }

            if (ts.isMethodDeclaration(property)) {
                const memberName = utils.getPropertyNameText(property.name);
                if (memberName) {
                    children.push(
                        utils.createCodeElement(
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
                children.push(
                    utils.createCodeElement(
                        property.name.text,
                        this.getVueOptionMemberKind(optionName),
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

            const memberName = utils.getPropertyNameText(property.name);
            if (!memberName) {
                continue;
            }

            const child = utils.createCodeElement(
                memberName,
                this.getVueOptionMemberKind(optionName),
                property,
                sourceFile,
                filePath,
                false
            );

            if (ts.isObjectLiteralExpression(property.initializer)) {
                child.children = utils.getObjectLiteralProperties(
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

    private getComponentName(
        filePath: string,
        preparedFile: TypeScriptFrameworkAnalyzerContext['preparedFile']
    ): string {
        return preparedFile.metadata?.componentName as string
            || path.basename(filePath, path.extname(filePath));
    }

    private hasHint(context: TypeScriptFrameworkAnalyzerContext, hint: string): boolean {
        return context.preparedFile.metadata?.hints?.includes(hint) ?? false;
    }

    private buildVueModifiers(preparedFile: TypeScriptFrameworkAnalyzerContext['preparedFile']): string[] {
        const hints = preparedFile.metadata?.hints ?? [];
        return hints.filter((hint) => hint === 'vue' || hint === 'vue2' || hint === 'vue3');
    }
}
