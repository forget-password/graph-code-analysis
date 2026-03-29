import { CodeElementKind } from '../core/types';

export type AnalyzerMode = 'typescript' | 'regex';
export type PathBase = 'projectRoot' | 'currentDir';
export type RegexDependencyResolver =
    | 'relative'
    | 'projectRelative'
    | 'packageToPath'
    | 'goModule'
    | 'rustModule'
    | 'external';

export interface PathAliasConfig {
    prefix: string;
    target: string;
    base?: PathBase;
}

export interface RegexDeclarationRuleConfig {
    pattern: string;
    flags?: string;
    kind: CodeElementKind;
    nameGroup?: string;
    signatureGroup?: string;
    exportedGroup?: string;
    modifiers?: string[];
}

export interface RegexDependencyRuleConfig {
    pattern: string;
    flags?: string;
    pathGroup?: string;
    resolver?: RegexDependencyResolver;
    base?: PathBase;
    searchRoots?: string[];
    candidateExtensions?: string[];
    moduleSeparator?: string;
    directoryIndexFiles?: string[];
    allowExternal?: boolean;
}

export interface LanguageRuleConfig {
    id: string;
    name: string;
    analyzer: AnalyzerMode;
    enabled?: boolean;
    extensions: string[];
    rootMarkers?: string[];
    pathAliases?: PathAliasConfig[];
    frameworks?: string[];
    declarationRules?: RegexDeclarationRuleConfig[];
    dependencyRules?: RegexDependencyRuleConfig[];
}

export interface LanguageConfigFile {
    version: number;
    languages: LanguageRuleConfig[];
}
