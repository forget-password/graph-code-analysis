# GraphIt: Code Analysis Graph

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/forget-password/graph-code-analysis)

[English](./README_EN.md) | [简体中文](./README.md)

This is a powerful VS Code extension that uses an interactive canvas graph to visualize code dependencies and structural relationships.

## 🌟 Features

- 📁 **Folder Analysis**: Analyzes entire project directories and extracts code structure information.
- 🔍 **Language Support**: Built-in support for TypeScript, JavaScript, Vue 2, Vue 3, React Hooks, React Class, and more.
- 🏠 **Home Configuration**: Language parsing rules are generated in the user's home directory, allowing extension of support without modifying the extension's code.
- 🎨 **Interactive Graph**: Visualizes code dependencies with draggable nodes and connecting lines. Dependency arrows accurately point to the source of references.
- 🖱️ **Smart Hover Highlighting**: Hovering over a node automatically highlights relevant dependency paths and dims unrelated nodes and lines, perfectly solving the issues of overlapping lines and visual clutter in complex networks.
- 🔗 **Smart Navigation**: Click on nodes to jump directly to the code definition.
- 🔌 **Plugin Architecture**: Extensible design, making it easy to add support for more languages in the future.
- ⚡ **Performance Optimization**: Supports efficient caching and incremental analysis.

## 🚀 Quick Start

### Installation

1. Install from VS Code Marketplace (Coming soon).
2. Or install via VSIX file:
   - Run `pnpm run install:vsix` in the project to automatically package and install it locally in VS Code.
   - Alternatively, drag and drop the generated `.vsix` file into the VS Code Extensions panel.

### Usage

1. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux).
2. Execute the command: `Code Analysis: Analyze Folder`.
3. Select the folder you want to analyze.
4. View the dependency graph in the opened panel.

## 📋 Commands

- `Code Analysis: Analyze Folder` - Analyzes a specified folder and generates a dependency graph.
- `Code Analysis: Open Dependency Graph` - Opens the graph view panel.
- `Code Analysis: Open Language Config` - Opens the language rules configuration file in the user's home directory.
- `Code Analysis: Reload Language Config` - Reloads language rules without restarting VS Code.

## ⚙️ Configuration

You can configure the extension in the VS Code settings:

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

### Configuration Options

- `codeAnalysis.excludePatterns`: Path patterns to exclude during analysis.
- `codeAnalysis.maxDepth`: Maximum depth for file traversal.
- `codeAnalysis.languageConfigPath`: Optional custom path for the language rules file. Defaults to `~/config/.code-analysis/languages.json` when left empty.
- `codeAnalysis.theme`: Graph theme. Options are `light`, `dark`, or `auto`.
- `codeAnalysis.layout`: Default graph layout algorithm. Options are `elk`, `dagre`, `force`, `circular`, or `radial`.

## 🏠 Home Directory Language Configuration

When the extension is activated for the first time, it automatically creates:

```text
~/config/.code-analysis/languages.json
```

This file contains built-in language rules and serves as the main entry point for adding more languages later.

- `typescript` retains a dedicated AST analyzer for Vue / React / JS / TS.
- `java`, `golang`, `rust`, `c`, `cpp`, `zig`, `csharp` use configurable Regex rules.
- New languages can be added by appending objects to the `languages` array.
- Existing languages can be disabled or tweaked by editing `extensions`, `rootMarkers`, `declarationRules`, and `dependencyRules`.

Example structure:

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

### Rule Field Descriptions

- `analyzer`: Analyzer type, supports `typescript` or `regex`.
- `extensions`: File extensions belonging to the language.
- `rootMarkers`: File markers used to identify the root directory of a project.
- `declarationRules`: Regex rules to extract code elements like `class`, `interface`, `function`, `enum`, etc.
- `dependencyRules`: Regex rules to generate dependency edges.
- `resolver`: How the dependency path maps to a file, such as `relative`, `packageToPath`, `goModule`, `rustModule`, or `external`.
- `allowExternal`: Whether to retain the dependency as an external virtual node in the graph when local resolution fails.

## 🛠️ Development

### Requirements

- Node.js v24.3.0
- pnpm 10.28.0

### Common Commands

```bash
# Clone the repository and install dependencies
git clone https://github.com/forget-password/graph-code-analysis.git
cd graph-code-analysis
pnpm install

# Compile the extension and Webview UI
pnpm run build

# Development watch mode (supports live reload)
pnpm run watch

# Automatically generate a VS Code offline installation package (.vsix)
pnpm run package

# Build and install the package locally with one click
pnpm run install:vsix

# Auto bump version, add a Git Tag, and trigger GitHub Actions release
pnpm run release
```

### Testing

Press `F5` in VS Code to open a new Extension Development Host window and load the current extension.

## 🏗️ Project Structure

```text
src/
├── extension.ts              # Extension entry point
├── commands/                 # Command handlers
├── core/                     # Core logic
│   ├── analyzer/             # Code analysis
│   ├── parser/               # Language parsers
│   ├── graph/                # Graph data structures
│   └── types.ts              # Type definitions
├── plugins/                  # Language plugins
│   ├── base/                 # Base analyzer class
│   ├── typescript/           # TypeScript support
│   └── ...                   # Other languages
└── view/                     # UI components
    └── panel/                # Webview panel
```

## 📝 License

MIT

## 🤝 Contributing

Contributions, issues, and feature requests are welcome. Feel free to check the repository:
[https://github.com/forget-password/graph-code-analysis](https://github.com/forget-password/graph-code-analysis)

## 📧 Contact

If you have any feedback or feature suggestions, please submit them via the [GitHub Issue Tracker](https://github.com/forget-password/graph-code-analysis/issues).
