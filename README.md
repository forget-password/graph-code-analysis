# GraphIt: Code Analysis Graph

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/forget-password/graph-code-analysis)

[English](./README_EN.md) | [简体中文](./README.md)

这是一个功能强大的 VSCode 扩展，用交互式画布图谱来展示代码之间的依赖关系与结构关联。

## 🌟 功能特性

- 📁 **文件夹分析**：分析整个项目目录，提取代码结构信息
- 🔍 **语言支持**：内置支持 TypeScript、JavaScript、Vue 2、Vue 3、React Hooks、React Class 等语言与框架
- 🏠 **Home 配置**：语言解析规则会生成到用户主目录，无需修改扩展代码即可扩展
- 🎨 **交互式图谱**：通过可拖拽节点和连接线可视化代码依赖关系，依赖箭头精确指向引用源
- 🖱️ **智能悬浮高亮**：鼠标悬浮在节点上时，会自动高亮相关的依赖路径，并淡化无关的节点与连线，完美解决复杂网络下的连线重叠和视觉干扰问题
- 🔗 **智能跳转**：点击节点可直接跳转到代码定义位置
- 🔌 **插件化架构**：可扩展设计，便于后续接入更多语言支持
- ⚡ **性能优化**：支持高效缓存与增量分析

## 🚀 快速开始

### 安装

1. 从 VSCode Marketplace 安装（即将上线）
2. 或通过 VSIX 文件安装：
   - 可以在项目中执行 `pnpm run install:vsix` 自动打包并安装到本地 VS Code
   - 或者手动将生成的 `.vsix` 拖入 VS Code 的扩展面板

### 使用方式

1. 打开命令面板（Mac 为 `Cmd+Shift+P`，Windows/Linux 为 `Ctrl+Shift+P`）
2. 执行命令：`Code Analysis: Analyze Folder`
3. 选择需要分析的文件夹
4. 在打开的面板中查看依赖关系图谱

## 📋 命令列表

- `Code Analysis: Analyze Folder` - 分析指定文件夹并生成依赖图
- `Code Analysis: Open Dependency Graph` - 打开图谱视图面板
- `Code Analysis: Open Language Config` - 打开用户主目录中的语言规则文件
- `Code Analysis: Reload Language Config` - 无需重启 VSCode 即可重新加载语言规则

## ⚙️ 配置说明

可以在 VSCode 设置中配置该扩展：

```json
{
  "codeAnalysis.excludePatterns": [
    "**/node_modules/**",
    "**/build/**",
    "**/.git/**"
  ],
  "codeAnalysis.maxDepth": 10,
  "codeAnalysis.languageConfigPath": "",
  "codeAnalysis.theme": "auto",
  "codeAnalysis.layout": "elk"
}
```

### 配置项

- `codeAnalysis.excludePatterns`：分析时需要排除的路径模式
- `codeAnalysis.maxDepth`：文件遍历的最大深度
- `codeAnalysis.languageConfigPath`：可选的自定义语言规则文件路径。留空时默认使用 `~/config/.code-analysis/languages.json`
- `codeAnalysis.theme`：图谱主题，可选 `light`、`dark` 或 `auto`
- `codeAnalysis.layout`：默认图谱布局算法，可选 `elk`、`dagre`、`force`、`circular` 或 `radial`

## 🏠 主目录语言配置

扩展首次激活时会自动创建：

```text
~/config/.code-analysis/languages.json
```

这个文件包含内置语言规则，也是后续扩展更多语言的主要入口。

- `typescript` 保留了针对 Vue / React / JS / TS 的专用 AST 分析器
- `java`、`golang`、`rust`、`c`、`cpp`、`zig`、`csharp` 使用可配置的正则规则
- 新语言可以通过向 `languages` 数组追加对象的方式接入
- 已有语言也可以通过编辑 `extensions`、`rootMarkers`、`declarationRules` 和 `dependencyRules` 来禁用或微调

示例结构如下：

```json
{
  "version": 1,
  "languages": [
    {
      "id": "golang",
      "name": "Go",
      "analyzer": "regex",
      "enabled": true,
      "extensions": [".go"],
      "rootMarkers": ["go.mod", ".git"],
      "declarationRules": [
        {
          "pattern": "^\\s*func\\s*(?:\\([^)]+\\)\\s*)?(?<name>[A-Za-z_][\\w]*)\\s*\\(",
          "flags": "gm",
          "kind": "function"
        }
      ],
      "dependencyRules": [
        {
          "pattern": "^\\s*import\\s+\"(?<path>[^\"]+)\"",
          "flags": "gm",
          "resolver": "goModule",
          "candidateExtensions": [".go"],
          "allowExternal": true
        }
      ]
    }
  ]
}
```

### 规则字段说明

- `analyzer`：分析器类型，支持 `typescript` 或 `regex`
- `extensions`：归属于该语言的文件扩展名
- `rootMarkers`：用于识别项目根目录的文件标记
- `declarationRules`：用于提取 `class`、`interface`、`function`、`enum` 等代码元素的正则规则
- `dependencyRules`：用于生成依赖边的正则规则
- `resolver`：依赖路径映射到文件的方式，例如 `relative`、`packageToPath`、`goModule`、`rustModule` 或 `external`
- `allowExternal`：当本地解析失败时，是否将该依赖保留为图中的外部虚拟节点

## 🛠️ 开发说明

### 环境要求

- Node.js v24.3.0
- pnpm 10.28.0

### 常用命令

```bash
# 克隆仓库并安装依赖
git clone https://github.com/forget-password/graph-code-analysis.git
cd graph-code-analysis
pnpm install

# 编译扩展和 Webview UI
pnpm run build

# 开发监听模式（支持实时刷新）
pnpm run watch

# 自动生成 VSCode 离线安装包（.vsix）
pnpm run build:vsix

# 生成安装包并一键安装到本地 VS Code
pnpm run install:vsix

# 自动升级版本号，打 Git Tag 并生成安装包
pnpm run release
```

### 测试

在 VSCode 中按下 `F5`，即可打开一个新的 Extension Development Host 窗口，并加载当前扩展。

## 🏗️ 项目结构

```text
src/
├── extension.ts              # 扩展入口
├── commands/                 # 命令处理
├── core/                     # 核心逻辑
│   ├── analyzer/             # 代码分析
│   ├── parser/               # 语言解析器
│   ├── graph/                # 图数据结构
│   └── types.ts              # 类型定义
├── plugins/                  # 语言插件
│   ├── base/                 # 分析器基类
│   ├── typescript/           # TypeScript 支持
│   └── ...                   # 其他语言
└── view/                     # UI 组件
    └── panel/                # Webview 面板
```

## 📝 许可证

MIT

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request，一起完善这个项目：
[https://github.com/forget-password/graph-code-analysis](https://github.com/forget-password/graph-code-analysis)

## 📧 联系方式

如果你有问题反馈或功能建议，请通过 [GitHub Issue Tracker](https://github.com/forget-password/graph-code-analysis/issues) 提交。
