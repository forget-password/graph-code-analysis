import * as path from 'path';
import * as ts from 'typescript';
import { PreparedScriptFile, ScriptFileInterpreter } from './ScriptFileInterpreter';

interface VueScriptBlock {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    lang: string;
    isSetup: boolean;
    isSupported: boolean;
}

/**
 * Vue SFC 文件解释器
 * 通过保留脚本内容、掩码其他区域来复用 TypeScript AST，同时保持原始位置信息
 */
export class VueFileInterpreter implements ScriptFileInterpreter {
    readonly id = 'vue-sfc';
    readonly supportedExtensions = ['.vue'];
    private readonly supportedScriptLangs = new Set(['', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);

    canInterpret(filePath: string): boolean {
        return path.extname(filePath).toLowerCase() === '.vue';
    }

    prepare(filePath: string, content: string): PreparedScriptFile {
        const blocks = this.extractScriptBlocks(content);
        const supportedBlocks = blocks.filter((block) => block.isSupported);

        return {
            filePath,
            content: this.maskNonScriptContent(content, supportedBlocks),
            scriptKind: this.resolveScriptKind(supportedBlocks),
            framework: blocks.some((block) => block.isSetup) ? 'vue3' : 'vue2',
            componentName: path.basename(filePath, path.extname(filePath)),
            hasScriptSetup: blocks.some((block) => block.isSetup),
        };
    }

    private extractScriptBlocks(content: string): VueScriptBlock[] {
        const blocks: VueScriptBlock[] = [];
        const scriptTagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

        for (const match of content.matchAll(scriptTagPattern)) {
            const rawBlock = match[0];
            const attrs = match[1] || '';
            const start = match.index ?? 0;
            const openTagEnd = rawBlock.indexOf('>') + 1;
            const closeTagStart = rawBlock.lastIndexOf('</script>');
            const contentStart = start + openTagEnd;
            const contentEnd = start + closeTagStart;
            const lang = this.getAttributeValue(attrs, 'lang');
            const isSetup = this.hasBooleanAttribute(attrs, 'setup');

            blocks.push({
                start,
                end: start + rawBlock.length,
                contentStart,
                contentEnd,
                lang,
                isSetup,
                isSupported: this.supportedScriptLangs.has(lang),
            });
        }

        return blocks;
    }

    private maskNonScriptContent(content: string, scriptBlocks: VueScriptBlock[]): string {
        const masked = content.replace(/[^\n]/g, ' ');
        const chars = masked.split('');

        for (const block of scriptBlocks) {
            for (let i = block.contentStart; i < block.contentEnd; i += 1) {
                chars[i] = content[i];
            }
        }

        return chars.join('');
    }

    private resolveScriptKind(scriptBlocks: VueScriptBlock[]): ts.ScriptKind {
        if (scriptBlocks.some((block) => block.lang === 'tsx')) {
            return ts.ScriptKind.TSX;
        }

        if (scriptBlocks.some((block) => block.lang === 'jsx')) {
            return ts.ScriptKind.JSX;
        }

        if (scriptBlocks.some((block) => block.lang === 'ts')) {
            return ts.ScriptKind.TS;
        }

        return ts.ScriptKind.JS;
    }

    private getAttributeValue(attrs: string, attrName: string): string {
        const attrPattern = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
        const match = attrs.match(attrPattern);
        return match?.[1]?.trim().toLowerCase() ?? '';
    }

    private hasBooleanAttribute(attrs: string, attrName: string): boolean {
        const attrPattern = new RegExp(`(?:^|\\s)${attrName}(?:\\s|=|$)`, 'i');
        return attrPattern.test(attrs);
    }
}
