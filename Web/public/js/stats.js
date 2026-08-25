/* ════════════════════════════════════════════════════════════════════
 * stats.js — 页面访问计数 & Session 调用计数 & Session 并发占用
 *
 * 页面加载时：
 *   - 调用 /api/stats/visit 自增访问计数并显示
 *   - 调用 /api/stats/session/count 获取 Session 调用次数并显示
 *   - 调用 /api/stats/session/concurrency 获取并发占用并显示（15s 轮询刷新）
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

var Stats = {
    _concurrencyTimer: null,
    _concurrencyIntervalMs: 15000,

    /** 页面加载时初始化统计 */
    init: async function () {
        await Promise.allSettled([
            this._initVisit(),
            this._initSession(),
            this.refreshConcurrency()
        ]);
        this._startConcurrencyPolling();
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
    },

    /**
     * Session 并发占用快照（active/limit/waiting）。
     * 占用率着色：<80% 默认色，≥80% 橙色，打满（active==limit 且有排队）红色。
     */
    refreshConcurrency: async function () {
        var el = $('session-concurrency');
        var pill = $('concurrency-pill');
        if (!el) return;
        try {
            var r = await apiFetch('GET', '/api/stats/session/concurrency');
            var d = (r.data && r.data.success && r.data.data) ? r.data.data : null;
            if (!d || typeof d.active !== 'number') { el.textContent = '--'; return; }

            el.textContent = d.active + '/' + d.limit;

            // 悬停提示：占用率 + 排队数
            if (pill) {
                var title = 'AI Session 并发占用：' + d.active + ' / ' + d.limit +
                    '（占用率 ' + (d.utilization || 0) + '%）';
                if (d.waiting > 0) title += '\n排队等待槽位的步骤：' + d.waiting + ' 个';
                title += '\n上限由服务端 MAX_CONCURRENT_SESSIONS 配置';
                pill.title = title;

                pill.classList.remove('conc-high', 'conc-full');
                if (d.active >= d.limit && d.waiting > 0) {
                    pill.classList.add('conc-full');
                } else if (d.active / d.limit >= 0.8) {
                    pill.classList.add('conc-high');
                }
            }
        } catch (e) {
            el.textContent = '--';
        }
    },

    /** 启动并发占用轮询（15s，页面卸载时自动随定时器回收） */
    _startConcurrencyPolling: function () {
        if (this._concurrencyTimer) return;
        var self = this;
        this._concurrencyTimer = setInterval(function () {
            self.refreshConcurrency();
        }, this._concurrencyIntervalMs);
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
