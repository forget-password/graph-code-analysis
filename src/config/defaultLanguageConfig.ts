import { CodeElementKind } from '../core/types';
import { LanguageConfigFile } from './types';

export const DEFAULT_LANGUAGE_CONFIG: LanguageConfigFile = {
    version: 1,
    languages: [
        {
            id: 'typescript',
            name: 'TypeScript / JavaScript',
            analyzer: 'typescript',
            enabled: true,
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'],
            rootMarkers: ['package.json', 'tsconfig.json', 'jsconfig.json', '.git'],
            pathAliases: [
                { prefix: '@/', target: 'src', base: 'projectRoot' },
                { prefix: '~/', target: '', base: 'projectRoot' },
            ],
            frameworks: ['vue', 'react'],
        },
        {
            id: 'java',
            name: 'Java',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.java'],
            rootMarkers: [
                'pom.xml',
                'build.gradle',
                'build.gradle.kts',
                'settings.gradle',
                'settings.gradle.kts',
                '.git',
            ],
            declarationRules: [
                {
                    pattern: '^\\s*(?:public|protected|private|abstract|final|sealed|non-sealed|static\\s+)*class\\s+(?<name>[A-Za-z_$][\\w$]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:public|protected|private|sealed|non-sealed|static\\s+)*interface\\s+(?<name>[A-Za-z_$][\\w$]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Interface,
                },
                {
                    pattern: '^\\s*(?:public|protected|private|static\\s+)*enum\\s+(?<name>[A-Za-z_$][\\w$]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*(?:public|protected|private|static\\s+)*record\\s+(?<name>[A-Za-z_$][\\w$]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:public|protected|private|static|final|synchronized|abstract|native|default\\s+)*[\\w<>,\\[\\]\\s?]+\\s+(?<name>[A-Za-z_$][\\w$]*)\\s*\\(',
                    flags: 'gm',
                    kind: CodeElementKind.Method,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*import\\s+(?:static\\s+)?(?<path>[A-Za-z_][\\w.]*)\\s*;',
                    flags: 'gm',
                    resolver: 'packageToPath',
                    moduleSeparator: '.',
                    searchRoots: ['src/main/java', 'src/test/java', 'src'],
                    candidateExtensions: ['.java'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'golang',
            name: 'Go',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.go'],
            rootMarkers: ['go.mod', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*package\\s+(?<name>[A-Za-z_][\\w]*)\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Module,
                },
                {
                    pattern: '^\\s*type\\s+(?<name>[A-Za-z_][\\w]*)\\s+struct\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*type\\s+(?<name>[A-Za-z_][\\w]*)\\s+interface\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Interface,
                },
                {
                    pattern: '^\\s*type\\s+(?<name>[A-Za-z_][\\w]*)\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Variable,
                },
                {
                    pattern: '^\\s*func\\s*(?:\\([^)]+\\)\\s*)?(?<name>[A-Za-z_][\\w]*)\\s*\\(',
                    flags: 'gm',
                    kind: CodeElementKind.Function,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*"(?<path>[^"]+)"\\s*$',
                    flags: 'gm',
                    resolver: 'goModule',
                    candidateExtensions: ['.go'],
                    directoryIndexFiles: ['main.go'],
                    allowExternal: true,
                },
                {
                    pattern: '^\\s*import\\s+"(?<path>[^"]+)"',
                    flags: 'gm',
                    resolver: 'goModule',
                    candidateExtensions: ['.go'],
                    directoryIndexFiles: ['main.go'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'rust',
            name: 'Rust',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.rs'],
            rootMarkers: ['Cargo.toml', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*pub\\s+struct\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                    modifiers: ['pub'],
                },
                {
                    pattern: '^\\s*struct\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*pub\\s+enum\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                    modifiers: ['pub'],
                },
                {
                    pattern: '^\\s*enum\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*pub\\s+trait\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Interface,
                    modifiers: ['pub'],
                },
                {
                    pattern: '^\\s*trait\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Interface,
                },
                {
                    pattern: '^\\s*(?:pub\\s+)?fn\\s+(?<name>[A-Za-z_][\\w]*)\\s*\\(',
                    flags: 'gm',
                    kind: CodeElementKind.Function,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*mod\\s+(?<path>[A-Za-z_][\\w]*)\\s*;',
                    flags: 'gm',
                    resolver: 'rustModule',
                    candidateExtensions: ['.rs'],
                    directoryIndexFiles: ['mod.rs'],
                },
                {
                    pattern: '^\\s*use\\s+(?<path>[A-Za-z_][\\w:]*)\\s*;',
                    flags: 'gm',
                    resolver: 'rustModule',
                    candidateExtensions: ['.rs'],
                    directoryIndexFiles: ['mod.rs'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'c',
            name: 'C',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.c', '.h'],
            rootMarkers: ['compile_commands.json', 'Makefile', 'CMakeLists.txt', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*(?:typedef\\s+)?struct\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:typedef\\s+)?enum\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*[A-Za-z_][\\w\\s\\*]*\\s+(?<name>[A-Za-z_][\\w]*)\\s*\\([^;]*\\)\\s*\\{',
                    flags: 'gm',
                    kind: CodeElementKind.Function,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*#include\\s+"(?<path>[^"]+)"',
                    flags: 'gm',
                    resolver: 'relative',
                    searchRoots: ['include', 'src'],
                    candidateExtensions: ['.h', '.hpp', '.hh', '.hxx', '.c', '.cpp', '.cc', '.cxx'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'cpp',
            name: 'C++',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
            rootMarkers: ['compile_commands.json', 'Makefile', 'CMakeLists.txt', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*(?:template\\s*<[^>]+>\\s*)?(?:class|struct)\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*enum(?:\\s+class)?\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*[A-Za-z_:~][\\w\\s:<>,*&]*\\s+(?<name>[A-Za-z_~][\\w:]*)\\s*\\([^;]*\\)\\s*(?:const\\s*)?\\{',
                    flags: 'gm',
                    kind: CodeElementKind.Function,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*#include\\s+"(?<path>[^"]+)"',
                    flags: 'gm',
                    resolver: 'relative',
                    searchRoots: ['include', 'src'],
                    candidateExtensions: ['.h', '.hpp', '.hh', '.hxx', '.cpp', '.cc', '.cxx'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'zig',
            name: 'Zig',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.zig'],
            rootMarkers: ['build.zig', 'build.zig.zon', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*(?:pub\\s+)?const\\s+(?<name>[A-Za-z_][\\w]*)\\s*=\\s*struct\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:pub\\s+)?const\\s+(?<name>[A-Za-z_][\\w]*)\\s*=\\s*enum\\b',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*(?:pub\\s+)?fn\\s+(?<name>[A-Za-z_][\\w]*)\\s*\\(',
                    flags: 'gm',
                    kind: CodeElementKind.Function,
                },
            ],
            dependencyRules: [
                {
                    pattern: '@import\\("(?<path>[^"]+)"\\)',
                    flags: 'gm',
                    resolver: 'relative',
                    candidateExtensions: ['.zig'],
                    allowExternal: true,
                },
            ],
        },
        {
            id: 'csharp',
            name: 'C#',
            analyzer: 'regex',
            enabled: true,
            extensions: ['.cs'],
            rootMarkers: ['*.sln', '*.csproj', '.git'],
            declarationRules: [
                {
                    pattern: '^\\s*(?:public|internal|private|protected|sealed|abstract|partial|static\\s+)*class\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:public|internal|private|protected|partial\\s+)*interface\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Interface,
                },
                {
                    pattern: '^\\s*(?:public|internal|private|protected\\s+)*enum\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Enum,
                },
                {
                    pattern: '^\\s*(?:public|internal|private|protected|partial|readonly|record\\s+)*record\\s+(?<name>[A-Za-z_][\\w]*)',
                    flags: 'gm',
                    kind: CodeElementKind.Class,
                },
                {
                    pattern: '^\\s*(?:public|internal|private|protected|static|async|virtual|override|sealed\\s+)*[A-Za-z_<>,\\[\\]?\\s]+\\s+(?<name>[A-Za-z_][\\w]*)\\s*\\(',
                    flags: 'gm',
                    kind: CodeElementKind.Method,
                },
            ],
            dependencyRules: [
                {
                    pattern: '^\\s*using\\s+(?<path>[A-Za-z_][\\w.]*)\\s*;',
                    flags: 'gm',
                    resolver: 'packageToPath',
                    moduleSeparator: '.',
                    searchRoots: ['src', '.'],
                    candidateExtensions: ['.cs'],
                    allowExternal: true,
                },
            ],
        },
    ],
};
