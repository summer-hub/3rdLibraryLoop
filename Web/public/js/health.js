/* ════════════════════════════════════════════════════════════════════
 * health.js — 后端健康检查（共享模块）
 *
 * 所有面板共用一个顶栏健康指示器，由本模块统一管理。
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

var Health = {
    _timer: null,
    _intervalMs: 30000,

    /** 执行一次健康检查，同时更新顶栏指示器和健康面板输出 */
    check: async function () {
        var dot = $('health-dot');
        var label = $('health-label');
        if (!dot) return;
        dot.className = '';
        if (label) label.textContent = '检测中…';

        var out = $('health-out');
        if (out) { out.classList.remove('empty'); out.textContent = '正在检测后端服务…'; }

        var result = null, ok = false;
        try {
            var d = await API.get('/api/health');
            result = d;
            ok = d && d.status === 'ok';
            dot.className = ok ? 'ok' : 'error';
            if (label) label.textContent = ok ? '服务正常' : '服务异常';
        } catch (err) {
            result = { error: err.message };
            dot.className = 'error';
            if (label) label.textContent = '后端不可达';
        }

        if (out) {
            var ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            var json = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            out.innerHTML = '<div style="color:var(--text3);margin-bottom:6px">' + ts + '  ' +
                (ok ? '<span style="color:var(--green)">● 服务正常</span>' : '<span style="color:var(--red)">● 服务异常</span>') +
                '</div><pre style="margin:0;font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-all;">' +
                escapeHtml(json) + '</pre>';
        }
    },

    /** 启动定时健康检查 */
    startPolling: function () {
        this.check();
        var self = this;
        this._timer = setInterval(function () { self.check(); }, this._intervalMs);
    },

    /** 停止定时健康检查 */
    stopPolling: function () {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
};

window.Health = Health;

/** 健康面板按钮调用 */
function doHealthCheck() { Health.check(); }

/** 顶栏健康指示器点击触发检测 */
window.addEventListener('load', function () {
    var tag = $('serverTag');
    if (tag) tag.style.cursor = 'pointer';
    if (tag) tag.onclick = function () { Health.check(); };
});
