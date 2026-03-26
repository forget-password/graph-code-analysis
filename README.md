# Code Analysis Graph

A powerful VSCode extension that visualizes code dependencies and relationships with an interactive canvas graph.

## 🌟 Features

- 📁 **Folder Analysis**: Analyze entire project folders to extract code structure
- 🔍 **Language Support**: Built-in support for TypeScript, JavaScript, Vue 2, Vue 3, and more
- 🎨 **Interactive Graph**: Visualize code dependencies with draggable nodes and connections
- 🔗 **Smart Navigation**: Click on nodes to jump directly to code definitions
- 🔌 **Plugin Architecture**: Extensible design for adding new language support
- ⚡ **Performance**: Efficient caching and incremental analysis

## 🚀 Quick Start

### Installation

1. Install from VSCode Marketplace (coming soon)
2. Or install from VSIX file

### Usage

1. Open Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Run command: `Code Analysis: Analyze Folder`
3. Select the folder you want to analyze
4. View the dependency graph in the opened panel

## 📋 Commands

- `Code Analysis: Analyze Folder` - Analyze a folder and generate dependency graph
- `Code Analysis: Open Dependency Graph` - Open the graph view panel

## ⚙️ Configuration

Configure the extension in your VSCode settings:

```json
{
  "codeAnalysis.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**"
  ],
  "codeAnalysis.maxDepth": 10,
  "codeAnalysis.theme": "auto",
  "codeAnalysis.layout": "radial"
}
```

### Configuration Options

- `codeAnalysis.excludePatterns`: Patterns to exclude from analysis
- `codeAnalysis.maxDepth`: Maximum depth for file traversal
- `codeAnalysis.theme`: Graph theme (`light`, `dark`, or `auto`)
- `codeAnalysis.layout`: Default graph layout algorithm (`radial`, `dagre`, `force`, or `circular`)

## 🎯 Roadmap

### Phase 1: Core Features ✅
- [x] Project initialization
- [x] Plugin architecture
- [x] TypeScript/JavaScript analyzer
- [x] Basic graph data structure
- [x] Command handlers
- [x] Webview panel

### Phase 2: Graph Visualization (In Progress)
- [ ] JointJS integration
- [ ] Node rendering with file information
- [ ] Orthogonal (right-angle) connections
- [ ] Drag and drop functionality
- [ ] Zoom and pan controls

### Phase 3: Advanced Features
- [ ] Click-to-navigate functionality
- [ ] Search and filter
- [ ] Export to PNG/SVG
- [ ] Layout persistence
- [ ] Performance optimization

### Phase 4: Language Extensions
- [x] Vue 2 / Vue 3 file interpretation
- [ ] React analyzer
- [ ] Flutter/Dart support
- [ ] Golang support

## 🛠️ Development

### Prerequisites

- Node.js v24.3.0
- pnpm 10.28.0

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd vscode-code-analysis

# Install dependencies
pnpm install

# Build the extension
pnpm run build

# Watch mode for development
pnpm run watch
```

### Testing

Press `F5` in VSCode to open a new Extension Development Host window with the extension loaded.

## 🏗️ Architecture

```
src/
├── extension.ts              # Extension entry point
├── commands/                 # Command handlers
├── core/                     # Core logic
│   ├── analyzer/            # Code analysis
│   ├── parser/              # Language parsers
│   ├── graph/               # Graph data structures
│   └── types.ts             # Type definitions
├── plugins/                  # Language plugins
│   ├── base/                # Base analyzer class
│   ├── typescript/          # TypeScript support
│   └── ...                  # Other languages
└── view/                     # UI components
    └── panel/               # Webview panels
```

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Contact

For issues and feature requests, please use the GitHub issue tracker.
