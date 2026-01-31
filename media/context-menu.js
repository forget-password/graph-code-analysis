/**
 * 右键菜单组件
 */
class ContextMenu {
    constructor(graphRenderer) {
        this.graphRenderer = graphRenderer;
        this.menu = null;
        this.currentTarget = null;
        this.setupMenu();
        this.bindEvents();
    }

    /**
     * 设置菜单 DOM
     */
    setupMenu() {
        const menuHtml = `
      <div id="context-menu" class="context-menu hidden">
        <div class="menu-items" id="menu-items"></div>
      </div>
    `;
        document.body.insertAdjacentHTML('beforeend', menuHtml);
        this.menu = document.getElementById('context-menu');
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 点击其他地方关闭菜单
        document.addEventListener('click', () => {
            this.hide();
        });

        // 防止菜单内点击关闭菜单
        this.menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 绑定画布右键
        this.graphRenderer.paper.on('blank:contextmenu', (evt) => {
            evt.preventDefault();
            this.showCanvasMenu(evt.clientX, evt.clientY);
        });

        // 绑定节点右键
        this.graphRenderer.paper.on('element:contextmenu', (elementView, evt) => {
            evt.preventDefault();
            const element = elementView.model;
            this.showNodeMenu(evt.clientX, evt.clientY, element);
        });
    }

    /**
     * 显示节点菜单
     */
    showNodeMenu(x, y, element) {
        const nodeId = element.get('nodeId');
        const items = [
            {
                icon: '📂',
                label: 'Open File',
                action: () => {
                    vscode.postMessage({
                        type: 'nodeClicked',
                        data: { nodeId }
                    });
                }
            },
            {
                icon: '🔍',
                label: 'Find References',
                action: () => {
                    vscode.postMessage({
                        type: 'findReferences',
                        data: { nodeId }
                    });
                }
            },
            { divider: true },
            {
                icon: '🎨',
                label: 'Highlight Node',
                action: () => {
                    this.highlightNode(element);
                }
            },
            {
                icon: '📍',
                label: 'Pin Node',
                action: () => {
                    this.pinNode(element);
                }
            },
            { divider: true },
            {
                icon: '👁️',
                label: 'Hide Node',
                action: () => {
                    this.hideNode(element);
                }
            },
            {
                icon: '🗑️',
                label: 'Remove from View',
                action: () => {
                    element.remove();
                }
            }
        ];

        this.showMenu(x, y, items);
    }

    /**
     * 显示画布菜单
     */
    showCanvasMenu(x, y) {
        const items = [
            {
                icon: '🔍',
                label: 'Fit to View',
                action: () => {
                    this.graphRenderer.fitToView();
                }
            },
            {
                icon: '↺',
                label: 'Reset Zoom',
                action: () => {
                    this.graphRenderer.resetZoom();
                }
            },
            {
                icon: '📐',
                label: 'Re-layout',
                action: () => {
                    this.graphRenderer.relayout();
                }
            },
            { divider: true },
            {
                icon: '💾',
                label: 'Export as PNG',
                action: () => {
                    this.graphRenderer.exportToPNG();
                }
            },
            {
                icon: '💾',
                label: 'Export as SVG',
                action: () => {
                    this.exportAsSVG();
                }
            },
            { divider: true },
            {
                icon: '🔄',
                label: 'Refresh Graph',
                action: () => {
                    vscode.postMessage({ type: 'refreshGraph' });
                }
            },
            {
                icon: '⚙️',
                label: 'Settings',
                action: () => {
                    vscode.postMessage({ type: 'openSettings' });
                }
            }
        ];

        this.showMenu(x, y, items);
    }

    /**
     * 显示菜单
     */
    showMenu(x, y, items) {
        const menuItems = document.getElementById('menu-items');
        menuItems.innerHTML = '';

        items.forEach(item => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'menu-divider';
                menuItems.appendChild(divider);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item';
                menuItem.innerHTML = `
          <span class="menu-icon">${item.icon}</span>
          <span class="menu-label">${item.label}</span>
        `;
                menuItem.addEventListener('click', () => {
                    item.action();
                    this.hide();
                });
                menuItems.appendChild(menuItem);
            }
        });

        // 定位菜单
        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';
        this.menu.classList.remove('hidden');

        // 确保菜单不超出视口
        this.adjustPosition();
    }

    /**
     * 调整菜单位置避免超出视口
     */
    adjustPosition() {
        const rect = this.menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (rect.right > viewportWidth) {
            this.menu.style.left = (viewportWidth - rect.width - 10) + 'px';
        }

        if (rect.bottom > viewportHeight) {
            this.menu.style.top = (viewportHeight - rect.height - 10) + 'px';
        }
    }

    /**
     * 隐藏菜单
     */
    hide() {
        this.menu.classList.add('hidden');
    }

    /**
     * 高亮节点
     */
    highlightNode(element) {
        // 移除所有高亮
        this.graphRenderer.graph.getElements().forEach(el => {
            el.attr('body/stroke', 'rgba(128, 128, 128, 0.3)');
            el.attr('body/strokeWidth', 1.5);
        });

        // 高亮当前节点
        element.attr('body/stroke', '#FFD700');
        element.attr('body/strokeWidth', 3);
    }

    /**
     * 固定节点
     */
    pinNode(element) {
        const isPinned = element.get('pinned');
        if (isPinned) {
            element.set('pinned', false);
            element.attr('body/stroke', 'rgba(128, 128, 128, 0.3)');
        } else {
            element.set('pinned', true);
            element.attr('body/stroke', '#FF6B6B');
            element.attr('body/strokeWidth', 2);
        }
    }

    /**
     * 隐藏节点
     */
    hideNode(element) {
        element.attr('body/opacity', 0.1);
        element.attr('label/opacity', 0.1);

        // 隐藏相关连线
        const links = this.graphRenderer.graph.getConnectedLinks(element);
        links.forEach(link => {
            link.attr('line/opacity', 0.1);
            link.attr('.marker-target/opacity', 0.1);
        });
    }

    /**
     * 导出为 SVG
     */
    exportAsSVG() {
        this.graphRenderer.paper.toSVG((svg) => {
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'dependency-graph.svg';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        }, {
            preserveDimensions: true,
            convertImagesToDataUris: true
        });
    }
}

// 导出到全局
window.ContextMenu = ContextMenu;
