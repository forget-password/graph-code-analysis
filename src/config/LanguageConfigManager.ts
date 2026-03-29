import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_LANGUAGE_CONFIG } from './defaultLanguageConfig';
import { LanguageConfigFile, LanguageRuleConfig } from './types';

export class LanguageConfigManager {
    private readonly configPath: string;
    private readonly defaultConfigPath: string;

    constructor(configPath?: string) {
        this.defaultConfigPath = path.join(
            os.homedir(),
            'config',
            '.code-analysis',
            'languages.json'
        );
        this.configPath = configPath ?? this.defaultConfigPath;
    }

    getConfigPath(): string {
        return this.configPath;
    }

    async ensureConfigFile(): Promise<void> {
        const directory = path.dirname(this.configPath);
        await fs.mkdir(directory, { recursive: true });

        try {
            await fs.access(this.configPath);
        } catch {
            const legacyConfigPath = path.join(os.homedir(), '.code-analysis', 'languages.json');
            if (
                this.configPath === this.defaultConfigPath
                && await this.pathExists(legacyConfigPath)
            ) {
                const legacyContent = await fs.readFile(legacyConfigPath, 'utf8');
                await fs.writeFile(this.configPath, legacyContent, 'utf8');
                return;
            }

            await fs.writeFile(
                this.configPath,
                `${JSON.stringify(DEFAULT_LANGUAGE_CONFIG, null, 2)}\n`,
                'utf8'
            );
        }
    }

    async loadConfig(): Promise<LanguageConfigFile> {
        await this.ensureConfigFile();

        try {
            const rawContent = await fs.readFile(this.configPath, 'utf8');
            const parsed = JSON.parse(rawContent) as Partial<LanguageConfigFile>;
            return this.mergeWithDefaults(parsed);
        } catch (error) {
            console.warn(`[LanguageConfigManager] Failed to load ${this.configPath}`, error);
            return this.cloneDefaults();
        }
    }

    private mergeWithDefaults(userConfig: Partial<LanguageConfigFile>): LanguageConfigFile {
        const defaultLanguages = new Map(
            this.cloneDefaults().languages.map((language) => [language.id, language] as const)
        );
        const userLanguages = Array.isArray(userConfig.languages)
            ? userConfig.languages.filter(this.isLanguageRuleConfig)
            : [];
        const userLanguagesById = new Map(
            userLanguages.map((language) => [language.id, language] as const)
        );
        const mergedLanguages: LanguageRuleConfig[] = [];

        defaultLanguages.forEach((defaultLanguage, id) => {
            const userLanguage = userLanguagesById.get(id);
            mergedLanguages.push(this.mergeLanguage(defaultLanguage, userLanguage));
            userLanguagesById.delete(id);
        });

        userLanguagesById.forEach((language) => {
            mergedLanguages.push(this.normalizeLanguage(language));
        });

        return {
            version: typeof userConfig.version === 'number'
                ? userConfig.version
                : DEFAULT_LANGUAGE_CONFIG.version,
            languages: mergedLanguages,
        };
    }

    private mergeLanguage(
        defaultLanguage: LanguageRuleConfig,
        userLanguage?: LanguageRuleConfig
    ): LanguageRuleConfig {
        if (!userLanguage) {
            return this.normalizeLanguage(defaultLanguage);
        }

        return this.normalizeLanguage({
            ...defaultLanguage,
            ...userLanguage,
            extensions: userLanguage.extensions ?? defaultLanguage.extensions,
            rootMarkers: userLanguage.rootMarkers ?? defaultLanguage.rootMarkers,
            pathAliases: userLanguage.pathAliases ?? defaultLanguage.pathAliases,
            frameworks: userLanguage.frameworks ?? defaultLanguage.frameworks,
            declarationRules: userLanguage.declarationRules ?? defaultLanguage.declarationRules,
            dependencyRules: userLanguage.dependencyRules ?? defaultLanguage.dependencyRules,
        });
    }

    private normalizeLanguage(language: LanguageRuleConfig): LanguageRuleConfig {
        return {
            ...language,
            enabled: language.enabled ?? true,
            extensions: (language.extensions ?? [])
                .map((extension) => extension.trim().toLowerCase())
                .filter((extension) => extension.startsWith('.')),
            rootMarkers: (language.rootMarkers ?? []).filter(Boolean),
            pathAliases: language.pathAliases ?? [],
            frameworks: language.frameworks ?? [],
            declarationRules: language.declarationRules ?? [],
            dependencyRules: language.dependencyRules ?? [],
        };
    }

    private cloneDefaults(): LanguageConfigFile {
        return JSON.parse(JSON.stringify(DEFAULT_LANGUAGE_CONFIG)) as LanguageConfigFile;
    }

    private isLanguageRuleConfig(value: unknown): value is LanguageRuleConfig {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const candidate = value as Partial<LanguageRuleConfig>;
        return typeof candidate.id === 'string'
            && typeof candidate.name === 'string'
            && typeof candidate.analyzer === 'string'
            && Array.isArray(candidate.extensions);
    }

    private async pathExists(targetPath: string): Promise<boolean> {
        try {
            await fs.access(targetPath);
            return true;
        } catch {
            return false;
        }
    }
}
