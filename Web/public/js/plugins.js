/* ════════════════════════════════════════════════════════════════════
 * plugins.js — 插件管理面板
 *
 * 数据来自本地端点（cli/lib/web.js 在 /api/* 反代之前拦截）：
 *   GET  /api/plugins?profile=<name>  插件状态快照（readState + check）
 *   POST /api/plugins/toggle          {name, enabled, force?, profile?} → 写 overlay
 *   POST /api/plugins/install         {spec, profile?} → 装进 profile 的 node_modules
 *   POST /api/plugins/remove          {name, profile?} → 从 profile 卸载
 *
 * DSH 式的四件事必须如实表达：
 *   1. **一个 profile 一个目录**：插件是该目录的 npm 依赖，页面要能切 profile，
 *      并且切完之后看到的就只是那个 profile 的插件（互不影响）。
 *   2. **写入 ≠ 生效**：开关写的是 `~/.3lib/3rdloop/profiles/<profile>.json`（或
 *      profile 自己的 profile.json），内核只在进程启动时读它，所以每次成功都提示
 *      "重启 3rdloop serve 生效"。
 *   3. **required 不可关**：后端会拒绝，界面先置灰并说明原因，省一次失败的往返。
 *   4. **被依赖的插件要问一声**：关掉它会让依赖方启动即报缺失，确认后才带 force 提交。
 *
 * 懒加载：由 navigation.js 的 Nav.register('p-plugins') 在首次激活面板时调用 init()。
 * （不写 'use strict' —— Web/public 在 type:module 的包里，biome 的
 *  noRedundantUseStrict 会把它算成一条新增告警。）
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

/** 路径末两段（表格里放全路径会把列撑爆；完整路径放 title） */
function pluginsShortPath(dir) {
    if (!dir) return '';
    const parts = String(dir).split(/[\\/]+/).filter(Boolean);
    return parts.length <= 2 ? String(dir) : '…/' + parts.slice(-2).join('/');
}

