import * as vscode from 'vscode';
import * as ts from 'typescript';
import { CodeElement, CodeElementKind } from '../../core/types';

interface CreateCodeElementOptions {
    children?: CodeElement[];
    modifiers?: string[];
    signature?: string;
}

/**
 * TypeScript 框架扩展共享的 AST 工具
 */
export class TypeScriptAnalysisUtils {
    createCodeElement(
        name: string,
        kind: CodeElementKind,
        node: ts.Node,
        sourceFile: ts.SourceFile,
        filePath: string,
        isExported: boolean,
        options: CreateCodeElementOptions = {}
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
            children: options.children ?? [],
            modifiers: options.modifiers,
            signature: options.signature,
        };
    }

    getChildren(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): CodeElement[] {
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

    getObjectLiteralProperties(
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

    getPropertyNameText(name: ts.PropertyName | ts.MemberName | undefined): string | undefined {
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

    getExpressionText(expression: ts.Expression): string | undefined {
        if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
            return expression.text;
        }

        if (ts.isPropertyAccessExpression(expression)) {
            return expression.getText();
        }

        return undefined;
    }

    isFunctionLikeExpression(node: ts.Expression): boolean {
        return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    }

    isNodeExported(node: ts.Node): boolean {
        if (!ts.canHaveModifiers(node)) {
            return false;
        }

        const modifiers = ts.getModifiers(node);
        return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) || false;
    }

    private generateId(filePath: string, name: string, kind: string): string {
        return `${filePath}#${kind}#${name}`;
    }
}
