/* ════════════════════════════════════════════════════════════════════
 * stats.js — 页面访问计数 & Session 调用计数
 *
 * 页面加载时：
 *   - 调用 /api/stats/visit 自增访问计数并显示
 *   - 调用 /api/stats/session/count 获取 Session 调用次数并显示
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

var Stats = {
    /** 页面加载时初始化统计 */
    init: async function () {
        await Promise.allSettled([
            this._initVisit(),
            this._initSession()
        ]);
    },

    /** 访问计数（自增） */
    _initVisit: async function () {
        var el = $('visit-count');
        if (!el) return;
        try {
            var r = await apiFetch('GET', '/api/stats/visit');
            if (r.status === 200 && r.data && r.data.success && r.data.data) {
                el.textContent = formatStatCount(r.data.data.visitCount);
            } else {
                el.textContent = '--';
            }
        } catch (e) {
            el.textContent = '--';
        }
    },

    /** Session 调用计数（只读） */
    _initSession: async function () {
        var el = $('session-count');
        if (!el) return;
        try {
            var r = await apiFetch('GET', '/api/stats/session/count');
            if (r.status === 200 && r.data && r.data.success && r.data.data) {
                el.textContent = formatStatCount(r.data.data.sessionCount);
            } else {
                el.textContent = '--';
            }
        } catch (e) {
            el.textContent = '--';
        }
    }
};

/** 格式化计数（大数字显示优化） */
function formatStatCount(count) {
    if (typeof count !== 'number') return String(count);
    if (count >= 10000) return (count / 10000).toFixed(1) + 'w';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
    return String(count);
}

window.Stats = Stats;
