import * as ts from 'typescript';

export type ScriptFramework = 'standard' | 'vue2' | 'vue3';

/**
 * 统一后的脚本文件表示
 * 不同文件格式会先被解释为可供 TypeScript AST 处理的脚本文本
 */
export interface PreparedScriptFile {
    filePath: string;
    content: string;
    scriptKind: ts.ScriptKind;
    framework: ScriptFramework;
    componentName?: string;
    hasScriptSetup?: boolean;
}

/**
 * 脚本文件解释器
 * 负责把不同格式的源文件转换为统一的脚本分析输入
 */
export interface ScriptFileInterpreter {
    readonly id: string;
    readonly supportedExtensions: string[];

    canInterpret(filePath: string, content: string): boolean;
    prepare(filePath: string, content: string): PreparedScriptFile;
}
