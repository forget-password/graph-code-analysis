import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { BaseLanguageAnalyzer } from '../base/BaseLanguageAnalyzer';
import {
    CodeElement,
    CodeElementKind,
    Dependency,
    DependencyType,
    FileAnalysisResult,
} from '../../core/types';
import {
    LanguageRuleConfig,
    RegexDeclarationRuleConfig,
    RegexDependencyRuleConfig,
} from '../../config/types';

interface DependencyTarget {
    filePath: string;
    name: string;
}

/**
 * 基于用户规则的通用正则分析器
 * 适合没有专用 AST 解析器时的快速扩展语言支持
 */
export class ConfigurableRegexAnalyzer extends BaseLanguageAnalyzer {
    readonly id: string;
    readonly name: string;
    readonly supportedExtensions: string[];

    private readonly rootMarkers: string[];
    private readonly declarationRules: RegexDeclarationRuleConfig[];
    private readonly dependencyRules: RegexDependencyRuleConfig[];
    private readonly projectRootCache: Map<string, string | null> = new Map();
    private readonly fileExistsCache: Map<string, boolean> = new Map();
    private readonly directoryEntriesCache: Map<string, string[]> = new Map();
    private readonly goModuleCache: Map<string, string | null> = new Map();

    constructor(config: LanguageRuleConfig) {
        super();
        this.id = config.id;
        this.name = config.name;
        this.supportedExtensions = config.extensions;
        this.rootMarkers = config.rootMarkers ?? ['.git'];
        this.declarationRules = config.declarationRules ?? [];
        this.dependencyRules = config.dependencyRules ?? [];
    }

    async analyzeFile(filePath: string, content: string): Promise<FileAnalysisResult> {
        const lineStarts = this.buildLineStarts(content);
        const elements = this.collectElements(filePath, content, lineStarts);
        const imports = await this.collectDependencies(filePath, content);

        return {
            filePath,
            elements,
            imports,
            exports: elements.filter((element) => element.isExported),
            timestamp: Date.now(),
        };
    }

    private collectElements(
        filePath: string,
        content: string,
        lineStarts: number[]
    ): CodeElement[] {
        const elements: CodeElement[] = [];
        const seen = new Set<string>();

        for (const rule of this.declarationRules) {
            for (const match of this.iterateMatches(content, rule.pattern, rule.flags)) {
                const groups = match.groups ?? {};
                const name = groups[rule.nameGroup ?? 'name'];
                if (!name) {
                    continue;
                }

                const key = `${rule.kind}:${name}:${match.index}`;
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                const isExported = rule.exportedGroup
                    ? this.isTruthy(groups[rule.exportedGroup])
                    : (rule.modifiers ?? []).includes('pub');

                elements.push({
                    id: this.generateId(filePath, name, rule.kind),
                    name,
                    kind: rule.kind,
                    range: this.createRange(match.index, match.index + match[0].length, lineStarts),
                    filePath,
                    isExported,
                    children: [],
                    modifiers: rule.modifiers,
                    signature: groups[rule.signatureGroup ?? 'signature'],
                });
            }
        }

        return elements;
    }

    private async collectDependencies(filePath: string, content: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        const seen = new Set<string>();

        for (const rule of this.dependencyRules) {
            for (const match of this.iterateMatches(content, rule.pattern, rule.flags)) {
                const token = match.groups?.[rule.pathGroup ?? 'path']?.trim();
                if (!token) {
                    continue;
                }

                const target = await this.resolveDependencyToken(token, filePath, rule);
                if (!target) {
                    continue;
                }

                const key = `${filePath}->${target.filePath}`;
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                dependencies.push(this.createImportDependency(filePath, target));
            }
        }

        return dependencies;
    }

    private async resolveDependencyToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<DependencyTarget | null> {
        const resolver = rule.resolver ?? 'external';
        let resolvedPath: string | null = null;

        switch (resolver) {
            case 'relative':
                resolvedPath = await this.resolveRelativeToken(token, currentFile, rule);
                break;
            case 'projectRelative':
                resolvedPath = await this.resolveProjectRelativeToken(token, currentFile, rule);
                break;
            case 'packageToPath':
                resolvedPath = await this.resolvePackageToken(token, currentFile, rule);
                break;
            case 'goModule':
                resolvedPath = await this.resolveGoModuleToken(token, currentFile, rule);
                break;
            case 'rustModule':
                resolvedPath = await this.resolveRustModuleToken(token, currentFile, rule);
                break;
            case 'external':
            default:
                resolvedPath = null;
                break;
        }

        if (resolvedPath) {
            return {
                filePath: resolvedPath,
                name: path.basename(resolvedPath),
            };
        }

        if (rule.allowExternal) {
            return {
                filePath: this.createExternalId(token),
                name: token,
            };
        }

        return null;
    }

    private async resolveRelativeToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const candidates: string[] = [];
        const currentDir = path.dirname(currentFile);

