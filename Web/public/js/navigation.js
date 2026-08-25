/* ════════════════════════════════════════════════════════════════════
 * navigation.js — 视图模式切换 + 功能面板导航 + URL Hash 持久化
 *
 * 两层结构：
 *   1. ViewMode（顶栏切换器）：功能工作台 ↔ 循环控制台 ↔ 知识管理
 *      - loop 模式：隐藏左侧 nav，循环控制台独占全宽
 *      - knowledge 模式：隐藏左侧 nav，知识管理独占全宽
 *      - features 模式：显示左侧 nav，选择功能面板操作
 *   2. Nav（左侧导航）：功能面板切换 + 懒加载初始化
 *
 * URL Hash 规则：
 *   - #loop              → 循环控制台
 *   - #knowledge         → 知识管理
 *   - #p-codecheck       → 功能工作台 / PR 代码检视
 *   - 其他 #p-xxx        → 功能工作台 / 对应面板
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 视图模式管理 ──────────────────────────────────────────────────── */
var ViewMode = {
    _current: 'features',
    _loopInited: false,
    _knowledgeInited: false,

    /**
     * 切换视图模式
     * @param {string} mode - 'loop' | 'knowledge' | 'features'
     */
    set: function (mode) {
        this._current = mode;
        document.querySelector('.layout').setAttribute('data-view', mode);

        // 更新切换器按钮激活态
        document.querySelectorAll('.view-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });

        if (mode === 'loop') {
            // 切到循环控制台时，隐藏所有功能面板（移除 .active），避免与 loop 面板同时可见
            document.querySelectorAll('#main > .panel:not(#p-loop):not(#p-knowledge)').forEach(function (p) {
                p.classList.remove('active');
            });
            // 懒加载初始化循环控制台
            if (!this._loopInited && typeof initLoopPanel === 'function') {
                this._loopInited = true;
                initLoopPanel();
            }
            history.replaceState(null, '', '#loop');
        } else if (mode === 'knowledge') {
            // 切到知识管理时，隐藏所有功能面板（移除 .active），避免与知识面板同时可见
            document.querySelectorAll('#main > .panel:not(#p-loop):not(#p-knowledge)').forEach(function (p) {
                p.classList.remove('active');
            });
            // 懒加载初始化知识管理面板
            if (!this._knowledgeInited && typeof initKnowledgePanel === 'function') {
                this._knowledgeInited = true;
                initKnowledgePanel();
            }
            history.replaceState(null, '', '#knowledge');
        } else {
            // 切到功能工作台时，确保有一个功能面板处于激活态
            var hasActive = document.querySelector('#main > .panel:not(#p-loop):not(#p-knowledge).active');
            if (!hasActive) {
                Nav.switchTo('p-codecheck');
            }
        }

        localStorage.setItem('view-mode', mode);
    },

    /** 初始化视图模式 */
    init: function () {
        // 绑定切换器按钮
        document.querySelectorAll('.view-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                ViewMode.set(btn.dataset.view);
            });
        });

        // 恢复状态：URL Hash > localStorage > 默认 features
        var hash = location.hash.slice(1);
        if (hash === 'loop') {
            this.set('loop');
        } else if (hash === 'knowledge' || hash === 'p-knowledge') {
            this.set('knowledge');
        } else if (hash && hash.startsWith('p-')) {
            // hash 指向某个功能面板 → 切到 features 模式并激活该面板
            var target = document.getElementById(hash);
            if (target && target.classList.contains('panel') && hash !== 'p-loop' && hash !== 'p-knowledge') {
                this.set('features');
                Nav.switchTo(hash);
                return;
            }
            this.set('features');
        } else {
            // 无 hash，查 localStorage
            var saved = localStorage.getItem('view-mode');
            if (saved === 'loop') {
                this.set('loop');
            } else if (saved === 'knowledge') {
                this.set('knowledge');
            } else {
                this.set('features');
            }
        }
    }
};

/* ─── 功能面板导航 ──────────────────────────────────────────────────── */
var Nav = {
    /** 面板初始化注册表：panelId → initFn（只执行一次） */
    _initMap: {},
    _initialized: {},

    /**
     * 注册面板初始化函数
     * @param {string} panelId - 面板 DOM ID
     * @param {function} initFn - 初始化函数（首次激活时调用）
     */
    register: function (panelId, initFn) {
        this._initMap[panelId] = initFn;
    },

    /**
     * 切换到指定功能面板（不影响循环控制台）
     * @param {string} panelId
     */
    switchTo: function (panelId) {
        // 更新 nav-item 激活态
        document.querySelectorAll('.nav-item').forEach(function (n) {
            n.classList.toggle('active', n.dataset.panel === panelId);
        });

        // 显示/隐藏功能面板（排除 #p-loop / #p-knowledge，它们由 ViewMode 控制）
        document.querySelectorAll('#main > .panel:not(#p-loop):not(#p-knowledge)').forEach(function (p) {
            p.classList.toggle('active', p.id === panelId);
        });

        // 懒加载初始化
        if (!this._initialized[panelId] && this._initMap[panelId]) {
            this._initialized[panelId] = true;
            try {
                this._initMap[panelId]();
            } catch (e) {
                console.error('[Nav] 面板初始化失败 [' + panelId + ']:', e);
            }
        }

        // URL Hash 持久化（功能面板的 hash 以 p- 开头）
        history.replaceState(null, '', '#' + panelId);
    },

    /** 初始化功能面板导航 */
    init: function () {
        var self = this;

        // 绑定 nav-item 点击事件
        document.querySelectorAll('.nav-item').forEach(function (el) {
            el.addEventListener('click', function () {
                if (el.classList.contains('nav-item-disabled')) {
                    toast('info', '该功能即将支持，敬请期待');
                    return;
                }
                var panelId = el.dataset.panel;
                if (panelId) self.switchTo(panelId);
            });
        });
    }
};

window.Nav = Nav;
window.ViewMode = ViewMode;

/* ─── 页面加载入口 ─────────────────────────────────────────────────── */
window.addEventListener('load', function () {
    // 1. 主题（最先执行，避免闪烁）
    Theme.init();

    // 2. 健康检查（异步，不阻塞）
    Health.startPolling();

    // 3. 统计计数（异步，不阻塞）
    Stats.init();

    // 4. 功能面板导航绑定
    Nav.init();

    // 5. 视图模式初始化（恢复 hash / localStorage，触发懒加载）
    ViewMode.init();
});
