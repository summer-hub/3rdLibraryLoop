/* ════════════════════════════════════════════════════════════════════
 * plugins.js — 插件管理面板
 *
 * 数据来自本地端点（cli/lib/web.js 在 /api/* 反代之前拦截）：
 *   GET  /api/plugins         插件状态快照（readState + check）
 *   POST /api/plugins/toggle  {name, enabled, force?} → 写用户 overlay
 *
 * 三条必须如实表达的语义：
 *   1. **写入 ≠ 生效**：开关写的是 ~/.3lib/3rdloop/profiles/<profile>.json，
 *      内核只在进程启动时读它，所以每次成功都提示"重启 3rdloop serve 生效"。
 *   2. **required 不可关**：后端会拒绝，界面先置灰并说明原因，省一次失败的往返。
 *   3. **被依赖的插件要问一声**：关掉它会让依赖方启动即报缺失，确认后才带 force 提交。
 *
 * 懒加载：由 navigation.js 的 Nav.register('p-plugins') 在首次激活面板时调用 init()。
 * （与同目录 panel 脚本一致；不写 'use strict' —— Web/public 在 type:module 的包里，
 *   biome 的 noRedundantUseStrict 会把它算成一条新增告警。）
 * ════════════════════════════════════════════════════════════════════ */

/** 属性值转义（escapeHtml 不处理引号，不能直接用在 title="..." 里） */
function pluginsAttr(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const Plugins = {
    _state: null,
    _busy: false,
    _bound: false,

    /** 面板首次激活：绑定一次性事件 + 拉取状态 */
    init: function () {
        this._bindOnce();
        return this.reload();
    },

    /** 表格里的开关走事件委托，面板重渲染不需要重新绑定 */
    _bindOnce: function () {
        const host = $('plugins-table-wrap');
        if (this._bound || !host) return;
        this._bound = true;
        host.addEventListener('change', function (ev) {
            const el = ev.target;
            if (!el || !el.classList || !el.classList.contains('pl-switch')) return;
            Plugins._toggle(el, el.dataset.plugin, el.checked);
        });
    },

    /**
     * 重新拉取插件状态（开关成功后也走这里，让 check() 的计数同步刷新）。
     * @returns {Promise<boolean>} 是否成功拿到状态
     */
    reload: async function () {
        this._showError('');
        try {
            const r = await apiFetch('GET', '/api/plugins', null, 15000);
            const payload = r.data;
            if (!payload || payload.success !== true || !payload.data) {
                this._fatal((payload && payload.message) || '接口返回异常（HTTP ' + r.status + '）');
                return false;
            }
            this._state = payload.data;
            this._renderMeta(payload.data);
            this._renderTable(payload.data.plugins || []);
            return true;
        } catch (e) {
            this._fatal('读取插件状态失败：' + e.message);
            return false;
        }
    },

    /** 顶部信息条：profile / overlay / errors / warnings / 接缝冲突 */
    _renderMeta: function (data) {
        const host = $('plugins-meta');
        if (!host) return;

        const plugins = data.plugins || [];
        const overlay = data.overlay || {};
        const parts = [];

        parts.push(
            '<div>当前 profile：<b>' +
            escapeHtml(data.profile || '（未解析）') +
            '</b>　插件条目：<b>' +
            plugins.length +
            '</b> 个　开关写入：<code>' +
            escapeHtml(overlay.path || '（未知）') +
            '</code>' +
            (overlay.exists ? '' : '（<span class="plugins-warn">尚未创建，首次开关后生成</span>）') +
            '</div>'
        );

        parts.push(this._judgeRow('错误', data.errors || [], 'plugins-err'));
        parts.push(this._judgeRow('告警', data.warnings || [], 'plugins-warn'));

        // 接缝冲突：同一接缝有多个提供方时必须让人看见"谁在生效"
        const seams = data.seams || {};
        Object.keys(seams).forEach(function (seam) {
            const info = seams[seam] || {};
            if (!info.conflict) return;
            parts.push(
                '<div class="plugins-conflict">接缝 <code>' +
                escapeHtml(seam) +
                '</code> 有多个提供方：' +
                escapeHtml((info.providers || []).join('、')) +
                '　→　当前生效：<b>' +
                escapeHtml(info.effective || '（未解析）') +
                '</b></div>'
            );
        });

        (data.conflicts || []).forEach(function (c) {
            parts.push('<div class="plugins-conflict">' + escapeHtml(typeof c === 'string' ? c : JSON.stringify(c)) + '</div>');
        });

        host.innerHTML = parts.join('');
    },

    /** errors/warnings 计数行：悬停看全量，点开看列表 */
    _judgeRow: function (label, list, cls) {
        if (!list.length) return '<div>' + label + '：<b>0</b> 条</div>';
        const items = list.map(function (m) {
            return '<li>' + escapeHtml(m) + '</li>';
        });
        return (
            '<div>' +
            label +
            '：<b class="' + cls + '">' + list.length + '</b> 条　' +
            '<details style="display:inline-block">' +
            '<summary style="cursor:pointer;color:var(--text3)" title="' +
            pluginsAttr(list.join('\n')) +
            '">查看详情</summary>' +
            '<ul style="margin:4px 0 0 18px;padding:0">' + items.join('') + '</ul>' +
            '</details></div>'
        );
    },

    /** 插件表格：插件名 / 接缝 / 状态 / 来源 / 被依赖 / 操作 */
    _renderTable: function (list) {
        const host = $('plugins-table-wrap');
        if (!host) return;

        if (!list.length) {
            host.innerHTML = '<div class="plugins-empty">没有发现任何插件</div>';
            return;
        }

        const self = this;
        const rows = list.map(function (p) {
            const installed = p.installed === true;
            const dependents = p.dependents || [];

            let status = '<span class="pl-tag pl-off">禁用</span>';
            if (!installed) status = '<span class="pl-tag pl-missing">未安装</span>';
            else if (p.enabled) status = '<span class="pl-tag pl-on">启用</span>';

            const source = p.source === 'builtin' ? '内置' : p.source === 'user' ? '用户' : '—';

            return (
                '<tr>' +
                '<td class="pl-name">' + escapeHtml(p.name) +
                (p.required ? '<span class="pl-required" title="被标记 required，禁用会让启动 fail closed">required</span>' : '') +
                '</td>' +
                '<td class="pl-seam">' + escapeHtml(p.seam || '—') + '</td>' +
                '<td>' + status + '</td>' +
                '<td>' + escapeHtml(source) + '</td>' +
                '<td class="pl-deps">' + (dependents.length ? escapeHtml(dependents.join('、')) : '—') +
                (dependents.length ? '<span class="pl-required">禁用前需确认</span>' : '') + '</td>' +
                '<td>' + self._switchHtml(p, installed) + '</td>' +
                '</tr>'
            );
        });

        host.innerHTML =
            '<table class="plugins-table">' +
            '<thead><tr><th>插件名</th><th>接缝</th><th>状态</th><th>来源</th><th>被依赖</th><th>操作</th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody></table>';
    },

    /** 单个开关：不可操作时置灰并用 title 说明原因（而不是让人点了才报错） */
    _switchHtml: function (p, installed) {
        let reason = '';
        if (!installed) reason = '未安装：profile 提到了它，但插件根里没有这个目录，无法开关';
        else if (p.required) reason = '被标记 required，禁用会让启动 fail closed，因此不可关闭';

        return (
            '<input type="checkbox" class="pl-switch" data-plugin="' + pluginsAttr(p.name) + '"' +
            (p.enabled ? ' checked' : '') +
            (reason ? ' disabled title="' + pluginsAttr(reason) + '"' : ' title="启用 / 禁用该插件"') +
            '>'
        );
    },

    /** 开关动作：确认 → POST → 成功本地更新并提示重启，失败把 message 显示出来 */
    _toggle: async function (el, name, next) {
        const target = this._find(name);
        if (!target) return;

        // 上一次写入还没回来：还原勾选，不发第二个请求（并发写同一 overlay 没有意义）
        if (this._busy) {
            el.checked = !next;
            toast('info', '上一次写入尚未完成，请稍候');
            return;
        }

        let force = false;
        const dependents = target.dependents || [];
        if (!next && dependents.length > 0) {
            const ok = window.confirm(
                '插件 ' + name + ' 正被以下启用中的插件依赖：\n  ' + dependents.join('、') +
                '\n\n禁用后这些插件在启动时会报依赖缺失。仍要禁用吗？'
            );
            if (!ok) {
                el.checked = true;   // 取消：还原勾选，且**不发请求**
                return;
            }
            force = true;   // 用户已确认，显式带上 force，否则服务端会以"被依赖"拒绝
        }

        this._busy = true;
        el.disabled = true;
        try {
            const r = await apiFetch('POST', '/api/plugins/toggle', { name: name, enabled: next, force: force }, 15000);
            const payload = r.data || {};
            if (payload.success === true && payload.data) {
                // 先本地落一下，再以服务端为准刷新：即使随后的 GET 失败，界面也不会回到旧值
                target.enabled = payload.data.enabled === true;
                const warnings = payload.data.warnings || [];
                const file = payload.data.file || '（用户 overlay）';
                const refreshed = await this.reload();
                // 后端恒定要求重启（overlay 只在进程启动时被读），文案直说
                this._notice('已写入 ' + file + '，重启 `3rdloop serve` 生效');
                if (refreshed && warnings.length) this._showError(warnings.join('\n'));
                return;
            }
            this._showError(payload.message || ('开关失败（HTTP ' + r.status + '）'));
            this._renderTable(this._state ? this._state.plugins || [] : []);
        } catch (e) {
            this._showError('开关失败：' + e.message);
            this._renderTable(this._state ? this._state.plugins || [] : []);
        } finally {
            this._busy = false;
            // 重渲染会把这一行整个换掉；没被换掉（例如刷新失败）时至少让它重新可点
            if (el.isConnected) el.disabled = false;
        }
    },

    _find: function (name) {
        const list = (this._state && this._state.plugins) || [];
        for (let i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }
        return null;
    },

    /** 顶部成功提示（写入位置 + 需要重启） */
    _notice: function (msg) {
        const el = $('plugins-notice');
        if (!el) return;
        el.textContent = msg;
        el.style.display = '';
    },

    /** 失败/告警提示：success:false 的 message 必须显示出来，不能静默 */
    _showError: function (msg) {
        const el = $('plugins-error');
        if (!el) return;
        el.textContent = msg || '';
        el.style.display = msg ? '' : 'none';
    },

    /** 连状态都读不到：表格区域给一行可读原因 */
    _fatal: function (msg) {
        this._showError(msg);
        const host = $('plugins-table-wrap');
        if (host) host.innerHTML = '<div class="plugins-empty">无法读取插件状态：' + escapeHtml(msg) + '</div>';
    }
};

window.Plugins = Plugins;

/* 按既有懒加载机制注册：首次切到 #p-plugins 时才拉数据 */
if (window.Nav && typeof window.Nav.register === 'function') {
    window.Nav.register('p-plugins', function () {
        Plugins.init();
    });
}
