/* ════════════════════════════════════════════════════════════════════
 * 知识导入页面 — 主脚本
 * 自包含（不复用 loop.js，因其底部绑定了 loop.html 专属事件）
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 工具函数 ──────────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function escapeHtml(t) { if (t == null) return ''; var d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; }
function truncate(s, n) { if (!s) return ''; n = n || 80; return s.length > n ? s.substring(0, n) + '...' : s; }
function formatTime(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ts; } }

var API = {
    _fetch: function (url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }); },
    get: function (url) { return this._fetch(url); },
    post: function (url, body) { return this._fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
    del: function (url) { return this._fetch(url, { method: 'DELETE' }); }
};

function toast(type, msg) {
    var el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(function () { el.remove(); }, 300); }, 4000);
}

function importStatusLabel(s) {
    var m = { running: '运行中', completed: '已完成', failed: '失败', error: '错误', pending: '待执行' };
    return m[s] || s || '—';
}

/* ─── 全局状态 ──────────────────────────────────────────────────────── */
var KnState = {
    experiences: [],
    filtered: [],
    selectedId: null,
    selectedExp: null,
    importMode: 'sync',     // sync | async
    pollTimer: null,
    currentImportId: null
};

/* ─── 健康检查 ──────────────────────────────────────────────────────── */
async function checkHealth() {
    var dot = $('healthDot'), text = $('healthText');
    dot.className = 'health-dot unknown'; text.textContent = '检测中';
    try {
        var d = await API.get('/api/health');
        if (d.status === 'ok') { dot.className = 'health-dot ok'; text.textContent = '服务正常'; }
        else { dot.className = 'health-dot error'; text.textContent = '服务异常'; }
    } catch (err) { dot.className = 'health-dot error'; text.textContent = '后端不可达'; }
}

/* ─── 加载知识列表 ──────────────────────────────────────────────────── */
async function loadKnowledgeList() {
    var listEl = $('knList');
    listEl.innerHTML = '<div class="detail-empty">加载中...</div>';
    try {
        var d = await API.get('/api/knowledge/list');
        if (d && d.status === 'ok') {
            KnState.experiences = d.experiences || [];
            filterKnowledge();
        } else {
            KnState.experiences = [];
            listEl.innerHTML = '<div class="detail-empty">加载失败: ' + escapeHtml(d && d.message || '未知错误') + '</div>';
            $('knCount').textContent = '0';
        }
    } catch (err) {
        KnState.experiences = [];
        listEl.innerHTML = '<div class="detail-empty">后端不可达: ' + escapeHtml(err.message) + '</div>';
        $('knCount').textContent = '0';
    }
}

function filterKnowledge() {
    var q = $('knSearch').value.trim().toLowerCase();
    KnState.filtered = KnState.experiences.filter(function (e) {
        var id = (e.id || '').toLowerCase();
        var tid = (e.taskId || '').toLowerCase();
        var desc = (e.taskDescription || '').toLowerCase();
        return !q || id.indexOf(q) !== -1 || tid.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
    });
    renderKnowledgeList();
}

function renderKnowledgeList() {
    var listEl = $('knList');
    $('knCount').textContent = KnState.filtered.length;
    if (KnState.filtered.length === 0) {
        listEl.innerHTML = '<div class="detail-empty">暂无知识条目</div>';
        return;
    }
    listEl.innerHTML = KnState.filtered.map(function (e) {
        var active = e.id === KnState.selectedId;
        return '<div class="kn-card ' + (active ? 'active' : '') + '" onclick="selectKnowledge(\'' + escapeHtml(e.id) + '\')">' +
            '<div class="kn-card-id">' + escapeHtml(e.id) + '</div>' +
            '<div class="kn-card-desc">' + escapeHtml(truncate(e.taskDescription, 120)) + '</div>' +
            '<div class="kn-card-meta">' +
            (e.taskId ? '<span class="kn-card-task">' + escapeHtml(e.taskId) + '</span>' : '') +
            '<span class="kn-card-time">' + formatTime(e.createdAt) + '</span>' +
            '</div></div>';
    }).join('');
}

