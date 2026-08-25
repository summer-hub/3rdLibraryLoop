/* ════════════════════════════════════════════════════════════════════
 * theme.js — 日间 / 夜间模式切换
 *
 * - 首次访问时遵循系统偏好 (prefers-color-scheme)
 * - 用户手动切换后保存到 localStorage，后续以此为准
 * - 通过 <html data-theme="light|dark"> 驱动 CSS 变量
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

var Theme = {
    _current: 'light',

    /** 获取当前主题 */
    get current() { return this._current; },

    /** 应用主题到 DOM */
    apply: function (theme) {
        this._current = theme;
        document.documentElement.setAttribute('data-theme', theme);
    },

    /** 切换主题 */
    toggle: function () {
        var next = this._current === 'light' ? 'dark' : 'light';
        this.apply(next);
        localStorage.setItem('theme', next);
    },

    /**
     * 初始化：localStorage > 系统偏好 > 默认 light
     */
    init: function () {
        var saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') {
            this.apply(saved);
        } else {
            var prefersDark = window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.apply(prefersDark ? 'dark' : 'light');
        }
        var btn = $('themeToggle');
        if (btn) btn.onclick = function () { Theme.toggle(); };
    }
};

window.Theme = Theme;
