/**
 * 搜索和过滤功能
 */
class SearchFilter {
    constructor(graphRenderer) {
        this.graphRenderer = graphRenderer;
        this.searchTerm = '';
        this.activeFilters = {
            class: true,
            interface: true,
            function: true,
            method: true,
            variable: true,
            constant: true,
            property: true,
            enum: true,
            module: true
        };
        this.matchedNodes = new Set();
        this.setupUI();
        this.bindEvents();
    }

    /**
     * 设置搜索 UI
     */
    setupUI() {
        // 创建搜索容器
        const searchHtml = `
      <div id="search-container">
        <input type="text" id="search-input" placeholder="🔍 Search files or symbols..." />
        <button id="clear-search" title="Clear search">✕</button>
      </div>
      <div id="search-stats"></div>
    `;

        // 插入到工具栏后面
        const toolbar = document.getElementById('toolbar');
        toolbar.insertAdjacentHTML('afterend', searchHtml);

        // 创建过滤面板（默认隐藏）
        const filterHtml = `
      <div id="filter-panel" class="collapsed">
        <div id="filter-toggle">
          <span>🎯 Filters</span>
          <button id="toggle-filter">▼</button>
        </div>
        <div id="filter-content">
          <div class="filter-group">
            <label class="filter-label">
              <input type="checkbox" id="filter-class" checked />
              <span>🏛️ Classes</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-interface" checked />
              <span>📋 Interfaces</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-function" checked />
              <span>⚡ Functions</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-variable" checked />
              <span>📦 Variables</span>
            </label>
          </div>
          <div class="filter-group">
            <label class="filter-label">
              <input type="checkbox" id="filter-constant" checked />
              <span>🔒 Constants</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-method" checked />
              <span>🔧 Methods</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-property" checked />
              <span>🏷️ Properties</span>
            </label>
            <label class="filter-label">
              <input type="checkbox" id="filter-enum" checked />
              <span>🎯 Enums</span>
            </label>
          </div>
          <div class="filter-actions">
            <button id="select-all-filters">Select All</button>
            <button id="clear-all-filters">Clear All</button>
          </div>
        </div>
      </div>
    `;

        const searchContainer = document.getElementById('search-container');
        searchContainer.insertAdjacentHTML('afterend', filterHtml);
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 搜索输入
        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('input', (e) => {
            this.searchTerm = e.target.value.toLowerCase();
            this.performSearch();
        });

        // 清除搜索
        document.getElementById('clear-search').addEventListener('click', () => {
            searchInput.value = '';
            this.searchTerm = '';
            this.performSearch();
        });

        // 切换过滤面板
        document.getElementById('toggle-filter').addEventListener('click', () => {
            const panel = document.getElementById('filter-panel');
            panel.classList.toggle('collapsed');
            document.getElementById('toggle-filter').textContent =
                panel.classList.contains('collapsed') ? '▼' : '▲';
        });

        // 过滤器选择
        Object.keys(this.activeFilters).forEach(type => {
            const checkbox = document.getElementById(`filter-${type}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    this.activeFilters[type] = e.target.checked;
                    this.performSearch();
                });
            }
        });

        // 全选/清除
        document.getElementById('select-all-filters').addEventListener('click', () => {
            Object.keys(this.activeFilters).forEach(type => {
                this.activeFilters[type] = true;
                const checkbox = document.getElementById(`filter-${type}`);
                if (checkbox) checkbox.checked = true;
            });
            this.performSearch();
        });

        document.getElementById('clear-all-filters').addEventListener('click', () => {
            Object.keys(this.activeFilters).forEach(type => {
                this.activeFilters[type] = false;
                const checkbox = document.getElementById(`filter-${type}`);
                if (checkbox) checkbox.checked = false;
            });
            this.performSearch();
        });
    }

    /**
     * 执行搜索
     */
    performSearch() {
        if (!this.graphRenderer || !this.graphRenderer.graph) {
            return;
        }

        this.matchedNodes.clear();
        const elements = this.graphRenderer.graph.getElements();
        let matchCount = 0;
        let totalNodes = elements.length;

        elements.forEach(element => {
            const nodeId = element.get('nodeId');
            const nodeElements = element.get('elements') || [];

            let shouldShow = false;

            // 如果没有搜索词，检查过滤器
            if (!this.searchTerm) {
                // 检查节点中的元素是否匹配过滤器
                shouldShow = nodeElements.some(el => this.activeFilters[el.kind]);

                // 如果没有元素，默认显示
                if (nodeElements.length === 0) {
                    shouldShow = true;
                }
            } else {
                // 有搜索词，检查文件名匹配
                const fileName = element.get('nodeId');
                if (fileName && fileName.toLowerCase().includes(this.searchTerm)) {
                    shouldShow = true;
                }

                // 检查元素名称匹配
                const matchedElements = nodeElements.filter(el => {
                    return this.activeFilters[el.kind] &&
                        el.name.toLowerCase().includes(this.searchTerm);
                });

                if (matchedElements.length > 0) {
                    shouldShow = true;
                }
            }

            // 显示或隐藏节点
            if (shouldShow) {
                element.attr('body/opacity', 1);
                element.attr('label/opacity', 1);
                this.matchedNodes.add(nodeId);
                matchCount++;
            } else {
                element.attr('body/opacity', 0.2);
                element.attr('label/opacity', 0.2);
            }
        });

        // 更新连线可见性
        this.updateLinksVisibility();

        // 更新搜索统计
        this.updateSearchStats(matchCount, totalNodes);
    }

    /**
     * 更新连线可见性
     */
    updateLinksVisibility() {
        const links = this.graphRenderer.graph.getLinks();

        links.forEach(link => {
            const source = link.getSourceElement();
            const target = link.getTargetElement();

            const sourceVisible = this.matchedNodes.has(source?.get('nodeId'));
            const targetVisible = this.matchedNodes.has(target?.get('nodeId'));

            // 只有当源和目标都可见时，连线才可见
            if (sourceVisible && targetVisible) {
                link.attr('line/opacity', 1);
                link.attr('.marker-target/opacity', 1);
            } else {
                link.attr('line/opacity', 0.1);
                link.attr('.marker-target/opacity', 0.1);
            }
        });
    }

    /**
     * 更新搜索统计
     */
    updateSearchStats(matchCount, totalNodes) {
        const statsDiv = document.getElementById('search-stats');

        if (this.searchTerm || !this.allFiltersActive()) {
            statsDiv.textContent = `Showing ${matchCount} of ${totalNodes} files`;
            statsDiv.style.display = 'block';
        } else {
            statsDiv.style.display = 'none';
        }
    }

    /**
     * 检查是否所有过滤器都激活
     */
    allFiltersActive() {
        return Object.values(this.activeFilters).every(v => v === true);
    }

    /**
     * 高亮匹配的节点
     */
    highlightMatches() {
        if (!this.searchTerm) return;

        const elements = this.graphRenderer.graph.getElements();

        elements.forEach(element => {
            if (this.matchedNodes.has(element.get('nodeId'))) {
                // 添加高亮效果
                element.attr('body/stroke', '#FFD700');
                element.attr('body/strokeWidth', 3);
            } else {
                // 恢复默认样式
                element.attr('body/stroke', 'rgba(128, 128, 128, 0.3)');
                element.attr('body/strokeWidth', 1.5);
            }
        });
    }

    /**
     * 重置搜索
     */
    reset() {
        document.getElementById('search-input').value = '';
        this.searchTerm = '';
        this.matchedNodes.clear();
        this.performSearch();
    }
}

// 导出到全局
window.SearchFilter = SearchFilter;