/* ─── 选中知识 → 渲染详情 ───────────────────────────────────────────── */
function selectKnowledge(id) {
    KnState.selectedId = id;
    var exp = KnState.experiences.find(function (e) { return e.id === id; });
    KnState.selectedExp = exp || null;
    renderKnowledgeList();
    renderDetail();
    showImportPanel();
}

function renderDetail() {
    var exp = KnState.selectedExp;
    if (!exp) {
        $('knDetailCard').style.display = 'none';
        $('knEmpty').style.display = 'flex';
        return;
    }
    $('knEmpty').style.display = 'none';
    $('knDetailCard').style.display = 'block';

    $('knTitle').textContent = truncate(exp.taskDescription, 60) || '(无描述)';
    $('knDetailId').textContent = exp.id;

    var meta = '';
    if (exp.taskId) meta += '<div class="meta-item"><span class="meta-label">来源任务</span><span class="meta-value">' + escapeHtml(exp.taskId) + '</span></div>';
    if (exp.stepId != null) meta += '<div class="meta-item"><span class="meta-label">来源步骤</span><span class="meta-value">' + escapeHtml(exp.stepId) + '</span></div>';
    if (exp.bigLoopIndex != null) meta += '<div class="meta-item"><span class="meta-label">大循环</span><span class="meta-value">' + escapeHtml(exp.bigLoopIndex) + '</span></div>';
    if (exp.retryCount != null) meta += '<div class="meta-item"><span class="meta-label">重试次数</span><span class="meta-value">' + escapeHtml(exp.retryCount) + '</span></div>';
    if (exp.skillDir) meta += '<div class="meta-item"><span class="meta-label">SKILL 目录</span><span class="meta-value">' + escapeHtml(exp.skillDir) + '</span></div>';
    if (exp.createdAt) meta += '<div class="meta-item"><span class="meta-label">创建时间</span><span class="meta-value">' + formatTime(exp.createdAt) + '</span></div>';
    if (exp.updatedAt) meta += '<div class="meta-item"><span class="meta-label">更新时间</span><span class="meta-value">' + formatTime(exp.updatedAt) + '</span></div>';
    if (exp.tags && exp.tags.length > 0) meta += '<div class="meta-item"><span class="meta-label">标签</span><span class="meta-value">' + escapeHtml(exp.tags.join(', ')) + '</span></div>';
    $('knDetailMeta').innerHTML = meta;

    $('knDetailDesc').textContent = exp.taskDescription || '(无任务描述)';

    $('knImportTarget').textContent = '目标: ' + exp.id;
}

function showImportPanel() {
    if (!KnState.selectedExp) return;
    $('knImportPanel').style.display = 'block';
    $('btnImportSubmit').disabled = false;
}

/* ─── 查看经验文档 ──────────────────────────────────────────────────── */
async function viewDoc() {
    var exp = KnState.selectedExp;
    if (!exp) { toast('warn', '请先选择一条知识'); return; }

    var title = '经验文档 - ' + exp.id;
    MarkdownReader.open(title, '加载中...');

    try {
        var d = await API.get('/api/knowledge/doc?id=' + encodeURIComponent(exp.id));
        if (d && d.status === 'ok') {
            MarkdownReader.open(title, d.content || '(文档内容为空)');
        } else {
            MarkdownReader.open(title, '加载失败: ' + (d && d.message || d && d.error || '未知错误'));
        }
    } catch (err) {
        MarkdownReader.open(title, '后端不可达: ' + err.message);
    }
}

