/* ════════════════════════════════════════════════════════════════════
 * AI Loop 大循环控制台 — 主脚本
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── API 封装 ──────────────────────────────────────────────────────── */
var API = {
    _fetch: function(url, opts) { return fetch(url, opts).then(function(r) { return r.json(); }); },
    get: function(url) { return this._fetch(url); },
    post: function(url, body) { return this._fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
};

/* ─── 全局状态 ──────────────────────────────────────────────────────── */
var State = {
    loops: [], filteredLoops: [], selectedTaskId: null,
    currentProgress: null, orchProgress: null, selectedStepId: null,
    activeDetailTab: 'detail', brainPlan: null,
    sseSource: null, pollTimer: null,
    activeMainTab: 'rounds',
    graphNodes: [], graphEdges: [], nodePositions: {},
    graphTransform: { scale: 1, tx: 0, ty: 0 },
    graphInteract: null,
    selectedLoop: null  // 当前查看的轮次（null=最新轮）
};

/* ─── 工具函数 ──────────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function escapeHtml(t) { if (t == null) return ''; var d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; }
function truncate(s, n) { if (!s) return ''; n = n || 50; return s.length > n ? s.substring(0, n) + '...' : s; }
function formatTime(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch(e) { return ts; } }
function copySessionId(sid) { if (!sid) return; try { navigator.clipboard.writeText(sid); } catch(e) {} }

function statusLabel(s) {
    var m = { idle:'空闲', planning:'拆解中', executing:'执行中', checking:'审核中', passed:'已通过', failed:'未通过', aborted:'已终止', error:'错误', loaded:'已加载', running:'运行中', completed:'已完成', pending:'待执行', ready:'就绪', skipped:'已跳过', blocked:'已阻塞', deadlocked:'死锁' };
    return m[s] || s || '—';
}

function toast(type, msg) {
    var el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(function() { el.remove(); }, 300); }, 4000);
}

/* ─── 健康检查 & 任务列表 ────────────────────────────────────────────── */
async function checkHealth() {
    var dot = $('healthDot'), text = $('healthText');
    dot.className = 'health-dot unknown'; text.textContent = '检测中';
    try {
        var d = await API.get('/api/health');
        if (d.status === 'ok') { dot.className = 'health-dot ok'; text.textContent = '服务正常'; }
        else { dot.className = 'health-dot error'; text.textContent = '服务异常'; }
    } catch(err) { dot.className = 'health-dot error'; text.textContent = '后端不可达'; }
}

async function loadLoopList() {
    try {
        var d = await API.get('/api/loopengine/list');
        if (d && d.status === 'ok') {
            State.loops = d.loops || [];
            filterLoops();
        } else {
            State.loops = [];
            $('loopList').innerHTML = '<div class="detail-empty">加载失败: ' + escapeHtml(d && d.message || '未知错误') + '</div>';
            $('loopCount').textContent = '0';
        }
    } catch(err) {
        State.loops = [];
        $('loopList').innerHTML = '<div class="detail-empty">后端不可达: ' + escapeHtml(err.message) + '</div>';
        $('loopCount').textContent = '0';
    }
}

function filterLoops() {
    var q = $('loopSearch').value.trim().toLowerCase();
    State.filteredLoops = State.loops.filter(function(l) {
        var id = (l.taskId||'').toLowerCase(), st = (l.status||'').toLowerCase();
        return !q || id.indexOf(q) !== -1 || st.indexOf(q) !== -1;
    });
    renderLoopList();
}

function renderLoopList() {
    var list = $('loopList'); $('loopCount').textContent = State.filteredLoops.length;
    if (State.filteredLoops.length === 0) { list.innerHTML = '<div class="detail-empty">暂无大循环任务</div>'; return; }
    list.innerHTML = State.filteredLoops.map(function(l) {
        var st = l.status || 'idle', act = l.taskId === State.selectedTaskId, t = l.startTime || l.endTime || '';
        var desc = l.taskDescription ? escapeHtml(l.taskDescription) : '';
        var badge = l.isSingleExecution ? '<span class="status-badge single-exec">⚡ 单次</span>' : '';
        var loopInfo = l.isSingleExecution ? '单次执行' : ((l.currentLoop||0) + '/' + (l.maxLoops||3) + ' 轮');
        return '<div class="task-item ' + (act?'active':'') + '" onclick="selectLoop(\'' + escapeHtml(l.taskId) + '\')">' +
            '<div class="task-id">' + escapeHtml(l.taskId) + '</div>' +
            (desc ? '<div class="task-desc">' + desc + '</div>' : '') +
            '<div class="task-meta"><span class="status-badge ' + st + '">' + statusLabel(st) + '</span>' + badge +
            '<span class="task-time">' + loopInfo + '</span>' +
            (t ? '<span class="task-time">' + formatTime(t) + '</span>' : '') + '</div></div>';
    }).join('');
}

/* ─── 任务选择 & 数据加载 ────────────────────────────────────────────── */
async function selectLoop(taskId) {
    State.selectedTaskId = taskId; State.selectedStepId = null; State.selectedLoop = null; State._convRenderedStep=null;
    stopPolling(); renderLoopList();
    await loadAllData(taskId); connectSSE(taskId);
}

async function loadAllData(taskId) {
    await Promise.all([ loadLoopProgress(taskId), loadOrchestratorProgress(taskId), loadBrainPlan(taskId) ]);
}

/**
 * 加载指定轮次的编排进度和 Brain 计划。
 * @param {string} taskId
 * @param {number} loop - 轮次序号（0-based）
 */
async function loadRoundData(taskId, loop) {
    State.selectedLoop = loop;
    State.selectedStepId = null;
    await Promise.all([ loadOrchestratorProgress(taskId, loop), loadBrainPlan(taskId, loop) ]);
}

async function loadLoopProgress(taskId, opts) {
    try {
        var d = await API.get('/api/loopengine/progress?taskId=' + encodeURIComponent(taskId));
        if (d.status === 'ok' && d.progress) {
            State.currentProgress = d.progress;
            // 静默模式：用户正在查看历史轮次时，只更新概览栏，不重建轮次 DOM（避免打断用户视图）
            var silent = opts && opts.silent;
            renderLoopOverview();
            if (!silent) renderRounds(); else refreshRoundCardBadges();
            var s = d.progress.status;
            if (s === 'planning' || s === 'executing' || s === 'checking') startPolling(taskId);
        }
    } catch(err) { toast('error', '加载进度失败: ' + err.message); }
}

/**
 * 静默刷新：只更新轮次卡片上的状态徽章和时间，不重建 DOM，不打断用户展开状态。
 */
function refreshRoundCardBadges() {
    var p = State.currentProgress; if (!p || !p.rounds) return;
    p.rounds.forEach(function(r) {
        var card = document.querySelector('.round-card[data-loop="' + r.loop + '"]');
        if (!card) return;
        // 更新状态徽章
        var badge = card.querySelector('.status-badge');
        if (badge) {
            if (r.passed) { badge.className = 'status-badge passed'; badge.textContent = '✅ 通过'; }
            else if (r.error) { badge.className = 'status-badge error'; badge.textContent = '❌ 异常'; }
        }
        // 更新时间
        var timeEl = card.querySelector('.round-time');
        if (timeEl && r.endTime) {
            var t = (r.startTime?formatTime(r.startTime):'—') + ' → ' + formatTime(r.endTime);
            timeEl.textContent = t;
        }
    });
}

/* ─── 循环概览渲染 ──────────────────────────────────────────────────── */
function renderLoopOverview() {
    var p = State.currentProgress; if (!p) return;
    $('loopOverview').style.display = 'block';
    $('ovTaskId').textContent = p.taskId;
    $('ovStatus').className = 'status-badge ' + (p.status||'idle');
    $('ovStatus').textContent = statusLabel(p.status);
    var rounds = p.rounds || [];
    var passed = rounds.filter(function(r){return r.passed;}).length;
    var isSingle = p.isSingleExecution;
    var stats = [
        isSingle
            ? '<span class="stat-item">⚡ <strong>单次执行</strong></span>'
            : '<span class="stat-item">轮次: <strong>' + (p.currentLoop||0) + '/' + (p.maxLoops||3) + '</strong></span>',
        '<span class="stat-item">已完成: <strong>' + rounds.length + '</strong></span>',
        '<span class="stat-item">通过: <strong>' + passed + '</strong></span>',
        '<span class="stat-item">开始: <strong>' + formatTime(p.startTime) + '</strong></span>'
    ];
    if (p.endTime) stats.push('<span class="stat-item">结束: <strong>' + formatTime(p.endTime) + '</strong></span>');
    if (p.error) stats.push('<span class="stat-item" style="color:var(--red);">错误: <strong>' + escapeHtml(p.error) + '</strong></span>');
    $('ovStats').innerHTML = stats.join('');
    var act = p.status==='planning'||p.status==='executing'||p.status==='checking';
    $('btnLoopAbort').disabled = !act;
}

/* ─── 轮次时间线渲染 ────────────────────────────────────────────────── */
function renderRounds() {
    var p = State.currentProgress;
    if (!p || !p.rounds || p.rounds.length === 0) {
        if (p && (p.status==='planning'||p.status==='executing'||p.status==='checking')) {
            $('roundsSection').innerHTML = '<h3>🔄 循环轮次时间线</h3>' +
                '<div class="round-card running"><div class="round-header"><div class="round-num">1</div>' +
                '<div class="round-title">第 1 轮 (' + statusLabel(p.status) + '...)</div>' +
                '<span class="status-badge ' + p.status + '">' + statusLabel(p.status) + '</span>' +
                '<span class="round-time">进行中</span></div></div>';
        } else { $('roundsSection').innerHTML = '<div class="rounds-empty">暂无轮次记录</div>'; }
        return;
    }
    var rounds = p.rounds.slice();
    var act = p.status==='planning'||p.status==='executing'||p.status==='checking';
    if (act && (rounds.length===0 || rounds[rounds.length-1].endTime)) {
        rounds.push({ loop: p.currentLoop||0, passed:false, startTime:null, endTime:null, error:null, _inProgress:true, _currentPhase:p.status });
    }
    $('roundsSection').innerHTML = '<h3>🔄 循环轮次时间线 (' + rounds.length + ' 轮)</h3>' +
        rounds.map(function(r){ return renderRoundCard(r); }).join('');
    document.querySelectorAll('.round-header').forEach(function(el){
        el.onclick = function(){
            var card = el.parentElement;
            var wasExpanded = card.classList.contains('expanded');
            // 先折叠所有卡片
            document.querySelectorAll('.round-card').forEach(function(c){ c.classList.remove('expanded'); });
            if (!wasExpanded) {
                card.classList.add('expanded');
                // 加载该轮编排数据和 Brain 计划
                var loopVal = card.getAttribute('data-loop');
                if (loopVal != null && State.selectedTaskId) {
                    loadRoundData(State.selectedTaskId, Number(loopVal));
                }
            }
        };
    });
    // 展开逻辑：用户已选择查看某个历史轮次 → 展开对应卡片；否则展开最新轮次
    var cards = document.querySelectorAll('.round-card');
    if (cards.length > 0) {
        var targetLoop = State.selectedLoop;
        var targetCard = null;
        if (targetLoop != null) {
            targetCard = document.querySelector('.round-card[data-loop="' + targetLoop + '"]');
        }
        if (!targetCard) targetCard = cards[cards.length - 1];
        targetCard.classList.add('expanded');
    }
}

function renderRoundCard(r) {
    var isRun = r._inProgress || (!r.endTime && !r.passed && r.error===null);
    var cls = r.passed ? 'passed' : (r.error ? 'failed' : (isRun ? 'running' : 'failed'));
    var numCls = r.passed ? 'passed' : 'failed';
    var ph = r._inProgress ? ' (' + statusLabel(r._currentPhase) + '...)' : '';
    var t = (r.startTime?formatTime(r.startTime):'—') + (r.endTime?' → '+formatTime(r.endTime):' → 进行中');
    var h = '<div class="round-card ' + cls + '" data-loop="' + r.loop + '"><div class="round-header">';
    h += '<div class="round-num ' + numCls + '">' + (r.loop+1) + '</div>';
    h += '<div class="round-title">第 ' + (r.loop+1) + ' 轮' + ph + '</div>';
    if (r.passed) h += '<span class="status-badge passed">✅ 通过</span>';
    else if (r.error) h += '<span class="status-badge error">❌ 异常</span>';
    else if (isRun) h += '<span class="status-badge ' + (r._currentPhase||'executing') + '">' + statusLabel(r._currentPhase||'executing') + '</span>';
    else h += '<span class="status-badge failed">❌ 未通过</span>';
    h += '<span class="round-time">' + t + '</span><span class="round-expand-icon">▶</span></div>';
    h += '<div class="round-body">';
    h += renderBrainPhase(r); h += renderOrchestratorPhase(r); h += renderCheckPhase(r);
    if (r.error) h += '<div class="phase-block"><div class="phase-header"><span class="phase-icon">⚠️</span> 异常</div><div class="phase-content" style="color:var(--red);">' + escapeHtml(r.error) + '</div></div>';
    h += '</div></div>';
    return h;
}

function renderBrainPhase(r) {
    var h = '<div class="phase-block"><div class="phase-header"><span class="phase-icon">🧠</span> Brain ' + (r.planningIsReplan ? '重规划' : '初始拆解') + '</div><div class="phase-content">';
    if (!r.planningPlanId && !r._inProgress) h += '<span class="muted">无拆解数据</span>';
    else if (r._inProgress && !r.planningPlanId) h += '<span class="muted">拆解中...</span>';
    else {
        h += '<div class="kv"><span class="k">Plan ID</span><span class="v">' + escapeHtml(r.planningPlanId||'—') + '</span>';
        h += '<span class="k">类型</span><span class="v">' + (r.planningIsReplan ? '🔄 重规划 (第'+r.loop+'轮)' : '✨ 初始拆解') + '</span>';
        if (r.planningStepCount!=null) h += '<span class="k">步骤数</span><span class="v">' + r.planningStepCount + '</span>';
        if (r.planningIntent) h += '<span class="k">任务意图</span><span class="v">' + escapeHtml(r.planningIntent) + '</span>';
        if (r.planningDomain) h += '<span class="k">领域</span><span class="v">' + escapeHtml(r.planningDomain) + '</span>';
        if (r.planningComplexity) h += '<span class="k">复杂度</span><span class="v">' + escapeHtml(r.planningComplexity) + '</span>';
        h += '</div>';
        if (r.planningFailureAnalysis) h += '<div style="margin-top:8px;padding:6px 8px;background:var(--red-light);border-radius:5px;font-size:11px;"><strong>失败分析:</strong> ' + escapeHtml(r.planningFailureAnalysis) + '</div>';
        if (r.planningAdjustmentStrategy) h += '<div style="margin-top:4px;padding:6px 8px;background:var(--orange-light);border-radius:5px;font-size:11px;"><strong>调整策略:</strong> ' + escapeHtml(r.planningAdjustmentStrategy) + '</div>';
        h += '<div style="margin-top:8px;"><button class="secondary sm" onclick="switchToBrainTab(' + r.loop + ')">🧠 查看 Brain 拆解详情</button></div>';
    }
    h += '</div></div>'; return h;
}

function renderOrchestratorPhase(r) {
    var st = r.orchestratorStatus;
    var h = '<div class="phase-block"><div class="phase-header"><span class="phase-icon">🔀</span> Orchestrator 编排执行</div><div class="phase-content">';
    if (!st && r._inProgress && r._currentPhase==='planning') h += '<span class="muted">等待 Brain 拆解完成...</span>';
    else if (!st && r._inProgress) h += '<span class="muted">执行中...</span>';
    else if (!st) h += '<span class="muted">无编排数据</span>';
    else {
        h += '<div class="kv"><span class="k">编排状态</span><span class="v"><span class="status-badge ' + st + '">' + statusLabel(st) + '</span></span></div>';
        h += '<div style="margin-top:8px;"><button class="secondary sm" onclick="switchToOrchTab(' + r.loop + ')">🔀 查看步骤编排图</button></div>';
    }
    h += '</div></div>'; return h;
}

function renderCheckPhase(r) {
    var h = '<div class="phase-block"><div class="phase-header"><span class="phase-icon">🔍</span> TestCheck 准出审核</div><div class="phase-content">';
    if (!r.checkId && r._inProgress && r._currentPhase!=='checking') h += '<span class="muted">等待编排完成...</span>';
    else if (!r.checkId && r._inProgress) h += '<span class="muted">审核中...</span>';
    else if (!r.checkId) h += '<span class="muted">未执行审核</span>';
    else {
        if (r.checkPassed===true) h += '<div style="margin-bottom:6px;"><span class="status-badge passed">✅ 准出通过</span></div>';
        else if (r.checkPassed===false) h += '<div style="margin-bottom:6px;"><span class="status-badge failed">❌ 准出未通过</span></div>';
        else h += '<div style="margin-bottom:6px;"><span class="status-badge ' + (r.checkStatus||'idle') + '">' + statusLabel(r.checkStatus) + '</span></div>';
        h += '<div class="kv"><span class="k">Check ID</span><span class="v">' + escapeHtml(r.checkId||'—') + '</span>';
        h += '<span class="k">审核 Session</span><span class="v">' + escapeHtml(r.checkSessionId||'—') + '</span></div>';
        if (r.checkSummary) h += '<div style="margin-bottom:8px;padding:6px 8px;background:var(--card);border-radius:5px;font-size:11px;line-height:1.6;"><strong>审核摘要:</strong> ' + escapeHtml(r.checkSummary) + '</div>';
        h += '<button class="secondary sm" onclick="loadCheckDetail(\'' + escapeHtml(State.selectedTaskId) + '\', ' + r.loop + ')">📄 查看审核详情</button>';
        h += ' <button class="secondary sm" onclick="loadCheckSession(\'' + escapeHtml(State.selectedTaskId) + '\', ' + r.loop + ')">💬 查看审核对话</button>';
    }
    h += '</div></div>'; return h;
}

/* ─── 编排图 ────────────────────────────────────────────────────────── */
async function loadOrchestratorProgress(taskId, loop) {
    try {
        var url = '/api/orchestrator/progress?taskId=' + encodeURIComponent(taskId);
        if (loop != null) url += '&loop=' + encodeURIComponent(loop);
        var d = await API.get(url);
        if (d.status==='ok' && d.progress) { State.orchProgress = d.progress; renderGraph(); renderDetailPanel(); }
        else { State.orchProgress = null; renderGraph(); renderDetailPanel(); }
    } catch(err) { State.orchProgress = null; renderGraph(); renderDetailPanel(); }
}

function getDepIds(dep) {
    if (Array.isArray(dep)) return dep.map(String).filter(function(x){ return x!=='0' && x!==''; });
    if (dep==null || dep==='0' || dep==='') return [];
    return [String(dep)];
}

function buildGraphData() {
    var p = State.orchProgress;
    if (!p || !p.steps || p.steps.length===0) { State.graphNodes=[]; State.graphEdges=[]; return; }
    State.graphNodes = p.steps.map(function(s) {
        return { id: String(s.stepId), stepId: s.stepId, status: s.status||'pending', retryCount: s.retryCount||0, maxRetries: s.maxRetries||3,
            taskDescription: s.taskDescription||'', dependId: s.dependId, nextStepId: String(s.nextStepId||'0'), failStepId: String(s.failStepId||'0'),
            sessionId: s.sessionId||'', resultPath: s.resultPath||'', error: s.error||'', startTime: s.startTime, endTime: s.endTime, history: s.history||[],
            canRetry: s.canRetry!==false, skillDirectory: s.skillDirectory||'', taskDir: s.taskDir||'', inputReport: s.inputReport||'' };
    });
    State.graphEdges = [];
    var ids = {}; State.graphNodes.forEach(function(n){ ids[n.id]=true; });
    State.graphNodes.forEach(function(n) {
        // dependId 支持单值或数组（fan-in 聚合），逐项生成依赖边
        getDepIds(n.dependId).forEach(function(dep) {
            if (ids[dep]) State.graphEdges.push({ from:dep, to:n.id, type:'depend', label:'依赖' });
        });
        if (n.nextStepId && n.nextStepId!=='0' && ids[n.nextStepId]) State.graphEdges.push({ from:n.id, to:n.nextStepId, type:'success', label:'成功' });
        if (n.failStepId && n.failStepId!=='0' && ids[n.failStepId]) State.graphEdges.push({ from:n.id, to:n.failStepId, type:'fail', label:'失败' });
    });
}

function layoutGraph() {
    var nodes = State.graphNodes; if (nodes.length===0) { State.nodePositions={}; return; }
    var map = {}; nodes.forEach(function(n){ map[n.id]=n; });
    var levels = {};
    function getLvl(id, vis) { if (!vis) vis={}; if (vis[id]) return 0; if (levels[id]!==undefined) return levels[id]; var n=map[id]; if(!n) return 0; vis[id]=true; var deps=getDepIds(n.dependId).filter(function(d){return map[d];}); if(deps.length===0){levels[id]=0;return 0;} var l=0; deps.forEach(function(d){ var dl=getLvl(d,vis)+1; if(dl>l)l=dl; }); levels[id]=l; return l; }
    nodes.forEach(function(n){ getLvl(n.id,{}); });
    var chg=true, iter=0;
    while (chg && iter<10) { chg=false; iter++; nodes.forEach(function(n){ if(n.nextStepId&&n.nextStepId!=='0'&&map[n.nextStepId]){ var exp=(levels[n.id]||0)+1; if((levels[n.nextStepId]||0)<exp){levels[n.nextStepId]=exp;chg=true;} } }); }
    var maxL=0; for (var k in levels) { if(levels[k]>maxL) maxL=levels[k]; }
    var groups={}; for (var i=0;i<=maxL;i++) groups[i]=[];
    nodes.forEach(function(n){ var l=levels[n.id]||0; if(!groups[l]) groups[l]=[]; groups[l].push(n); });
    var NW=180,NH=80,GX=60,GY=80,PD=40; State.nodePositions={};
    for (var lvl=0; lvl<=maxL; lvl++) { (groups[lvl]||[]).forEach(function(n,idx){ State.nodePositions[n.id]={ x:PD+idx*(NW+GX), y:PD+lvl*(NH+GY), w:NW, h:NH, cx:PD+idx*(NW+GX)+NW/2, cy:PD+lvl*(NH+GY)+NH/2 }; }); }
}

function renderGraph() {
    buildGraphData(); layoutGraph();
    var svg=$('graphSvg'), empty=$('graphEmpty');
    if (State.graphNodes.length===0) { svg.style.display='none'; empty.style.display='flex'; $('graphHint').textContent=''; return; }
    svg.style.display='block'; empty.style.display='none';
    var maxX=0,maxY=0; for (var id in State.nodePositions) { var p=State.nodePositions[id]; if(p.x+p.w>maxX)maxX=p.x+p.w; if(p.y+p.h>maxY)maxY=p.y+p.h; }
    var w=maxX+60, h=maxY+60;
    svg.setAttribute('viewBox','0 0 '+w+' '+h);
    svg.setAttribute('preserveAspectRatio','xMinYMin meet');
    var c='';
    State.graphEdges.forEach(function(e) {
        var f=State.nodePositions[e.from], t=State.nodePositions[e.to]; if(!f||!t) return;
        var x1=f.cx, y1=f.y+f.h, x2=t.cx, y2=t.y, dy=y2-y1, my=y1+dy/2;
        var path='M '+x1+' '+y1+' C '+x1+' '+my+', '+x2+' '+my+', '+x2+' '+y2;
        var cls=e.type==='success'?'success':e.type==='fail'?'fail':'depend';
        var mk=e.type==='success'?'url(#arrow-success)':e.type==='fail'?'url(#arrow-fail)':'url(#arrow-depend)';
        c += '<path class="edge-line '+cls+'" d="'+path+'" marker-end="'+mk+'" />';
        c += '<text class="edge-label" x="'+((x1+x2)/2)+'" y="'+(my-3)+'" text-anchor="middle">'+escapeHtml(e.label)+'</text>';
    });
    State.graphNodes.forEach(function(n) {
        var p=State.nodePositions[n.id]; if(!p) return;
        var sel=String(State.selectedStepId)===n.id, st=n.status||'pending';
        var rt=n.retryCount>0?'🔄 '+n.retryCount+'/'+n.maxRetries:'';
        c += '<g class="node-group '+(sel?'selected':'')+'" data-step-id="'+escapeHtml(n.id)+'" onclick="selectStep(\''+escapeHtml(n.id)+'\')">';
        c += '<rect class="node-rect '+st+'" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'" rx="8" />';
        if (st==='running') c += '<rect class="running-ring" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'" rx="8" fill="none" stroke="#ff9500" stroke-width="2.5" stroke-dasharray="8,4" />';
        c += '<rect class="node-drag-handle" x="'+(p.x+p.w-18)+'" y="'+(p.y+6)+'" width="12" height="6" />';
        c += '<text class="node-text node-id" x="'+(p.x+10)+'" y="'+(p.y+22)+'">步骤 '+escapeHtml(n.stepId)+'</text>';
        c += '<text class="node-text node-status" x="'+(p.x+10)+'" y="'+(p.y+38)+'">'+statusLabel(n.status)+'</text>';
        if (rt) c += '<text class="node-text node-retry" x="'+(p.x+10)+'" y="'+(p.y+52)+'">'+rt+'</text>';
        c += '<text class="node-text node-retry" x="'+(p.x+10)+'" y="'+(p.y+68)+'">'+escapeHtml(truncate(n.taskDescription,18))+'</text>';
        c += '</g>';
    });
    var vp=$('graphViewport');
    if (vp) vp.innerHTML=c; else { svg.innerHTML='<g class="graph-viewport" id="graphViewport">'+c+'</g>'; }
    applyGraphTransform();
    $('graphHint').textContent = State.graphNodes.length+' 个步骤, '+State.graphEdges.length+' 条关系' +
        (State.selectedLoop != null ? ' (第 ' + (State.selectedLoop + 1) + ' 轮)' : '');
}

/* ─── 图表交互：缩放 / 平移 / 节点拖拽 ────────────────────────────────── */
function applyGraphTransform() {
    var vp=$('graphViewport'); if(!vp) return;
    var t=State.graphTransform;
    vp.setAttribute('transform','translate('+t.tx+','+t.ty+') scale('+t.scale+')');
    var zd=$('zoomDisplay'); if(zd) zd.textContent=Math.round(t.scale*100)+'%';
}

function graphZoomBy(factor, cx, cy) {
    var t=State.graphTransform, svg=$('graphSvg'); if(!svg) return;
    var rect=svg.getBoundingClientRect();
    if(cx==null) cx=rect.width/2;
    if(cy==null) cy=rect.height/2;
    var vb=svg.viewBox.baseVal, sx=vb.width/rect.width, sy=vb.height/rect.height;
    var s=Math.max(sx,sy);
    var oldScale=t.scale;
    var newScale=Math.max(0.2, Math.min(3, oldScale*factor));
    if(newScale===oldScale) return;
    var wx=cx*s, wy=cy*s;
    t.tx=wx-(wx-t.tx)*(newScale/oldScale);
    t.ty=wy-(wy-t.ty)*(newScale/oldScale);
    t.scale=newScale;
    applyGraphTransform();
}

function graphResetTransform() {
    State.graphTransform={scale:1,tx:0,ty:0};
    applyGraphTransform();
}

function graphFitToView() {
    var svg=$('graphSvg'); if(!svg||State.graphNodes.length===0) return;
    var rect=svg.getBoundingClientRect(); if(rect.width===0) return;
    var maxX=0,maxY=0;
    for(var id in State.nodePositions){var p=State.nodePositions[id];if(p.x+p.w>maxX)maxX=p.x+p.w;if(p.y+p.h>maxY)maxY=p.y+p.h;}
    var vbW=parseFloat(svg.getAttribute('viewBox').split(' ')[2])||maxX+60;
    var vbH=parseFloat(svg.getAttribute('viewBox').split(' ')[3])||maxY+60;
    var pad=30, fitScale=Math.min((rect.width-2*pad)/vbW, (rect.height-2*pad)/vbH, 1);
    fitScale=Math.max(0.2,fitScale);
    State.graphTransform={scale:fitScale,tx:pad,ty:pad};
    applyGraphTransform();
}

function initGraphInteraction() {
    var canvas=$('graphCanvas'), svg=$('graphSvg');
    if(!canvas||!svg) return;
    var st=null;

    function getSvgPoint(e) {
        var rect=svg.getBoundingClientRect();
        var vb=svg.viewBox.baseVal, s=Math.max(vb.width/rect.width, vb.height/rect.height);
        return { x:(e.clientX-rect.left)*s, y:(e.clientY-rect.top)*s };
    }

    canvas.addEventListener('wheel',function(e){
        e.preventDefault();
        if(State.graphNodes.length===0) return;
        var pt=getSvgPoint(e);
        var factor=e.deltaY<0?1.1:0.9;
        graphZoomBy(factor, pt.x, pt.y);
    },{passive:false});

    canvas.addEventListener('mousedown',function(e){
        if(State.graphNodes.length===0) return;
        var pt=getSvgPoint(e);
        var target=e.target;
        var nodeG=null;
        while(target&&target!==canvas){ if(target.classList&&target.classList.contains('node-group')){nodeG=target;break;} target=target.parentNode; }
        var isDragHandle=e.target.classList&&e.target.classList.contains('node-drag-handle');
        if(nodeG&&(isDragHandle||e.shiftKey)) {
            var sid=nodeG.getAttribute('data-step-id');
            var pos=State.nodePositions[sid]; if(!pos) return;
            st={mode:'node',stepId:sid,startX:pt.x,startY:pt.y,origX:pos.x,origY:pos.y};
            canvas.classList.add('node-drag'); nodeG.classList.add('dragging');
        } else {
            st={mode:'pan',startX:pt.x,startY:pt.y,origTx:State.graphTransform.tx,origTy:State.graphTransform.ty};
            canvas.classList.add('panning');
        }
    });

    document.addEventListener('mousemove',function(e){
        if(!st) return;
        var pt=getSvgPoint(e);
        if(st.mode==='pan') {
            State.graphTransform.tx=st.origTx+(pt.x-st.startX);
            State.graphTransform.ty=st.origTy+(pt.y-st.startY);
            applyGraphTransform();
        } else if(st.mode==='node') {
            var pos=State.nodePositions[st.stepId]; if(!pos) return;
            var dx=pt.x-st.startX, dy=pt.y-st.startY;
            pos.x=st.origX+dx; pos.y=st.origY+dy;
            pos.cx=pos.x+pos.w/2; pos.cy=pos.y+pos.h/2;
            renderGraph();
            var vp=$('graphViewport'); if(vp) vp.setAttribute('transform','translate('+State.graphTransform.tx+','+State.graphTransform.ty+') scale('+State.graphTransform.scale+')');
        }
    });

    document.addEventListener('mouseup',function(){
        if(!st) return;
        if(st.mode==='node') {
            var ng=canvas.querySelector('.node-group.dragging');
            if(ng) ng.classList.remove('dragging');
        }
        canvas.classList.remove('panning','node-drag');
        st=null;
    });

    canvas.addEventListener('contextmenu',function(e){
        if(State.graphNodes.length>0) e.preventDefault();
    });
}

/* ─── 步骤选择 & 详情面板 ────────────────────────────────────────────── */
function selectStep(stepId) { State.selectedStepId=stepId; State._convRenderedStep=null; renderGraph(); renderDetailPanel(); }

function getStep() { if(!State.orchProgress||!State.selectedStepId) return null; return State.orchProgress.steps.find(function(s){return String(s.stepId)===String(State.selectedStepId);}); }

function renderDetailPanel() {
    var s=getStep();
    if (!s) { $('detailContent').innerHTML='<div class="detail-empty">请选择一个步骤节点</div>'; return; }
    // 对话 tab 内容由用户手动获取消息，SSE 触发的重渲染不应冲掉已有内容
    // 仅在步骤切换或 tab 切换时重建对话面板
    if (State.activeDetailTab==='conversation') {
        if (State._convRenderedStep === String(s.stepId) && $('msgList')) return;
        State._convRenderedStep = String(s.stepId);
        renderConversationTab(s);
        return;
    }
    if (State.activeDetailTab==='detail') renderDetailTab(s);
    else if (State.activeDetailTab==='control') renderControlTab(s);
    else if (State.activeDetailTab==='files') renderFilesTab(s);
}

function renderDetailTab(step) {
    var st=step.status||'pending', cr=step.canRetry!==false, hist=step.history||[];
    var h='<div class="detail-section"><h4>基本信息</h4><div class="kv-list">'+
        '<div class="k">步骤 ID</div><div class="v">'+escapeHtml(step.stepId)+'</div>'+
        '<div class="k">状态</div><div class="v"><span class="status-badge '+st+'">'+statusLabel(st)+'</span></div>'+
        '<div class="k">可重试</div><div class="v">'+(cr?'✅ 是':'❌ 否')+'</div>'+
        '<div class="k">重试次数</div><div class="v">'+(step.retryCount||0)+' / '+(step.maxRetries||3)+'</div>'+
        '<div class="k">开始时间</div><div class="v">'+formatTime(step.startTime)+'</div>'+
        '<div class="k">结束时间</div><div class="v">'+formatTime(step.endTime)+'</div>'+
        '<div class="k">Session</div><div class="v"><span id="detailSessionVal">'+escapeHtml(step.sessionId||'(无)')+'</span>'+(hist.length>1?'<div class="muted" style="font-size:11px;margin-top:2px;">最新一次（共 '+hist.length+' 次重试，见下方历史详情）</div>':'')+'</div>'+
        '<div class="k">结果路径</div><div class="v">'+escapeHtml(step.resultPath||'(无)')+'</div>'+
        '</div></div>'+
        '<div class="detail-section"><h4>任务描述</h4><div style="font-size:12px;line-height:1.6;background:var(--code-bg);padding:10px;border-radius:6px;">'+escapeHtml(step.taskDescription||'—')+'</div></div>'+
        '<div class="detail-section"><h4>步骤关系</h4><div class="kv-list">'+
        '<div class="k">依赖步骤</div><div class="v">'+(getDepIds(step.dependId).length>0?'步骤 '+escapeHtml(getDepIds(step.dependId).join(', ')):'无 (入口)')+'</div>'+
        '<div class="k">依赖数</div><div class="v">'+getDepIds(step.dependId).length+' 个前置</div>'+
        '<div class="k">成功→下一步</div><div class="v">'+(step.nextStepId&&step.nextStepId!=='0'?'步骤 '+escapeHtml(step.nextStepId):'无 (结束)')+'</div>'+
        '<div class="k">失败→回退</div><div class="v">'+(step.failStepId&&step.failStepId!=='0'?'步骤 '+escapeHtml(step.failStepId):'无 (终止)')+'</div>'+
        '</div></div>';
    if (step.error) h += '<div class="detail-section"><h4 style="color:var(--red);">错误信息</h4><div style="font-size:12px;color:var(--red);background:var(--red-light);padding:10px;border-radius:6px;">'+escapeHtml(step.error)+'</div></div>';
    if (hist.length>0) {
        h+='<div class="detail-section"><h4>执行历史 ('+hist.length+')</h4><div class="history-list">';
        hist.forEach(function(hi){
            var sid=hi.sessionId||'';
            h+='<div class="history-item">'+
                '<span class="history-attempt">第 '+hi.attempt+' 次</span>'+
                '<span style="color:'+(hi.success?'var(--green)':'var(--red)')+';">'+(hi.success?'✅ 成功':'❌ 失败')+'</span>'+
                '<span class="muted">'+formatTime(hi.startTime)+' → '+formatTime(hi.endTime)+'</span>'+
                (sid?'<div class="history-session">Session: <a href="#" onclick="copySessionId(\''+escapeHtml(sid)+'\');return false;" title="点击复制">'+escapeHtml(sid)+'</a></div>':'')+
                (hi.resultPath?'<div class="history-result muted">'+escapeHtml(hi.resultPath)+'</div>':'')+
                '</div>';
        });
        h+='</div></div>';
    }
    $('detailContent').innerHTML=h;

    // 运行中的步骤若 sessionId 为空，从活跃 runner 实时补充（后端通过 SSE 推送可能存在时序差）
    if (st==='running' && !step.sessionId && step.stepId!=null) {
        fetchSessionIdForStep(step.stepId);
    }
}

/**
 * 从 /api/flexrunner/status 获取运行中步骤的实时 sessionId 并回填详情面板。
 * @param {string|number} sid - 步骤 ID
 */
async function fetchSessionIdForStep(sid) {
    try {
        var tid=State.selectedTaskId;
        if(!tid) return;
        var d=await API.get('/api/flexrunner/status?taskId='+encodeURIComponent(tid)+'&stepId='+encodeURIComponent(sid));
        if(d.status==='ok' && d.runner && d.runner.sessionId
            && String(State.selectedStepId)===String(sid)) {
            var el=document.getElementById('detailSessionVal');
            if(el) el.textContent=d.runner.sessionId;
        }
    } catch(err){ /* 静默失败，不影响主流程 */ }
}

/* ─── 对话 Tab ──────────────────────────────────────────────────────── */
async function renderConversationTab(step) {
    var tid=State.selectedTaskId, sid=step.stepId, loop=State.selectedLoop;
    $('detailContent').innerHTML='<div class="detail-section"><h4>会话交互</h4>'+
        '<div class="form-group"><textarea id="convInput" placeholder="输入要发送的消息..." style="min-height:60px;"></textarea></div>'+
        '<div class="detail-actions"><button class="secondary sm" id="btnInject">📥 注入提示词</button><button class="primary sm" id="btnSendWait">📨 发送并等待</button></div></div>'+
        '<div class="detail-section"><h4>消息列表</h4>'+
        '<div class="detail-actions" style="margin-bottom:8px;"><button class="secondary sm" id="btnGetLive">获取实时消息</button><button class="secondary sm" id="btnGetSession">获取会话归档</button></div>'+
        '<div class="msg-list" id="msgList"><div class="muted" style="font-size:12px;">点击按钮获取消息...</div></div></div>';
    $('btnInject').onclick=function(){injectPromptMsg(tid,sid,loop);};
    $('btnSendWait').onclick=function(){sendAndWaitMsg(tid,sid,loop);};
    $('btnGetLive').onclick=function(){getLiveMsgs(tid,sid,loop);};
    $('btnGetSession').onclick=function(){getSessionArchive(tid,sid,loop);};
}

async function getLiveMsgs(tid,sid,loop) {
    try {
        var url='/api/flexrunner/live-messages?taskId='+encodeURIComponent(tid)+'&stepId='+encodeURIComponent(sid);
        if(loop!=null) url+='&loop='+encodeURIComponent(loop);
        var d=await API.get(url); if(d.status==='ok') renderMessages(d.messages||[]);
    }
    catch(err){ toast('error','获取消息失败: '+err.message); }
}

async function getSessionArchive(tid,sid,loop) {
    try {
        var url='/api/flexrunner/session?taskId='+encodeURIComponent(tid)+'&stepId='+encodeURIComponent(sid);
        if(loop!=null) url+='&loop='+encodeURIComponent(loop);
        var d=await API.get(url); if(d.status==='ok'){ renderMessages(d.messages||[]); toast('info','会话归档: '+(d.messages||[]).length+' 条消息'); }
    }
    catch(err){ toast('error','获取归档失败: '+err.message); }
}

async function injectPromptMsg(tid,sid,loop) {
    var m=$('convInput').value.trim(); if(!m){toast('warn','请先输入消息');return;}
    try {
        var body={taskId:tid,stepId:sid,message:m};
        if(loop!=null) body.loop=loop;
        var d=await API.post('/api/flexrunner/inject-prompt',body); if(d.status==='ok'){toast('success','提示词已注入');$('convInput').value='';getLiveMsgs(tid,sid,loop);} else toast('warn',d.message||'注入失败');
    }
    catch(err){ toast('error','请求失败: '+err.message); }
}

async function sendAndWaitMsg(tid,sid,loop) {
    var m=$('convInput').value.trim(); if(!m){toast('warn','请先输入消息');return;}
    var btn=$('btnSendWait'); btn.disabled=true; btn.textContent='⏳ 等待中...';
    try {
        var body={taskId:tid,stepId:sid,message:m};
        if(loop!=null) body.loop=loop;
        var d=await API.post('/api/flexrunner/send-and-wait',body); if(d.status==='ok'){toast('success','已收到回复');$('convInput').value='';getLiveMsgs(tid,sid,loop);} else toast('warn',d.message||'发送失败');
    }
    catch(err){ toast('error','请求失败: '+err.message); }
    finally { btn.disabled=false; btn.textContent='📨 发送并等待'; }
}

function renderMessages(msgs) {
    var list=$('msgList'); if(!list) return;
    if(!msgs||msgs.length===0){list.innerHTML='<div class="muted" style="font-size:12px;">暂无消息</div>';return;}
    list.innerHTML=msgs.map(function(m) {
        var role=m.role||(m.info&&m.info.role)||'unknown';
        // 显式取 content，空字符串不 fallback 到 JSON.stringify
        var content = m.content != null ? m.content : ((m.parts&&m.parts[0]&&m.parts[0].text) || '');
        if (!content || content.trim()==='') return '';
        var t=m.timestamp||''; var rc=role==='user'?'user':role==='assistant'?'assistant':'system';
        return '<div class="msg-item '+rc+'"><div class="role">'+escapeHtml(role)+'</div><div>'+escapeHtml(content)+'</div>'+(t?'<div class="time">'+escapeHtml(t)+'</div>':'')+'</div>';
    }).filter(Boolean).join('');
}

/* ─── 控制 Tab ──────────────────────────────────────────────────────── */
function renderControlTab(step) {
    var tid=State.selectedTaskId, sid=step.stepId;
    var ce=step.canRetry!==false&&step.status!=='running', ir=step.status==='running';
    $('detailContent').innerHTML='<div class="detail-section"><h4>FlexRunner 控制</h4>'+
        '<div class="kv-list" style="margin-bottom:12px;"><div class="k">任务</div><div class="v">'+escapeHtml(tid)+'</div><div class="k">步骤</div><div class="v">'+escapeHtml(sid)+'</div><div class="k">状态</div><div class="v"><span class="status-badge '+step.status+'">'+statusLabel(step.status)+'</span></div></div>'+
        '<div class="detail-actions"><button class="primary" id="btnExec" '+(ce?'':'disabled')+'>▶ 执行单次</button><button class="success" id="btnExecLoop" '+(ce?'':'disabled')+'>🔁 自动循环</button></div>'+
        '<div class="detail-actions" style="margin-top:6px;"><button class="warn" id="btnPause" '+(ir?'':'disabled')+'>⏸ 暂停</button><button class="secondary" id="btnResume" '+(ir?'':'disabled')+'>▶ 继续</button><button class="danger" id="btnAbort" '+(ir?'':'disabled')+'>⏹ 终止</button></div>'+
        '<div class="detail-actions" style="margin-top:6px;"><button class="secondary" id="btnCheckRes">📋 检查结果</button><button class="secondary" id="btnRefreshRunner">🔄 刷新状态</button></div></div>'+
        '<div class="detail-section"><h4>执行输出</h4><div class="msg-list" id="controlOutput" style="font-family:\'SF Mono\',Monaco,monospace;font-size:11px;background:var(--code-bg);padding:10px;border-radius:6px;min-height:60px;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;">等待操作...</div></div>';
    $('btnExec').onclick=function(){execSingle(tid,sid);};
    $('btnExecLoop').onclick=function(){execLoop(tid,sid);};
    $('btnPause').onclick=function(){runnerControl(tid,sid,'pause');};
    $('btnResume').onclick=function(){runnerControl(tid,sid,'resume');};
    $('btnAbort').onclick=function(){runnerControl(tid,sid,'abort');};
    $('btnCheckRes').onclick=function(){checkResultFile(tid,sid);};
    $('btnRefreshRunner').onclick=function(){refreshRunnerStatus(tid,sid);};
}

function logControl(msg) {
    var o=$('controlOutput'); if(!o) return; if(o.textContent==='等待操作...') o.textContent='';
    var t=new Date().toLocaleTimeString('zh-CN'); o.textContent+='['+t+'] '+msg+'\n'; o.scrollTop=o.scrollHeight;
}

async function execSingle(tid,sid) {
    logControl('执行单次...'); try { var d=await API.post('/api/flexrunner/execute',{taskId:tid,stepId:sid}); if(d.status==='ok'){var r=d.result;logControl('完成: success='+r.success+', nextStepId='+(r.nextStepId||'(结束)'));toast(r.success?'success':'warn','执行'+(r.success?'成功':'失败'));} else {logControl('失败: '+(d.error||JSON.stringify(d)));toast('error','执行失败');} await loadOrchestratorProgress(tid); } catch(err){ logControl('请求失败: '+err.message); toast('error',err.message); }
}

async function execLoop(tid,sid) {
    logControl('开始自动循环...'); try { var d=await API.post('/api/flexrunner/execute-loop',{taskId:tid,stepId:sid}); if(d.results)d.results.forEach(function(r){logControl('第'+r.attempt+'次: success='+r.success);}); logControl('循环结束: 共'+d.totalAttempts+'次, 最终='+(d.finalResult?d.finalResult.success:'?')); toast(d.finalResult&&d.finalResult.success?'success':'error','循环结束: '+d.totalAttempts+'次'); await loadOrchestratorProgress(tid); } catch(err){ logControl('请求失败: '+err.message); toast('error',err.message); }
}

async function runnerControl(tid,sid,type) {
    logControl('控制: '+type); try { var d=await API.post('/api/flexrunner/control',{taskId:tid,stepId:sid,type:type}); logControl(type+': '+d.message); toast(d.status==='ok'?'success':'warn',d.message); await loadOrchestratorProgress(tid); } catch(err){ logControl('请求失败: '+err.message); }
}

async function checkResultFile(tid,sid) {
    logControl('检查结果文件...'); try { var d=await API.post('/api/flexrunner/check-result',{taskId:tid,stepId:sid}); if(d.status==='ok'){logControl('结果: '+(d.success?'成功':'失败')+' — '+d.resultFilePath);if(d.content){var fn=(d.resultFilePath||'结果文件').split(/[/\\]/).pop();var ext=(fn.split('.').pop()||'').toLowerCase();if(ext==='md'||ext==='markdown')MarkdownReader.open(fn,d.content);else showModal('结果文件',d.content);}} else logControl('失败: '+d.error); } catch(err){ logControl('请求失败: '+err.message); }
}

async function refreshRunnerStatus(tid,sid) {
    try { var d=await API.get('/api/flexrunner/status?taskId='+encodeURIComponent(tid)+'&stepId='+encodeURIComponent(sid)); if(d.status==='ok'){toast('info','状态已刷新');await loadOrchestratorProgress(tid);} } catch(err){ toast('error',err.message); }
}

/* ─── 文件 Tab ──────────────────────────────────────────────────────── */
async function renderFilesTab(step) {
    var tid=State.selectedTaskId, loop=State.selectedLoop;
    $('detailContent').innerHTML='<div class="detail-section"><h4>加载文件列表...</h4></div>';
    try {
        var url='/api/flexrunner/steps?taskId='+encodeURIComponent(tid)+'&stepId='+encodeURIComponent(step.stepId);
        if(loop!=null) url+='&loop='+encodeURIComponent(loop);
        var d=await API.get(url);
        if(d.status==='ok'){
            var files=d.files||[];
            $('detailContent').innerHTML='<div class="detail-section"><h4>步骤 '+escapeHtml(step.stepId)+' 的文件 ('+files.length+')</h4>'+
                (files.length===0?'<div class="muted" style="font-size:12px;">暂无文件</div>':
                '<div class="msg-list">'+files.map(function(f){
                    var label=f.loop!=null?('L'+f.loop+' — '):'';
                    return '<div class="history-item" style="cursor:pointer;" onclick="viewFile(\''+escapeHtml(f.path)+'\')"><span>📄 '+label+escapeHtml(f.filename)+'</span><span class="muted">'+f.size+' bytes</span></div>';
                }).join('')+'</div>')+'</div>'+
                '<div class="detail-section"><h4>所有任务文件</h4><button class="secondary sm" id="btnListAllFiles">查看全部文件</button><div class="msg-list" id="allFilesList" style="margin-top:8px;"></div></div>';
            $('btnListAllFiles').onclick=function(){listAllFiles(tid,loop);};
        }
    } catch(err){ toast('error',err.message); }
}

async function listAllFiles(tid,loop) {
    try {
        var url='/api/flexrunner/steps?taskId='+encodeURIComponent(tid);
        if(loop!=null) url+='&loop='+encodeURIComponent(loop);
        var d=await API.get(url);
        if(d.status==='ok'){
            var files=d.files||[];
            $('allFilesList').innerHTML=files.map(function(f){
                var label=f.loop!=null?('L'+f.loop+' — '):'';
                return '<div class="history-item" style="cursor:pointer;" onclick="viewFile(\''+escapeHtml(f.path)+'\')"><span>📄 '+label+'步骤'+escapeHtml(f.stepId)+'/'+escapeHtml(f.filename)+'</span><span class="muted">'+f.size+'B</span></div>';
            }).join('');
        }
    } catch(err){ toast('error',err.message); }
}

async function viewFile(fp) {
    try {
        var d = await API.get('/api/flexrunner/file?path=' + encodeURIComponent(fp));
        if (d.status !== 'ok') { toast('error', d.error); return; }
        var filename = fp.split(/[/\\]/).pop();
        var ext = filename.split('.').pop().toLowerCase();
        if (ext === 'md' || ext === 'markdown') {
            MarkdownReader.open(filename, d.content);
        } else {
            showModal(filename, d.content);
        }
    } catch(err) {
        toast('error', err.message);
    }
}

/* ─── Brain 拆解 ────────────────────────────────────────────────────── */
async function loadBrainPlan(tid, loop) {
    try {
        var url = '/api/brain/plan?taskId='+encodeURIComponent(tid);
        if (loop != null) url += '&loop=' + encodeURIComponent(loop);
        var d = await API.get(url);
        if(d.status==='ok'&&d.plan){State.brainPlan=d.plan;renderBrainSection();} else {State.brainPlan=null;renderBrainSection();}
    } catch(err) { State.brainPlan=null; renderBrainSection(); }
}

function renderBrainSection() {
    var plan=State.brainPlan;
    if (!plan) { $('brainSection').innerHTML='<div class="rounds-empty">暂无 Brain 拆解数据</div>'; return; }
    var td=plan.taskDef||{}, steps=td.steps||[], an=plan.analysis||{}, valid=plan.validation&&plan.validation.valid;
    var ac=td.acceptanceCriteria||an.acceptanceCriteria||[];
    var h='';
    h+='<div class="brain-card"><h3>📊 任务分析</h3><div class="kv-grid">';
    h+='<div class="k">Plan ID</div><div class="v">'+escapeHtml(plan.planId||'—')+'</div>';
    h+='<div class="k">Task ID</div><div class="v">'+escapeHtml(plan.taskId||td.taskId||'—')+'</div>';
    h+='<div class="k">校验</div><div class="v">'+(valid?'<span class="badge ok">通过</span>':'<span class="badge error">未通过</span>')+'</div>';
    h+='<div class="k">创建时间</div><div class="v">'+escapeHtml(plan.createdAt||'—')+'</div>';
    h+='<div class="k">轮次</div><div class="v">'+(plan.isReplan?'第 '+(plan.loopCount||0)+' 轮 (重规划)':'第 0 轮 (初始)')+'</div>';
    h+='<div class="k">分析 Session</div><div class="v">'+escapeHtml(plan.analysisSessionId||'—')+'</div>';
    h+='<div class="k">拆解 Session</div><div class="v">'+escapeHtml(plan.decompositionSessionId||'—')+'</div>';
    h+='</div>';
    if (an.intent) h+='<div style="margin-top:10px;font-size:12px;padding:8px;background:var(--code-bg);border-radius:6px;"><strong>任务意图:</strong> '+escapeHtml(an.intent)+'</div>';
    h+='<div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;">';
    if(an.domain) h+='<span class="stat-item">领域: <strong>'+escapeHtml(an.domain)+'</strong></span>';
    if(an.complexity) h+='<span class="stat-item">复杂度: <strong>'+escapeHtml(an.complexity)+'</strong></span>';
    if(an.estimatedSteps) h+='<span class="stat-item">预计步骤: <strong>'+an.estimatedSteps+'</strong></span>';
    h+='</div>';
    if(an.keywords&&an.keywords.length>0) h+='<div style="margin-top:8px;font-size:11px;color:var(--text2);">关键词: '+escapeHtml(an.keywords.join(', '))+'</div>';
    if(an.techStack&&an.techStack.length>0) h+='<div style="margin-top:4px;font-size:11px;color:var(--text2);">技术栈: '+escapeHtml(an.techStack.join(', '))+'</div>';
    h+='</div>';
    if (ac.length>0) {
        h+='<div class="brain-card"><h3>✅ 验收标准 ('+ac.length+' 条)</h3><div class="criteria-list">';
        ac.forEach(function(c){ h+='<div class="criteria-item satisfied"><span class="criteria-icon">📋</span><div class="criteria-text"><div class="criterion">'+escapeHtml(c.criterion||'')+'</div><div class="reason">类型: '+escapeHtml(c.type||'—')+' | 验证: '+escapeHtml(c.verification||'—')+'</div></div></div>'; });
        h+='</div></div>';
    }
    h+='<div class="brain-card"><h3>📋 拆解步骤 ('+steps.length+' 步)</h3><div class="step-flow">';
    steps.forEach(function(s,idx){
        var dep=getDepIds(s.dependId).length>0?'依赖步骤 '+getDepIds(s.dependId).join(', '):'入口步骤';
        var nxt=s.nextStepId&&s.nextStepId!=='0'?'→ 步骤 '+s.nextStepId:'→ 结束';
        var fail=s.failStepId&&s.failStepId!=='0'?' | 失败→步骤 '+s.failStepId:'';
        h+='<div class="step-flow-item"><div class="step-num">'+(idx+1)+'</div><div class="step-info"><div class="step-desc">'+escapeHtml(s.taskDescription||'')+'</div><div class="step-meta">'+dep+' · '+nxt+fail+' · 重试'+(s.maxRetries||3)+'次</div></div></div>';
    });
    h+='</div></div>';
    if (!valid&&plan.validation&&plan.validation.issues&&plan.validation.issues.length>0) {
        h+='<div class="brain-card"><h3 style="color:var(--red);">⚠️ 校验问题</h3><div style="font-size:12px;color:var(--red);">';
        plan.validation.issues.forEach(function(i){h+='<div>• '+escapeHtml(i)+'</div>';});
        h+='</div></div>';
    }
    h+='<div class="brain-card"><h3>📦 原始 JSON</h3><button class="secondary sm" onclick="showModal(\'Plan JSON\', JSON.stringify(State.brainPlan, null, 2))">查看完整 JSON</button></div>';
    $('brainSection').innerHTML=h;
}

/* ─── 审核详情 & 终止 ──────────────────────────────────────────────── */
async function loadCheckDetail(tid,loop) {
    try { var d=await API.get('/api/loopengine/progress?taskId='+encodeURIComponent(tid)); if(d.status==='ok'&&d.progress){ var r=(d.progress.rounds||[]).find(function(x){return x.loop===loop;}); if(r){ var c='=== 第 '+(loop+1)+' 轮准出审核 ===\n\n'; c+='Check ID: '+(r.checkId||'—')+'\n'; c+='状态: '+statusLabel(r.checkStatus)+'\n'; c+='通过: '+(r.checkPassed?'是':'否')+'\n\n'; c+='审核摘要:\n'+(r.checkSummary||'—')+'\n'; showModal('审核详情 - 第'+(loop+1)+'轮',c); } else toast('error','未找到第'+(loop+1)+'轮审核数据'); } } catch(err){ toast('error','加载审核详情失败: '+err.message); }
}

async function loadCheckSession(tid, loop) {
    try {
        var d = await API.get('/api/loopengine/check-session?taskId=' + encodeURIComponent(tid) + '&loop=' + encodeURIComponent(loop));
        if (d.status === 'ok') {
            var msgs = d.messages || [];
            var title = '审核对话 - 第' + (loop + 1) + '轮';
            if (d.sessionId) title += ' (' + d.sessionId.substring(0, 20) + '...)';
            showSessionModal(title, msgs);
        } else {
            toast('error', d.error || '获取审核对话失败');
        }
    } catch(err) {
        toast('error', '获取审核对话失败: ' + err.message);
    }
}

async function abortLoop() {
    var tid=State.selectedTaskId; if(!tid) return;
    try { var d=await API.post('/api/loopengine/abort',{taskId:tid}); toast(d.status==='ok'?'warn':'error',d.message||'终止完成'); await loadLoopProgress(tid); loadLoopList(); } catch(err){ toast('error',err.message); }
}

/* ─── 轮询 & SSE ────────────────────────────────────────────────────── */
function startPolling(tid) {
    stopPolling();
    State.pollTimer=setInterval(async function(){
        // 用户正在查看历史轮次 → 静默刷新（只更新徽章，不重建 DOM）
        // 用户在最新轮 → 正常刷新
        var viewingHistory = State.selectedLoop != null;
        await loadLoopProgress(tid, { silent: viewingHistory });
        if (!viewingHistory) {
            await loadOrchestratorProgress(tid);
        }
        loadLoopList();
        if(State.currentProgress){var s=State.currentProgress.status;if(s!=='planning'&&s!=='executing'&&s!=='checking')stopPolling();}
    },3000);
}

function stopPolling() { if(State.pollTimer){clearInterval(State.pollTimer);State.pollTimer=null;} }

function closeSSE() {
    if (State.sseSource) {
        try { State.sseSource.close(); } catch(e) {}
        State.sseSource=null;
    }
}

function connectSSE(tid) {
    closeSSE();
    try {
        var es=new EventSource('/stream/tasks/'+encodeURIComponent(tid));
        State.sseSource=es;
        // SSE 事件处理：用户正在查看历史轮次时，进度更新走静默模式（不重建 DOM），
        // 编排图/Brain 计划的更新也跳过，避免打断用户视图。
        // 终止/完成/错误等关键事件始终强制刷新，确保用户看到最终状态。
        es.addEventListener('loop:start',function(){toast('info','大循环已启动');loadLoopProgress(tid,{silent:State.selectedLoop!=null});});
        es.addEventListener('loop:round:start',function(e){try{var d=JSON.parse(e.data);toast('info','第 '+(d.loop+1)+'/'+d.total+' 轮开始');loadLoopProgress(tid,{silent:State.selectedLoop!=null});}catch(x){}});
        es.addEventListener('loop:planning',function(e){try{var d=JSON.parse(e.data);toast('info','第 '+(d.loop+1)+' 轮: Brain '+(d.isReplan?'重规划中':'拆解中')+'...');loadLoopProgress(tid,{silent:State.selectedLoop!=null});if(State.selectedLoop==null)loadBrainPlan(tid);}catch(x){}});
        es.addEventListener('loop:executing',function(e){try{var d=JSON.parse(e.data);toast('info','第 '+(d.loop+1)+' 轮: Orchestrator 执行中...');loadLoopProgress(tid,{silent:State.selectedLoop!=null});if(State.selectedLoop==null)loadOrchestratorProgress(tid);}catch(x){}});
        es.addEventListener('loop:checking',function(e){try{var d=JSON.parse(e.data);toast('info','第 '+(d.loop+1)+' 轮: TestCheck 审核中...');loadLoopProgress(tid,{silent:State.selectedLoop!=null});}catch(x){}});
        es.addEventListener('loop:round:end',function(e){try{var d=JSON.parse(e.data);if(d.passed)toast('success','第 '+(d.loop+1)+' 轮: ✅ 准出通过');else toast('warn','第 '+(d.loop+1)+' 轮: ❌ 准出未通过，进入下一轮');loadLoopProgress(tid,{silent:State.selectedLoop!=null});if(State.selectedLoop==null)loadBrainPlan(tid);loadLoopList();}catch(x){}});
        es.addEventListener('loop:complete',function(e){try{var d=JSON.parse(e.data);if(d.passed)toast('success','🎉 大循环完成: 准出通过! 共 '+d.totalRounds+' 轮');else toast('error','大循环结束: '+d.status+', 共 '+d.totalRounds+' 轮');stopPolling();loadLoopProgress(tid);loadLoopList();}catch(x){}});
        es.addEventListener('loop:aborted',function(){toast('warn','大循环已终止');stopPolling();loadLoopProgress(tid);loadLoopList();});
        es.addEventListener('loop:error',function(e){try{var d=JSON.parse(e.data);toast('error','大循环出错: '+(d.error||''));}catch(x){}stopPolling();loadLoopProgress(tid);loadLoopList();});
        es.addEventListener('orch:step:status',function(e){try{var d=JSON.parse(e.data);toast('info','步骤 '+d.stepId+': '+statusLabel(d.status));if(State.selectedLoop==null)loadOrchestratorProgress(tid);}catch(x){}});
        es.addEventListener('orch:task:complete',function(){toast('success','编排任务完成');if(State.selectedLoop==null)loadOrchestratorProgress(tid);loadLoopProgress(tid);loadLoopList();});
        es.addEventListener('orch:task:error',function(){toast('error','编排任务出错');if(State.selectedLoop==null)loadOrchestratorProgress(tid);loadLoopProgress(tid);loadLoopList();});
        es.addEventListener('orch:task:aborted',function(){toast('warn','编排任务已终止');if(State.selectedLoop==null)loadOrchestratorProgress(tid);loadLoopProgress(tid);loadLoopList();});
        es.onerror=function(){
            // 连接错误（含后端限流主动关闭连接）：主动关闭并置空，
            // 阻止浏览器对 EventSource 的无限自动重连，避免连接泄漏
            es.close();
            if (State.sseSource === es) State.sseSource=null;
        };
        // 页面刷新/关闭时释放连接，避免刷新后残留订阅（仅注册一次）
        if (!State._sseUnloadBound) {
            window.addEventListener('beforeunload', closeSSE);
            State._sseUnloadBound = true;
        }
    } catch(err){}
}

/* ─── 弹窗 ──────────────────────────────────────────────────────────── */
function showModal(title,content) { $('modalTitle').textContent=title; $('modalContent').textContent=content; $('modalOverlay').classList.add('show'); }
function closeModal() { $('modalOverlay').classList.remove('show'); }

function showSessionModal(title, msgs) {
    $('modalTitle').textContent = title;
    var el = $('modalContent');
    if (!msgs || msgs.length === 0) {
        el.textContent = '暂无对话消息';
    } else {
        el.innerHTML = msgs.map(function(m) {
            var role = m.role || (m.info && m.info.role) || 'unknown';
            var content = m.content != null ? m.content : ((m.parts && m.parts[0] && m.parts[0].text) || '');
            if (!content || content.trim() === '') return '';
            var t = m.timestamp || '';
            var rc = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system';
            return '<div class="msg-item ' + rc + '"><div class="role">' + escapeHtml(role) + '</div><div>' + escapeHtml(content) + '</div>' + (t ? '<div class="time">' + escapeHtml(t) + '</div>' : '') + '</div>';
        }).filter(Boolean).join('');
    }
    $('modalOverlay').classList.add('show');
}

function openNewLoopModal() {
    $('newLoopDesc').value=''; $('newLoopCriteria').value=''; $('newLoopMaxLoops').value='3';
    $('newLoopTaskId').value=''; $('newLoopSkillDir').value=''; $('newLoopTaskDir').value='';
    $('advancedSection').classList.remove('show'); $('advancedToggle').classList.remove('open');
    $('newLoopOverlay').classList.add('show');
}
function closeNewLoopModal() { $('newLoopOverlay').classList.remove('show'); }

async function submitNewLoop() {
    var desc=$('newLoopDesc').value.trim(); if(!desc){toast('warn','请输入任务描述');return;}
    var ml=parseInt($('newLoopMaxLoops').value,10)||3, cr=$('newLoopCriteria').value.trim();
    var tid=$('newLoopTaskId').value.trim()||undefined, sd=$('newLoopSkillDir').value.trim()||undefined, td=$('newLoopTaskDir').value.trim()||undefined;
    var body={taskDescription:desc,maxLoops:ml};
    if(cr)body.acceptanceCriteria=cr; if(tid)body.taskId=tid; if(sd)body.skillDirectory=sd; if(td)body.taskDir=td;
    var btn=$('btnNewLoopSubmit'); btn.disabled=true; btn.textContent='⏳ 启动中...';
    try { var d=await API.post('/api/loopengine/start',body); btn.disabled=false; btn.textContent='🚀 启动大循环'; if(d.status==='ok'){toast('success','大循环已启动: '+d.taskId);closeNewLoopModal();loadLoopList();selectLoop(d.taskId);} else toast('error',d.error||d.message||'启动失败'); }
    catch(err){ btn.disabled=false; btn.textContent='🚀 启动大循环'; toast('error','请求失败: '+err.message); }
}

/* ─── 单次执行弹窗 ────────────────────────────────────────────────── */
function openNewSingleModal() {
    $('newSingleDesc').value=''; $('newSingleTaskId').value=''; $('newSingleSkillDir').value='';
    $('newSingleTaskDir').value=''; $('newSingleInputReport').value=''; $('newSingleMaxRetries').value='3';
    $('singleAdvancedSection').classList.remove('show'); $('singleAdvancedToggle').classList.remove('open');
    $('newSingleOverlay').classList.add('show');
}
function closeNewSingleModal() { $('newSingleOverlay').classList.remove('show'); }

async function submitNewSingle() {
    var desc=$('newSingleDesc').value.trim(); if(!desc){toast('warn','请输入任务描述');return;}
    var tid=$('newSingleTaskId').value.trim()||undefined;
    var sd=$('newSingleSkillDir').value.trim()||undefined;
    var td=$('newSingleTaskDir').value.trim()||undefined;
    var ir=$('newSingleInputReport').value.trim()||undefined;
    var mr=parseInt($('newSingleMaxRetries').value,10)||3;
    var body={taskDescription:desc,maxRetries:mr};
    if(tid)body.taskId=tid; if(sd)body.skillDirectory=sd; if(td)body.taskDir=td; if(ir)body.inputReport=ir;
    var btn=$('btnNewSingleSubmit'); btn.disabled=true; btn.textContent='⏳ 启动中...';
    try {
        var d=await API.post('/api/flexrunner/start-single',body);
        btn.disabled=false; btn.textContent='⚡ 启动单次执行';
        if(d.status==='ok'){toast('success','单次执行已启动: '+d.taskId);closeNewSingleModal();loadLoopList();selectLoop(d.taskId);}
        else toast('error',d.error||d.message||'启动失败');
    }
    catch(err){ btn.disabled=false; btn.textContent='⚡ 启动单次执行'; toast('error','请求失败: '+err.message); }
}

/* ─── Tab 切换 ──────────────────────────────────────────────────────── */
function switchToOrchTab(loop) {
    document.querySelectorAll('.main-tab').forEach(function(t){t.classList.remove('active');});
    document.querySelector('.main-tab[data-tab="orchestrator"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
    $('tabOrchestrator').classList.add('active'); State.activeMainTab='orchestrator';
    if (loop != null && State.selectedTaskId) { loadOrchestratorProgress(State.selectedTaskId, loop); }
    else { renderGraph(); }
}
function switchToBrainTab(loop) {
    document.querySelectorAll('.main-tab').forEach(function(t){t.classList.remove('active');});
    document.querySelector('.main-tab[data-tab="brain"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
    $('tabBrain').classList.add('active'); State.activeMainTab='brain';
    if (loop != null && State.selectedTaskId) { loadBrainPlan(State.selectedTaskId, loop); }
}

/* ─── 事件绑定 & 初始化 ──────────────────────────────────────────────── */
document.querySelectorAll('.main-tab').forEach(function(tab){
    tab.onclick=function(){
        document.querySelectorAll('.main-tab').forEach(function(t){t.classList.remove('active');});
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
        var tgt=tab.dataset.tab; State.activeMainTab=tgt;
        if(tgt==='rounds')$('tabRounds').classList.add('active');
        else if(tgt==='orchestrator')$('tabOrchestrator').classList.add('active');
        else if(tgt==='brain')$('tabBrain').classList.add('active');
    };
});

document.querySelectorAll('.detail-tab').forEach(function(tab){
    tab.onclick=function(){
        document.querySelectorAll('.detail-tab').forEach(function(t){t.classList.remove('active');});
        tab.classList.add('active'); State.activeDetailTab=tab.dataset.tab; State._convRenderedStep=null; renderDetailPanel();
    };
});

$('healthBtn').onclick=checkHealth;
$('loopSearch').oninput=filterLoops;
$('btnNewLoop').onclick=openNewLoopModal;
$('newLoopClose').onclick=closeNewLoopModal;
$('newLoopOverlay').onclick=function(e){if(e.target===$('newLoopOverlay'))closeNewLoopModal();};
$('btnNewLoopCancel').onclick=closeNewLoopModal;
$('btnNewLoopSubmit').onclick=submitNewLoop;
$('btnLoopAbort').onclick=abortLoop;
$('btnLoopRefresh').onclick=function(){if(State.selectedTaskId){State.selectedLoop=null;loadAllData(State.selectedTaskId);}};
$('modalClose').onclick=closeModal;
$('modalOverlay').onclick=function(e){if(e.target===$('modalOverlay'))closeModal();};
$('advancedToggle').onclick=function(){$('advancedSection').classList.toggle('show');$('advancedToggle').classList.toggle('open');};

/* ─── 单次执行事件绑定 ─── */
$('btnNewSingle').onclick=openNewSingleModal;
$('newSingleClose').onclick=closeNewSingleModal;
$('newSingleOverlay').onclick=function(e){if(e.target===$('newSingleOverlay'))closeNewSingleModal();};
$('btnNewSingleCancel').onclick=closeNewSingleModal;
$('btnNewSingleSubmit').onclick=submitNewSingle;
$('singleAdvancedToggle').onclick=function(){$('singleAdvancedSection').classList.toggle('show');$('singleAdvancedToggle').classList.toggle('open');};
$('btnGraphFit').onclick=graphFitToView;
$('btnGraphZoomIn').onclick=function(){graphZoomBy(1.2);};
$('btnGraphZoomOut').onclick=function(){graphZoomBy(0.83);};
$('btnGraphRefresh').onclick=function(){if(State.selectedTaskId)loadOrchestratorProgress(State.selectedTaskId, State.selectedLoop);};
initGraphInteraction();

// 暴露给 onclick 内联调用
window.selectLoop=selectLoop;
window.selectStep=selectStep;
window.viewFile=viewFile;
window.loadCheckDetail=loadCheckDetail;
window.loadCheckSession=loadCheckSession;
window.switchToOrchTab=switchToOrchTab;
window.switchToBrainTab=switchToBrainTab;
window.showModal=showModal;

// 启动
checkHealth();
loadLoopList();
setInterval(function(){loadLoopList();},30000);