const Plugins = {
    _state: null,
    /** 当前查看的 profile（null = 用服务端的当前 profile） */
    _profile: null,
    _busy: false,
    _bound: false,

    /** 面板首次激活：绑定一次性事件 + 拉取状态 */
    init: function () {
        this._bindOnce();
        return this.reload();
    },

    /** 表格开关/卸载、profile 下拉、安装按钮都用委托或一次性绑定 */
    _bindOnce: function () {
        const host = $('plugins-table-wrap');
        if (this._bound || !host) return;
        this._bound = true;
        host.addEventListener('change', function (ev) {
            const el = ev.target;
            if (!el || !el.classList || !el.classList.contains('pl-switch')) return;
            Plugins._toggle(el, el.dataset.plugin, el.checked);
        });
        host.addEventListener('click', function (ev) {
            const btn = ev.target && ev.target.closest ? ev.target.closest('.pl-remove') : null;
            if (!btn) return;
            Plugins._remove(btn.dataset.plugin);
        });

        // profile 切换：带 ?profile= 重新拉取（不做路由库，hash 只负责"当前在插件页"）
        const select = $('plugins-profile-select');
        if (select) {
            select.addEventListener('change', function () {
                Plugins._profile = select.value || null;
                try {
                    localStorage.setItem('plugins-profile', Plugins._profile || '');
                } catch { /* 隐私模式下不可写：不影响功能 */ }
                Plugins._syncHash();
                Plugins.reload();
            });
        }

        // 安装：输入 spec + 按钮（回车等价于点按钮）
        const input = $('plugins-install-spec');
        const btnInstall = $('plugins-install-btn');
        if (input && btnInstall) {
            btnInstall.addEventListener('click', function () {
                Plugins._install(input);
            });
            input.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    Plugins._install(input);
                }
            });
        }
    },

    /**
     * 把 URL hash 同步成 #p-plugins。
     * 面板切换本来会由 Nav.switchTo 写 hash；profile 切换不经过 Nav，这里补一次，
     * 避免"地址栏里还指着别的面板"（刷新后回到错误的页面）。
     */
    _syncHash: function () {
        if (location.hash === '#p-plugins') return;
        try {
            history.replaceState(null, '', '#p-plugins');
        } catch { /* 极端环境下不可写，忽略 */ }
    },

    /** 首次进入时从 localStorage 恢复上次选的 profile（没有就不带参数） */
    _restoreProfile: function () {
        if (this._profile) return;
        try {
            const saved = localStorage.getItem('plugins-profile');
            if (saved) this._profile = saved;
        } catch { /* 忽略 */ }
    },

    /**
     * 重新拉取插件状态（开关/安装/卸载成功后也走这里，让 check() 的计数同步刷新）。
     * @returns {Promise<boolean>} 是否成功拿到状态
     */
    reload: async function () {
        this._showError('');
        this._restoreProfile();
        const path = '/api/plugins' + (this._profile ? '?profile=' + encodeURIComponent(this._profile) : '');
        try {
            const r = await apiFetch('GET', path, null, 15000);
            const payload = r.data;
            if (!payload || payload.success !== true || !payload.data) {
                // 400 会带可读 message（如"未知 profile …"），原样显示，别吞掉
                this._fatal((payload && payload.message) || '接口返回异常（HTTP ' + r.status + '）');
                return false;
            }
            this._state = payload.data;
            this._profile = payload.data.profile || this._profile;
            this._renderProfile(payload.data);
            this._renderMeta(payload.data);
            this._renderTable(payload.data.plugins || []);
            return true;
        } catch (e) {
            this._fatal('读取插件状态失败：' + e.message);
            return false;
        }
    },

    /** profile 下拉：选项来自 data.profiles，选中项就是服务端真正用的那个 profile */
    _renderProfile: function (data) {
        const select = $('plugins-profile-select');
        if (!select) return;
        const profiles = Array.isArray(data.profiles) ? data.profiles : [];
        const current = data.profile || '';
        const list = profiles.length ? profiles : (current ? [current] : []);
        select.innerHTML = list.map(function (name) {
            return '<option value="' + pluginsAttr(name) + '"' +
                (name === current ? ' selected' : '') + '>' + escapeHtml(name) + '</option>';
        }).join('');
        select.disabled = list.length < 2;
        this._profile = current || null;
    },

    /** 顶部信息条：profile / profile 目录 / overlay / errors / warnings / 接缝冲突 */
    _renderMeta: function (data) {
        const host = $('plugins-meta');
        if (!host) return;

        const plugins = data.plugins || [];
        const overlay = data.overlay || {};
        const profile = data.profile || '（未解析）';
        const parts = [];

        parts.push(
            '<div>当前 profile：<b>' + escapeHtml(profile) + '</b>　' +
            'profile 目录：<code>' + escapeHtml(data.profileDir || '（未知）') + '</code>' +
            '（插件装在其 <code>node_modules/</code>）</div>'
        );
        parts.push(
            '<div>插件条目：<b>' + plugins.length + '</b> 个　' +
            '开关写入：<code>' + escapeHtml(overlay.path || '（未知）') + '</code>' +
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

    /** 插件表格：插件名 / 接缝 / 状态 / 来源 / 位置 / 被依赖 / 操作 */
    _renderTable: function (list) {
        const host = $('plugins-table-wrap');
        if (!host) return;

        if (!list.length) {
            host.innerHTML = '<div class="plugins-empty">当前 profile 没有发现任何插件</div>';
            return;
        }

        const self = this;
        const rows = list.map(function (p) {
            const installed = p.installed === true;
            const dependents = p.dependents || [];

            let status = '<span class="pl-tag pl-off">禁用</span>';
            if (!installed) status = '<span class="pl-tag pl-missing">未安装</span>';
            else if (p.enabled) status = '<span class="pl-tag pl-on">启用</span>';

            const sourceLabel = {
                builtin: '内置',
                profile: 'profile',
                user: '用户',
                missing: '—'
            }[p.source] || '—';

            // 位置：profile 来源的插件就是 profile 的 npm 依赖，单独标出来；
            // 其余显示路径末两段，完整路径进 title（表格里放全路径会把列撑爆）
            let where;
            if (p.source === 'profile') {
                where = '<span title="' + pluginsAttr(p.dir || '') + '">profile 依赖</span>';
            } else if (p.source === 'builtin') {
                where = '<span title="' + pluginsAttr(p.dir || '') + '">内置包</span>';
            } else if (p.source === 'user') {
                where = '<span title="' + pluginsAttr(p.dir || '') + '">' + escapeHtml(pluginsShortPath(p.dir)) + '</span>';
            } else {
                where = '—';
            }

            // 「卸载」只给 profile / user 两种来源：内置插件随核心包发布，卸载要走包管理器。
            // 放在名字单元格内而不是最右列——最右列在窄窗口会被横向滚动挤出视野。
            const removable = p.source === 'profile' || p.source === 'user';
            const removeBtn = removable
                ? '<button type="button" class="pl-remove" data-plugin="' + pluginsAttr(p.name) +
                  '" title="从 profile ' + pluginsAttr(self._profile || '') + ' 卸载该插件">卸载</button>'
                : '';

            return (
                '<tr>' +
                '<td class="pl-name">' + escapeHtml(p.name) +
                (p.required ? '<span class="pl-required" title="被标记 required，禁用会让启动 fail closed">required</span>' : '') +
                removeBtn +
                '</td>' +
                '<td class="pl-seam">' + escapeHtml(p.seam || '—') + '</td>' +
                '<td>' + status + '</td>' +
                '<td>' + escapeHtml(sourceLabel) + '</td>' +
                '<td class="pl-where">' + where + '</td>' +
                '<td class="pl-deps">' + (dependents.length
                    ? '<span title="这些插件依赖它；禁用前会要求确认">' + escapeHtml(dependents.join('、')) + '</span>'
                    : '—') + '</td>' +
                '<td class="pl-ops">' + self._switchHtml(p, installed) + '</td>' +
                '</tr>'
            );
        });

        host.innerHTML =
            '<table class="plugins-table">' +
            '<thead><tr><th>插件名</th><th>接缝</th><th>状态</th><th>来源</th><th>位置</th>' +
            '<th>被依赖</th><th>操作</th></tr></thead>' +
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
            const r = await apiFetch('POST', '/api/plugins/toggle', {
                name: name,
                enabled: next,
                force: force,
                profile: this._profile || undefined
            }, 15000);
            const payload = r.data || {};
            if (payload.success === true && payload.data) {
                // 先本地落一下，再以服务端为准刷新：即使随后的 GET 失败，界面也不会回到旧值
                target.enabled = payload.data.enabled === true;
                const warnings = payload.data.warnings || [];
                const file = payload.data.file || '（profile 的开关记录）';
                const refreshed = await this.reload();
                // 后端恒定要求重启（overlay 只在进程启动时被读），文案直说
                this._notice('已写入 ' + file + '（profile ' + (this._profile || '当前') +
                    '），重启 `3rdloop serve` 生效');
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

    /**
     * 安装插件：把 npm spec 装进**当前 profile 目录**（与 CLI 同一实现）。
     * 后端负责校验清单/版本、安装、复查宿主可见性并在失败时回滚；这里只搬运结果。
     * @param {HTMLInputElement} input - spec 输入框
     */
    _install: async function (input) {
        const spec = ((input && input.value) || '').trim();
        if (!spec) {
            toast('warn', '请填写要安装的插件：npm 包名 / git 地址 / 本机目录（file:D:/my-plugin）');
            return;
        }
        if (this._busy) {
            toast('info', '上一次写入尚未完成，请稍候');
            return;
        }

        this._busy = true;
        try {
            const r = await apiFetch('POST', '/api/plugins/install', {
                spec: spec,
                profile: this._profile || undefined
            }, 120000);
            const payload = r.data || {};
            if (payload.success === true && payload.data) {
                const d = payload.data;
                const p = d.profile || this._profile || '当前';
                if (input) input.value = '';
                await this.reload();
                this._notice('已安装 ' + d.name + '（profile ' + p + '，重启 `3rdloop serve` 生效）');
                return;
            }
            this._showError(payload.message || ('安装失败（HTTP ' + r.status + '）'));
        } catch (e) {
            this._showError('安装失败：' + e.message);
        } finally {
            this._busy = false;
        }
    },

    /**
     * 从当前 profile 卸载插件：先确认（写清 profile 与落盘位置），再 POST；
     * 内置插件界面不给入口（后端同样拒绝）。
     * @param {string} name
     */
    _remove: async function (name) {
        const target = this._find(name);
        if (!target) return;
        const profile = this._profile || '当前';
        const dir = target.dir || '（profile 的 node_modules 下）';
        const ok = window.confirm(
            '从 profile ' + profile + ' 卸载 ' + name + '？\n\n' +
            '插件目录：' + dir + '\n' +
            'package.json：' + dir + '\\package.json\n\n' +
            '这会把它从该 profile 的依赖里移除（等价 npm uninstall），删除后不可恢复；' +
            '其他 profile 与内置插件不受影响。'
        );
        if (!ok) return;

        if (this._busy) {
            toast('info', '上一次写入尚未完成，请稍候');
            return;
        }

        this._busy = true;
        try {
            const r = await apiFetch('POST', '/api/plugins/remove', {
                name: name,
                profile: this._profile || undefined
            }, 120000);
            const payload = r.data || {};
            if (payload.success === true) {
                await this.reload();
                this._notice('已从 profile ' + profile + ' 卸载 ' + name + '，重启 `3rdloop serve` 生效');
                return;
            }
            this._showError(payload.message || ('卸载失败（HTTP ' + r.status + '）'));
        } catch (e) {
            this._showError('卸载失败：' + e.message);
        } finally {
            this._busy = false;
        }
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
