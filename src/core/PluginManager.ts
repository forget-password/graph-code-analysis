import { ILanguageAnalyzer } from '../core/analyzer/ILanguageAnalyzer';
import { PluginConfig } from '../core/types';

/**
 * 插件管理器
 * 负责注册、管理和查询语言分析器插件
 */
export class PluginManager {
    private static instance: PluginManager;
    private analyzers: Map<string, ILanguageAnalyzer> = new Map();
    private configs: Map<string, PluginConfig> = new Map();

    private constructor() { }

    /**
     * 获取单例实例
     */
    static getInstance(): PluginManager {
        if (!PluginManager.instance) {
            PluginManager.instance = new PluginManager();
        }
        return PluginManager.instance;
    }

    /**
     * 注册语言分析器
     */
    registerAnalyzer(analyzer: ILanguageAnalyzer, config?: PluginConfig): void {
        this.analyzers.set(analyzer.id, analyzer);

        if (config) {
            this.configs.set(analyzer.id, config);
        } else {
            // 创建默认配置
            this.configs.set(analyzer.id, {
                id: analyzer.id,
                name: analyzer.name,
                extensions: analyzer.supportedExtensions,
                enabled: true,
            });
        }

        console.log(`Registered analyzer: ${analyzer.name} (${analyzer.id})`);
    }

    /**
     * 注销语言分析器
     */
    unregisterAnalyzer(analyzerId: string): void {
        this.analyzers.delete(analyzerId);
        this.configs.delete(analyzerId);
        console.log(`Unregistered analyzer: ${analyzerId}`);
    }

    /**
     * 获取语言分析器
     */
    getAnalyzer(analyzerId: string): ILanguageAnalyzer | undefined {
        return this.analyzers.get(analyzerId);
    }

    /**
     * 根据文件路径获取合适的分析器
     */
    getAnalyzerForFile(filePath: string): ILanguageAnalyzer | undefined {
        for (const analyzer of this.analyzers.values()) {
            const config = this.configs.get(analyzer.id);
            if (config?.enabled && analyzer.supportsFile(filePath)) {
                return analyzer;
            }
        }
        return undefined;
    }

    /**
     * 获取所有已注册的分析器
     */
    getAllAnalyzers(): ILanguageAnalyzer[] {
        return Array.from(this.analyzers.values());
    }

    /**
     * 获取所有启用的分析器
     */
    getEnabledAnalyzers(): ILanguageAnalyzer[] {
        return Array.from(this.analyzers.values()).filter((analyzer) => {
            const config = this.configs.get(analyzer.id);
            return config?.enabled !== false;
        });
    }

    /**
     * 获取插件配置
     */
    getConfig(analyzerId: string): PluginConfig | undefined {
        return this.configs.get(analyzerId);
    }

    /**
     * 更新插件配置
     */
    updateConfig(analyzerId: string, config: Partial<PluginConfig>): void {
        const existingConfig = this.configs.get(analyzerId);
        if (existingConfig) {
            this.configs.set(analyzerId, { ...existingConfig, ...config });
        }
    }

    /**
     * 启用插件
     */
    enablePlugin(analyzerId: string): void {
        this.updateConfig(analyzerId, { enabled: true });
    }

    /**
     * 禁用插件
     */
    disablePlugin(analyzerId: string): void {
        this.updateConfig(analyzerId, { enabled: false });
    }

    /**
     * 获取所有支持的文件扩展名
     */
    getSupportedExtensions(): string[] {
        const extensions = new Set<string>();
        for (const analyzer of this.getEnabledAnalyzers()) {
            analyzer.supportedExtensions.forEach((ext) => extensions.add(ext));
        }
        return Array.from(extensions);
    }
}
