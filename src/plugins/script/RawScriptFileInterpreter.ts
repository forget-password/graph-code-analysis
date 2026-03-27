import * as path from 'path';
import * as ts from 'typescript';
import { PreparedScriptFile, ScriptFileInterpreter } from './ScriptFileInterpreter';

/**
 * 普通脚本文件解释器
 */
export class RawScriptFileInterpreter implements ScriptFileInterpreter {
    readonly id = 'raw-script';
    readonly supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    canInterpret(filePath: string): boolean {
        return this.supportedExtensions.includes(path.extname(filePath).toLowerCase());
    }

    prepare(filePath: string, content: string): PreparedScriptFile {
        return {
            filePath,
            content,
            scriptKind: this.getScriptKind(filePath),
        };
    }

    private getScriptKind(filePath: string): ts.ScriptKind {
        switch (path.extname(filePath).toLowerCase()) {
            case '.ts':
                return ts.ScriptKind.TS;
            case '.tsx':
                return ts.ScriptKind.TSX;
            case '.jsx':
                return ts.ScriptKind.JSX;
            case '.js':
            case '.mjs':
            case '.cjs':
            default:
                return ts.ScriptKind.JS;
        }
    }
}