/* ─── 执行知识导入 ──────────────────────────────────────────────────── */
async function submitImport() {
    var exp = KnState.selectedExp;
    if (!exp) { toast('warn', '请先选择一条知识'); return; }

    var userPrompt = $('knUserPrompt').value.trim();
    var workDir = $('knWorkDir').value.trim();
    var skillDir = $('knSkillDir').value.trim();

    var body = { knowledgeId: exp.id };
    if (userPrompt) body.userPrompt = userPrompt;
    if (workDir) body.workDir = workDir;
    if (skillDir) body.skillDir = skillDir;

    var btn = $('btnImportSubmit');
    btn.disabled = true;

    var endpoint = KnState.importMode === 'async' ? '/api/knowledge/import-async' : '/api/knowledge/import';
    var btnLabel = KnState.importMode === 'async' ? '🔄 异步导入中...' : '⏳ 同步导入中...';
    btn.textContent = btnLabel;

    try {
        var d = await API.post(endpoint, body);
        btn.disabled = false;
        btn.textContent = '📥 执行导入';

        if (d.status === 'ok') {
            if (KnState.importMode === 'async') {
                toast('success', '异步导入已启动: ' + d.importId);
                KnState.currentImportId = d.importId;
                startImportPolling(d.importId);
            } else {
                toast('success', '导入完成');
                showImportResult('导入结果', d);
                // 同步导入成功后刷新列表（原知识已自动删除）
                if (d.autoDeleted) {
                    loadKnowledgeList();
                }
            }
        } else {
            toast('error', d.error || d.message || '导入失败');
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = '📥 执行导入';
        toast('error', '请求失败: ' + err.message);
    }
}

/* ─── 异步导入状态轮询 ──────────────────────────────────────────────── */
function startImportPolling(importId) {
    stopImportPolling();
    $('knImportStatus').style.display = 'block';
    KnState.pollTimer = setInterval(function () { pollImportStatus(importId); }, 3000);
    pollImportStatus(importId);
}

function stopImportPolling() {
    if (KnState.pollTimer) { clearInterval(KnState.pollTimer); KnState.pollTimer = null; }
}

async function pollImportStatus(importId) {
    try {
        var d = await API.get('/api/knowledge/import-status?importId=' + encodeURIComponent(importId));
        if (d.status !== 'ok' || !d.import) {
            renderImportStatus(null);
            return;
        }
        renderImportStatus(d.import);

        var st = d.import.status;
        if (st === 'completed') {
            stopImportPolling();
            toast('success', '异步导入完成');
            // 导入成功后刷新列表（原知识已自动删除）
            if (d.import.result && d.import.result.success) {
                loadKnowledgeList();
            }
        } else if (st === 'failed' || st === 'error') {
            stopImportPolling();
            toast('error', '异步导入失败: ' + (d.import.error || d.import.result && d.import.result.message || ''));
        }
    } catch (err) {
        $('knStatusBody').innerHTML = '<div style="color:var(--red);font-size:12px;">轮询失败: ' + escapeHtml(err.message) + '</div>';
    }
}

function renderImportStatus(imp) {
    if (!imp) {
        $('knStatusBody').innerHTML = '<div class="muted">无状态数据</div>';
        return;
    }
    var st = imp.status || 'unknown';
    var badge = '<span class="kn-import-badge ' + st + '">' + importStatusLabel(st) + '</span>';

    var rows = '';
    rows += '<div class="kn-status-row"><span class="k">导入 ID</span><span class="v">' + escapeHtml(imp.importId) + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">状态</span><span class="v">' + badge + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">知识 ID</span><span class="v">' + escapeHtml(imp.knowledgeInfo && imp.knowledgeInfo.id || '—') + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">工作目录</span><span class="v">' + escapeHtml(imp.workDir || '—') + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">结果文件</span><span class="v">' + escapeHtml(imp.resultFilePath || '—') + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">Session ID</span><span class="v">' + escapeHtml(imp.sessionId || '—') + '</span></div>';
    rows += '<div class="kn-status-row"><span class="k">开始时间</span><span class="v">' + formatTime(imp.startTime) + '</span></div>';
    if (imp.endTime) rows += '<div class="kn-status-row"><span class="k">结束时间</span><span class="v">' + formatTime(imp.endTime) + '</span></div>';

    if (imp.result) {
        rows += '<div class="kn-status-row"><span class="k">成功</span><span class="v">' + (imp.result.success ? '✅ 是' : '❌ 否') + '</span></div>';
        if (imp.result.message) rows += '<div class="kn-status-row"><span class="k">消息</span><span class="v">' + escapeHtml(imp.result.message) + '</span></div>';
    }
    if (imp.error) {
        rows += '<div class="kn-status-row"><span class="k">错误</span><span class="v" style="color:var(--red);">' + escapeHtml(imp.error) + '</span></div>';
    }

    // 结果内容预览
    var resultPreview = '';
    if (imp.result && imp.result.resultContent) {
        var content = imp.result.resultContent;
        var preview = content.length > 2000 ? content.substring(0, 2000) + '\n...(已截断)' : content;
        resultPreview = '<div class="kn-log-box">' + escapeHtml(preview) + '</div>';
    }

    $('knStatusBody').innerHTML = rows + resultPreview;
}

/* ─── 删除知识 ──────────────────────────────────────────────────────── */
async function deleteKnowledge() {
    var exp = KnState.selectedExp;
    if (!exp) { toast('warn', '请先选择一条知识'); return; }

    if (!confirm('确定要删除知识「' + truncate(exp.taskDescription, 60) + '」吗？\n\nID: ' + exp.id + '\n\n删除后将从知识库中移除（软删除），不可恢复。')) {
        return;
    }

    var btn = $('btnDeleteKn');
    btn.disabled = true;
    btn.textContent = '🗑️ 删除中...';

    try {
        var d = await API.del('/api/knowledge/delete?id=' + encodeURIComponent(exp.id));
        btn.disabled = false;
        btn.textContent = '🗑️ 删除知识';

        if (d.status === 'ok') {
            toast('success', d.message || '知识已删除');
            // 清除选中状态，刷新列表
            KnState.selectedId = null;
            KnState.selectedExp = null;
            $('knDetailCard').style.display = 'none';
            $('knImportPanel').style.display = 'none';
            $('knEmpty').style.display = 'flex';
            loadKnowledgeList();
        } else {
            toast('error', d.error || d.message || '删除失败');
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = '🗑️ 删除知识';
        toast('error', '请求失败: ' + err.message);
    }
}

/* ─── 导入结果弹窗 ──────────────────────────────────────────────────── */
function showImportResult(title, data) {
    $('resultTitle').textContent = title;
    var content = '导入 ID: ' + (data.importId || '—') + '\n';
    content += '消息: ' + (data.message || '—') + '\n';
    content += '结果文件: ' + (data.resultFilePath || '—') + '\n\n';
    if (data.result) {
        content += '=== 执行结果 ===\n';
        content += '成功: ' + (data.result.success ? '是' : '否') + '\n';
        content += 'Session ID: ' + (data.result.sessionId || '—') + '\n';
        content += '消息: ' + (data.result.message || '—') + '\n\n';
        if (data.result.resultContent) {
            content += '=== 结果内容 ===\n' + data.result.resultContent;
        }
    }
    $('resultContent').textContent = content;
    $('resultOverlay').classList.add('show');
}

/* ─── 事件绑定 & 初始化 ──────────────────────────────────────────────── */
$('healthBtn').onclick = checkHealth;
$('knSearch').oninput = filterKnowledge;
$('btnKnRefresh').onclick = loadKnowledgeList;

$('btnStartImport').onclick = function () {
    showImportPanel();
    $('knImportPanel').scrollIntoView({ behavior: 'smooth' });
};

$('btnViewDoc').onclick = viewDoc;

$('btnDeleteKn').onclick = deleteKnowledge;

$('btnImportCancel').onclick = function () {
    $('knImportPanel').style.display = 'none';
};

$('btnImportSubmit').onclick = submitImport;

// 模式切换
document.querySelectorAll('.kn-mode-tab').forEach(function (tab) {
    tab.onclick = function () {
        document.querySelectorAll('.kn-mode-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        KnState.importMode = tab.dataset.mode;
        var hint = KnState.importMode === 'async'
            ? '异步启动导入，立即返回 importId，可轮询查询进度（适合长任务）'
            : '同步等待导入完成，适合较短任务';
        $('knModeHint').textContent = hint;
    };
});

// 高级选项折叠
$('knAdvancedToggle').onclick = function () {
    $('knAdvancedSection').classList.toggle('show');
    $('knAdvancedToggle').classList.toggle('open');
};

// 停止轮询
$('btnStopPoll').onclick = function () {
    stopImportPolling();
    toast('info', '已停止轮询');
};

// 弹窗关闭
$('resultClose').onclick = function () { $('resultOverlay').classList.remove('show'); };
$('resultOk').onclick = function () { $('resultOverlay').classList.remove('show'); };
$('resultOverlay').onclick = function (e) { if (e.target === $('resultOverlay')) $('resultOverlay').classList.remove('show'); };

// 暴露内联调用
window.selectKnowledge = selectKnowledge;

// 启动
checkHealth();
loadKnowledgeList();
