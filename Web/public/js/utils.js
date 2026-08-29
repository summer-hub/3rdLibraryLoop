/* ════════════════════════════════════════════════════════════════════
 * utils.js — 共享工具函数
 *
 * 高内聚低耦合：所有面板共用的工具函数集中于此，
 * 各面板 JS（loop.js / knowledge.js / 未来功能）通过全局引用调用。
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/** getElementById 简写 */
function $(id) { return document.getElementById(id); }

/** HTML 转义 */
function escapeHtml(t) {
    if (t == null) return '';
    var d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

/**
 * 内联事件处理器参数转义（兼容 Windows / Mac 路径）。
 *
 * 将任意字符串安全转义后，可嵌入 onclick="fn('...')" 形式的内联处理器：
 *   - 位于双引号 HTML 属性内 → " 与 & 需转义为 HTML 实体；
 *   - 位于单引号 JS 字符串字面量内 → \ 与 ' 需 JS 转义。
 *
 * 关键点：Windows 路径以反斜杠 \ 作分隔符（如 D:\dir\file.md），直接嵌入
 * JS 字符串字面量时，\t 会被解析为 Tab、\d/\s 等会吞掉反斜杠，导致路径
 * 损坏（ENOENT: no such file or directory）。本函数通过转义反斜杠修复之；
 * Mac/Linux 路径以 / 作分隔符，不受影响。
 */
function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
        .replace(/\\/g, '\\\\')   // \ → \\ （修复 Windows 路径反斜杠被吞）
        .replace(/'/g, "\\'")     // ' → \' （闭合单引号 JS 字符串）
        .replace(/\r/g, '\\r')    // 控制符 → JS 转义
        .replace(/\n/g, '\\n')
        .replace(/&/g, '&amp;')   // & 必须先于 " 转义，避免实体被二次转义
        .replace(/"/g, '&quot;')  // " → &quot; （闭合双引号 HTML 属性）
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** 截断字符串 */
function truncate(s, n) {
    if (!s) return '';
    n = n || 60;
    return s.length > n ? s.substring(0, n) + '...' : s;
}

/** 格式化时间戳 */
function formatTime(ts) {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return ts; }
}

/** 复制文本到剪贴板 */
function copyToClipboard(text) {
    if (!text) return;
    try { navigator.clipboard.writeText(text); } catch (e) {}
}

/** Toast 通知 */
function toast(type, msg) {
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    var container = $('toastContainer');
    if (!container) return;
    container.appendChild(el);
    setTimeout(function () {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(function () { el.remove(); }, 300);
    }, 4000);
}

/** API 请求封装 */
var API = {
    _fetch: function (url, opts) {
        return fetch(url, opts).then(function (r) { return r.json(); });
    },
    get: function (url) { return this._fetch(url); },
    post: function (url, body) {
        return this._fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    },
    del: function (url) { return this._fetch(url, { method: 'DELETE' }); }
};

/**
 * 通用 API 请求（带超时保护，适合未来功能面板使用）
 * @param {string} method - HTTP 方法
 * @param {string} path   - 请求路径
 * @param {object} [body] - 请求体
 * @param {number} [timeoutMs=30000] - 超时（毫秒）
 */
async function apiFetch(method, path, body, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    var t0 = Date.now();
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);

    var controller = new AbortController();
    opts.signal = controller.signal;
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
        var res = await fetch(path, opts);
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        return { status: res.status, data: data, elapsed: Date.now() - t0 };
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('请求超时（' + (timeoutMs / 1000) + 's）');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/** 循环任务状态标签映射 */
function statusLabel(s) {
    var m = {
        idle: '空闲', planning: '拆解中', executing: '执行中',
        checking: '审核中', aborting: '任务中止中', passed: '已通过', failed: '未通过',
        aborted: '已终止', error: '错误', loaded: '已加载',
        running: '运行中', completed: '已完成', pending: '待执行',
        ready: '就绪', skipped: '已跳过', blocked: '已阻塞', deadlocked: '死锁'
    };
    return m[s] || s || '—';
}

/**
 * 通用分页管理器（供未来功能面板使用）
 * @param {object} opts - 配置项 { apiPath, listContainerId, emptyId, countId, pagerId, renderPage, pageSize }
 * @returns {object} 分页管理器实例
 */
function createPagination(opts) {
    var pg = {
        apiPath: opts.apiPath,
        listContainerId: opts.listContainerId,
        emptyId: opts.emptyId,
        countId: opts.countId,
        pagerId: opts.pagerId,
        renderPage: opts.renderPage,
        pageSize: opts.pageSize || 20,
        currentPage: 1,
        total: 0,
        totalPages: 1,
        loading: false
    };

    pg.load = async function (page) {
        page = page || 1;
        if (pg.loading) return;
        pg.loading = true;
        try {
            // apiPath 可自带查询参数（如 ?taskIdPrefix=xxx_），此时用 & 拼接分页参数
            var sep = pg.apiPath.indexOf('?') >= 0 ? '&' : '?';
            var r = await apiFetch('GET', pg.apiPath + sep + 'page=' + page + '&pageSize=' + pg.pageSize);
            // 兼容两种响应格式：{ success: true } 或 { status: 'ok' }
            if (!r.data || (!r.data.success && r.data.status !== 'ok')) return;
            pg.currentPage = r.data.page || page;
            pg.total = r.data.total || 0;
            pg.totalPages = r.data.totalPages || 1;
            var tasks = r.data.tasks || [];
            var listEl = $(pg.listContainerId);
            if (listEl) listEl.innerHTML = '';
            var emptyEl = $(pg.emptyId);
            if (emptyEl) emptyEl.style.display = tasks.length > 0 ? 'none' : '';
            var countEl = $(pg.countId);
            if (countEl) countEl.textContent = pg.total + ' 个任务';
            pg.renderPage(tasks, page === 1);
            pg._renderPager();
        } catch (e) {
            console.error('分页加载失败 [' + pg.apiPath + ']:', e.message);
        } finally {
            pg.loading = false;
        }
    };

    pg.go = function (page) {
        if (page >= 1 && page <= pg.totalPages) pg.load(page);
    };

    pg._renderPager = function () {
        var container = $(pg.pagerId);
        if (!container) return;
        if (pg.totalPages <= 1) { container.innerHTML = ''; return; }
        var cur = pg.currentPage, total = pg.totalPages;
        var pages = [];
        if (total <= 7) { for (var i = 1; i <= total; i++) pages.push(i); }
        else {
            pages.push(1);
            if (cur > 4) pages.push('...');
            var start = Math.max(2, cur - 1), end = Math.min(total - 1, cur + 1);
            for (var j = start; j <= end; j++) pages.push(j);
            if (cur < total - 3) pages.push('...');
            pages.push(total);
        }
        var fnName = pg.pagerId.replace(/-/g, '_') + '_go';
        var html = '<div class="pagination">';
        html += '<button class="page-btn ' + (cur === 1 ? 'disabled' : '') + '" ' +
            (cur === 1 ? 'disabled' : 'onclick="' + fnName + '(' + (cur - 1) + ')"') + '>‹</button>';
        pages.forEach(function (p) {
            if (p === '...') html += '<span class="page-ellipsis">…</span>';
            else html += '<button class="page-btn ' + (p === cur ? 'active' : '') + '" onclick="' + fnName + '(' + p + ')">' + p + '</button>';
        });
        html += '<button class="page-btn ' + (cur === total ? 'disabled' : '') + '" ' +
            (cur === total ? 'disabled' : 'onclick="' + fnName + '(' + (cur + 1) + ')"') + '>›</button>';
        html += '<span class="page-info">' + cur + '/' + total + ' 页，共 ' + pg.total + ' 条</span>';
        html += '</div>';
        container.innerHTML = html;
    };

    window[pg.pagerId.replace(/-/g, '_') + '_go'] = function (page) { pg.go(page); };
    return pg;
}