        if (token.startsWith('.')) {
            candidates.push(path.resolve(currentDir, token));
        } else {
            candidates.push(path.resolve(currentDir, token));
            const projectRoot = await this.findProjectRoot(currentFile);
            if (projectRoot) {
                for (const searchRoot of rule.searchRoots ?? []) {
                    candidates.push(path.resolve(projectRoot, searchRoot, token));
                }
            }
        }

        return this.resolveFirstExistingPath(candidates, rule);
    }

    private async resolveProjectRelativeToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const projectRoot = await this.findProjectRoot(currentFile);
        if (!projectRoot) {
            return null;
        }

        return this.resolveFirstExistingPath([path.resolve(projectRoot, token)], rule);
    }

    private async resolvePackageToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const projectRoot = await this.findProjectRoot(currentFile);
        if (!projectRoot) {
            return null;
        }

        const normalizedPath = token.split(rule.moduleSeparator ?? '.').join(path.sep);
        const roots = rule.searchRoots?.length ? rule.searchRoots : ['.'];
        const candidates = roots.map((root) => path.resolve(projectRoot, root, normalizedPath));
        return this.resolveFirstExistingPath(candidates, rule);
    }

    private async resolveGoModuleToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const projectRoot = await this.findProjectRoot(currentFile);
        if (!projectRoot) {
            return null;
        }

        const moduleName = await this.readGoModuleName(projectRoot);
        let relativeImport = token;

        if (moduleName) {
            if (token === moduleName) {
                relativeImport = '';
            } else if (token.startsWith(`${moduleName}/`)) {
                relativeImport = token.slice(moduleName.length + 1);
            } else if (!token.startsWith('./') && !token.startsWith('../')) {
                return null;
            }
        }

        const basePath = relativeImport.startsWith('.')
            ? path.resolve(path.dirname(currentFile), relativeImport)
            : path.resolve(projectRoot, relativeImport);

        return this.resolveFirstExistingPath([basePath], rule);
    }

    private async resolveRustModuleToken(
        token: string,
        currentFile: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const projectRoot = await this.findProjectRoot(currentFile);
        const modulePath = token.replace(/;$/, '');

        if (!modulePath || modulePath.startsWith('std::') || modulePath.startsWith('core::')) {
            return null;
        }

        if (modulePath.startsWith('crate::')) {
            if (!projectRoot) {
                return null;
            }

            return this.resolveSegmentedModulePath(
                path.resolve(projectRoot, 'src'),
                modulePath.slice('crate::'.length).split('::'),
                rule
            );
        }

        if (modulePath.startsWith('self::')) {
            return this.resolveSegmentedModulePath(
                path.dirname(currentFile),
                modulePath.slice('self::'.length).split('::'),
                rule
            );
        }

        if (modulePath.startsWith('super::')) {
            return this.resolveSegmentedModulePath(
                path.resolve(path.dirname(currentFile), '..'),
                modulePath.slice('super::'.length).split('::'),
                rule
            );
        }

        return this.resolveSegmentedModulePath(
            path.dirname(currentFile),
            modulePath.split('::'),
            rule
        );
    }

    private async resolveSegmentedModulePath(
        baseDirectory: string,
        segments: string[],
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const filteredSegments = segments.filter(Boolean);

        for (let length = filteredSegments.length; length > 0; length -= 1) {
            const candidate = path.resolve(baseDirectory, ...filteredSegments.slice(0, length));
            const resolved = await this.resolveFirstExistingPath([candidate], rule);
            if (resolved) {
                return resolved;
            }
        }

        return null;
    }

    private async resolveFirstExistingPath(
        basePaths: string[],
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        for (const basePath of basePaths) {
            const resolved = await this.resolvePathCandidates(basePath, rule);
            if (resolved) {
                return resolved;
            }
        }

        return null;
    }

    private async resolvePathCandidates(
        basePath: string,
        rule: RegexDependencyRuleConfig
    ): Promise<string | null> {
        const candidateExtensions = rule.candidateExtensions ?? [];
        const directoryIndexFiles = rule.directoryIndexFiles ?? [];
        const directCandidates: string[] = [];

        if (path.extname(basePath)) {
            directCandidates.push(basePath);
        } else {
            directCandidates.push(basePath);
            for (const extension of candidateExtensions) {
                directCandidates.push(`${basePath}${extension}`);
            }
        }

        for (const candidate of directCandidates) {
            if (await this.fileExists(candidate)) {
                return candidate;
            }
        }

        const directoryEntries = await this.readDirectoryEntries(basePath);
        if (directoryEntries) {
            for (const indexFile of directoryIndexFiles) {
                const indexCandidate = path.join(basePath, indexFile);
                if (await this.fileExists(indexCandidate)) {
                    return indexCandidate;
                }
            }

            const sortedEntries = [...directoryEntries].sort((left, right) => left.localeCompare(right));
            for (const entry of sortedEntries) {
                if (candidateExtensions.some((extension) => entry.endsWith(extension))) {
                    return path.join(basePath, entry);
                }
            }
        }

        return null;
    }

    private async findProjectRoot(filePath: string): Promise<string | null> {
        let currentDirectory = path.dirname(filePath);
        const visitedDirectories: string[] = [];

        while (true) {
            if (this.projectRootCache.has(currentDirectory)) {
                const cached = this.projectRootCache.get(currentDirectory) ?? null;
                visitedDirectories.forEach((directory) => this.projectRootCache.set(directory, cached));
                return cached;
            }

            visitedDirectories.push(currentDirectory);

            if (await this.directoryContainsAnyMarker(currentDirectory)) {
                visitedDirectories.forEach((directory) => this.projectRootCache.set(directory, currentDirectory));
                return currentDirectory;
            }

            const parentDirectory = path.dirname(currentDirectory);
            if (parentDirectory === currentDirectory) {
                visitedDirectories.forEach((directory) => this.projectRootCache.set(directory, null));
                return null;
            }

            currentDirectory = parentDirectory;
        }
    }

    private async directoryContainsAnyMarker(directory: string): Promise<boolean> {
        for (const marker of this.rootMarkers) {
            if (await this.directoryContainsMarker(directory, marker)) {
                return true;
            }
        }

        return false;
    }

    private async directoryContainsMarker(directory: string, marker: string): Promise<boolean> {
        if (!marker.includes('*')) {
            return this.fileExists(path.join(directory, marker));
        }

        const entries = await this.readDirectoryEntries(directory);
        if (!entries) {
            return false;
        }

        const matcher = this.createWildcardRegex(marker);
        return entries.some((entry) => matcher.test(entry));
    }

    private createWildcardRegex(pattern: string): RegExp {
        const escaped = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`);
    }

    private async readGoModuleName(projectRoot: string): Promise<string | null> {
        if (this.goModuleCache.has(projectRoot)) {
            return this.goModuleCache.get(projectRoot) ?? null;
        }

        try {
            const goModPath = path.join(projectRoot, 'go.mod');
            const content = await fs.readFile(goModPath, 'utf8');
            const match = content.match(/^\s*module\s+(.+)\s*$/m);
            const moduleName = match?.[1]?.trim() ?? null;
            this.goModuleCache.set(projectRoot, moduleName);
            return moduleName;
        } catch {
            this.goModuleCache.set(projectRoot, null);
            return null;
        }
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

    private async readDirectoryEntries(directoryPath: string): Promise<string[] | null> {
        if (this.directoryEntriesCache.has(directoryPath)) {
            return this.directoryEntriesCache.get(directoryPath) ?? [];
        }

        try {
            const entries = await fs.readdir(directoryPath);
            this.directoryEntriesCache.set(directoryPath, entries);
            return entries;
        } catch {
            return null;
        }
    }

    private iterateMatches(content: string, pattern: string, flags = ''): IterableIterator<RegExpExecArray> {
        const regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);

        return (function* generator() {
            let match: RegExpExecArray | null;
            while ((match = regex.exec(content)) !== null) {
                yield match;

                if (match[0].length === 0) {
                    regex.lastIndex += 1;
                }
            }
        })();
    }

    private createImportDependency(filePath: string, target: DependencyTarget): Dependency {
        return {
            id: `${filePath}->${target.filePath}`,
            from: {
                id: filePath,
                name: path.basename(filePath),
                kind: CodeElementKind.File,
                range: new vscode.Range(0, 0, 0, 0),
                filePath,
            },
            to: {
                id: target.filePath,
                name: target.name,
                kind: CodeElementKind.File,
                range: new vscode.Range(0, 0, 0, 0),
                filePath: target.filePath,
            },
            type: DependencyType.Import,
        };
    }

    private buildLineStarts(content: string): number[] {
        const lineStarts = [0];
        for (let index = 0; index < content.length; index += 1) {
            if (content[index] === '\n') {
                lineStarts.push(index + 1);
            }
        }
        return lineStarts;
    }

    private createRange(startOffset: number, endOffset: number, lineStarts: number[]): vscode.Range {
        const start = this.offsetToPosition(startOffset, lineStarts);
        const end = this.offsetToPosition(endOffset, lineStarts);
        return new vscode.Range(start, end);
    }

    private offsetToPosition(offset: number, lineStarts: number[]): vscode.Position {
        let low = 0;
        let high = lineStarts.length - 1;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const lineStart = lineStarts[middle];
            const nextLineStart = middle + 1 < lineStarts.length
                ? lineStarts[middle + 1]
                : Number.MAX_SAFE_INTEGER;

            if (offset < lineStart) {
                high = middle - 1;
            } else if (offset >= nextLineStart) {
                low = middle + 1;
            } else {
                return new vscode.Position(middle, offset - lineStart);
            }
        }

        return new vscode.Position(0, offset);
    }

    private isTruthy(value: string | undefined): boolean {
        return value === 'true' || value === '1' || value === 'yes';
    }

    private createExternalId(token: string): string {
        return `external:${this.id}:${token}`;
    }
}
