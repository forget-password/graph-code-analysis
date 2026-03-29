import * as vscode from 'vscode';

/**
 * 代码元素类型
 */
export enum CodeElementKind {
    File = 'file',
    Component = 'component',
    Class = 'class',
    Interface = 'interface',
    Function = 'function',
    Method = 'method',
    Variable = 'variable',
    Constant = 'constant',
    Property = 'property',
    Enum = 'enum',
    Module = 'module',
}

/**
 * 依赖关系类型
 */
export enum DependencyType {
    Import = 'import',
    Export = 'export',
    Extends = 'extends',
    Implements = 'implements',
    Uses = 'uses',
    Calls = 'calls',
}

/**
 * 代码元素
 */
export interface CodeElement {
    /** 唯一标识符 */
    id: string;
    /** 元素名称 */
    name: string;
    /** 元素类型 */
    kind: CodeElementKind;
    /** 代码位置范围 */
    range: vscode.Range;
    /** 所在文件路径 */
    filePath: string;
    /** 签名（可选） */
    signature?: string;
    /** 子元素 */
    children?: CodeElement[];
    /** 是否导出 */
    isExported?: boolean;
    /** 修饰符 */
    modifiers?: string[];
}

/**
 * 依赖关系
 */
export interface Dependency {
    /** 唯一标识符 */
    id: string;
    /** 源元素 */
    from: CodeElement;
    /** 目标元素 */
    to: CodeElement;
    /** 依赖类型 */
    type: DependencyType;
    /** 依赖位置 */
    location?: vscode.Range;
}

/**
 * 文件分析结果
 */
export interface FileAnalysisResult {
    /** 文件路径 */
    filePath: string;
    /** 代码元素列表 */
    elements: CodeElement[];
    /** 导入的依赖 */
    imports: Dependency[];
    /** 导出的元素 */
    exports: CodeElement[];
    /** 分析时间戳 */
    timestamp: number;
}

/**
 * 图节点
 */
export interface GraphNode {
    /** 节点 ID（文件路径） */
    id: string;
    /** 节点标签（文件名） */
    label: string;
    /** 节点位置 */
    position: { x: number; y: number };
    /** 代码元素列表 */
    elements: CodeElement[];
    /** 是否折叠 */
    collapsed: boolean;
    /** 文件路径 */
    filePath: string;
    /** 是否为虚拟节点（例如外部依赖） */
    isVirtual?: boolean;
}

/**
 * 图边
 */
export interface GraphEdge {
    /** 边 ID */
    id: string;
    /** 源节点 */
    source: {
        nodeId: string;
        elementId?: string;
    };
    /** 目标节点 */
    target: {
        nodeId: string;
        elementId?: string;
    };
    /** 依赖类型 */
    type: DependencyType;
    /** 连线拐点 */
    vertices?: Array<{ x: number; y: number }>;
}

export type GraphLayoutAlgorithm = 'elk' | 'dagre' | 'force' | 'circular' | 'radial';

/**
 * 图数据
 */
export interface GraphData {
    /** 节点列表 */
    nodes: GraphNode[];
    /** 边列表 */
    edges: GraphEdge[];
    /** 布局信息 */
    layout?: {
        algorithm: GraphLayoutAlgorithm;
        direction?: 'TB' | 'BT' | 'LR' | 'RL';
    };
}

/**
 * 插件配置
 */
export interface PluginConfig {
    /** 插件 ID */
    id: string;
    /** 插件名称 */
    name: string;
    /** 支持的文件扩展名 */
    extensions: string[];
    /** 是否启用 */
    enabled: boolean;
    /** 自定义配置 */
    config?: Record<string, any>;
}
