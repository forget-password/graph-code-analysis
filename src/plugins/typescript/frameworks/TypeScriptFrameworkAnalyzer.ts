import * as ts from 'typescript';
import { CodeElement } from '../../../core/types';
import { PreparedScriptFile } from '../../script/ScriptFileInterpreter';
import { TypeScriptAnalysisUtils } from '../TypeScriptAnalysisUtils';

export interface TypeScriptFrameworkAnalyzerContext {
    filePath: string;
    preparedFile: PreparedScriptFile;
    sourceFile: ts.SourceFile;
    utils: TypeScriptAnalysisUtils;
}

export interface TypeScriptFrameworkAnalysisResult {
    elements: CodeElement[];
}

/**
 * TypeScript/JavaScript 语言分析器内的框架扩展点
 */
export interface TypeScriptFrameworkAnalyzer {
    readonly id: string;

    supports(context: TypeScriptFrameworkAnalyzerContext): boolean;
    analyze(context: TypeScriptFrameworkAnalyzerContext): TypeScriptFrameworkAnalysisResult;
}
