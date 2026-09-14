/**
 * M2 验收：F-09 SSE 背压保护 / F-10 连接身份与准入
 *
 * 用可模拟背压的假 ServerResponse 做白盒验证，不需要真实网络：
 *   A write() 返回 false → 进入背压态，后续事件不再直写
 *   B 可合并事件（全量进度快照）只保留最新一帧，并计入 droppedFrames
 *   C drain 后按「先队列、后最新快照」顺序排空
 *   D 背压队列超限 → 主动断开慢客户端（保护进程内存）
 *   E 准入：全局连接上限与单用户上限均生效且可区分
 *   F 连接移除幂等：重复触发 close 不导致计数漂移
 *   G close(channel) 正确回收用户计数（初版会永久虚高）
 *   H 心跳跳过背压中的连接（不继续堆内存）
 *   I res 上的 'error' 事件被监听并清理连接（避免未监听 error 崩进程）
 *   J 持续背压超过阈值 → 由清理任务断开
 */
import { EventEmitter } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { default: SseHub } = await import(pathToFileURL(`${ROOT}Server/Routes/sse/SseHub.js`).href);

class FakeRes extends EventEmitter {
    constructor() {
        super();
        this.writableEnded = false;
        this.destroyed = false;
        this.written = [];
        this.overflow = false;   // true → write() 返回 false（模拟内核缓冲满）
    }
    write(payload) {
        this.written.push(payload);
        return this.overflow ? false : true;
    }
    end() {
        if (this.writableEnded) return;
        this.writableEnded = true;
        this.emit('close');
    }
    endCount() { return this.written.filter((w) => w.startsWith('event:')).length; }
}

/** 事件类型计数（从已写入文本里数 event: 行） */
const countEvents = (res, type) =>
    res.written.filter((w) => w.includes(`event: ${type}\n`)).length;

function newHub(overrides = {}) {
    // 关掉定时器：测试里手动触发，避免干扰
    return new SseHub({
        heartbeatMs: 1000 * 60 * 60,
        cleanupMs: 1000 * 60 * 60,
        timeoutMs: 1000 * 60 * 60,
        ...overrides,
    });
}

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 订阅一个假连接 */
function sub(hub, channel, userId = 'u1') {
    const res = new FakeRes();
    const r = hub.subscribe(channel, res, { userId });
    if (!r.ok) throw new Error(`subscribe 失败: ${r.message}`);
    return { res, connId: r.connId };
}

// ─── A. 背压态判定 ────────────────────────────────────────────────────────
{
    const hub = newHub();
    const { res } = sub(hub, 'tA');
    // 初始 connected 事件已直写
    check('A 连接建立后先收到 connected 事件', countEvents(res, 'connected') === 1);

    res.overflow = true;             // 下一次写会返回 false
    hub.emit('tA', 'orch:step:status', { stepId: 1 });
    const stats1 = hub.getStats();
    check('A write() 返回 false 后进入背压态', stats1.backpressured === 1, `backpressured=${stats1.backpressured}`);

    const before = countEvents(res, 'orch:step:status');
    hub.emit('tA', 'orch:step:status', { stepId: 2 });
    hub.emit('tA', 'orch:step:status', { stepId: 3 });
    check('A 背压期间不再直写（事件被缓冲而非继续写 socket）',
        countEvents(res, 'orch:step:status') === before,
        `written=${countEvents(res, 'orch:step:status')}`);
    check('A 背压期间事件进入队列', hub.getStats().queuedFrames === 2, `queued=${hub.getStats().queuedFrames}`);
    hub.destroy();
}

// ─── B. 可合并事件只留最新 ────────────────────────────────────────────────
{
    const hub = newHub();
    const { res } = sub(hub, 'tB');
    res.overflow = true;
    hub.emit('tB', 'orch:step:status', { stepId: 1 });   // 触发进入背压态
    // 连续 5 次全量进度快照：只应保留最后 1 帧，前 4 帧被合并丢弃
    for (let i = 2; i <= 6; i++) hub.emit('tB', 'orch:task:progress', { n: i });

    const stats = hub.getStats();
    check('B 可合并事件只保留最新 1 帧（含 1 帧队列 + 1 帧快照）',
        stats.queuedFrames <= 2, `queuedFrames=${stats.queuedFrames}`);
    check('B 被合并掉的帧计入 totalDroppedFrames', stats.totalDroppedFrames === 4,
        `dropped=${stats.totalDroppedFrames}`);

    // 恢复后应只发出最后一帧快照
    res.overflow = false;
    res.emit('drain');
    const progresses = res.written.filter((w) => w.includes('event: orch:task:progress'));
    check('B 恢复后只补发最后一帧快照', progresses.length === 1, `frames=${progresses.length}`);
    check('B 补发的是最新一帧（n=6）', progresses[0]?.includes('"n":6'), progresses[0]?.split('\n')[2]);
    hub.destroy();
}

// ─── C. drain 排空顺序 ───────────────────────────────────────────────────
{
    const hub = newHub();
    const { res } = sub(hub, 'tC');
    res.overflow = true;
    hub.emit('tC', 'orch:step:status', { seq: 'S1' });      // 进队 + 触发背压
    hub.emit('tC', 'orch:step:status', { seq: 'S2' });      // 进队
    hub.emit('tC', 'orch:task:progress', { seq: 'P9' });    // 合并槽（更新）
    res.overflow = false;
    res.emit('drain');

    const text = res.written.join('');
    const iS1 = text.indexOf('S1');
    const iS2 = text.indexOf('S2');
    const iP9 = text.indexOf('P9');
    check('C 队列内事件保持先后顺序（S1 在 S2 之前）', iS1 !== -1 && iS2 !== -1 && iS1 < iS2);
    check('C 更新的合并快照在队列之后发出', iP9 > iS2, `iS2=${iS2} iP9=${iP9}`);
    check('C 排空后队列清空', hub.getStats().queuedFrames === 0);
    hub.destroy();
}

// ─── D. 背压队列超限 → 断开慢客户端 ──────────────────────────────────────
{
    const hub = newHub({ maxQueuedFrames: 3 });
    const { res } = sub(hub, 'tD');
    res.overflow = true;
    hub.emit('tD', 'orch:step:status', { n: 0 });           // 触发背压
    for (let i = 1; i <= 10; i++) hub.emit('tD', 'orch:step:status', { n: i });

    const stats = hub.getStats();
    check('D 队列超限后断开慢客户端（连接数归零）', stats.totalConnections === 0,
        `totalConnections=${stats.totalConnections}`);
    check('D 计入 totalDroppedConnections', stats.totalDroppedConnections === 1,
        `droppedConns=${stats.totalDroppedConnections}`);
    check('D 慢客户端被 end()', res.writableEnded === true);
    check('D 队列不超上限（内存有界）', stats.queuedFrames <= 3, `queued=${stats.queuedFrames}`);
    hub.destroy();
}

// ─── E. 准入：全局上限与单用户上限 ───────────────────────────────────────
{
    const hub = newHub({ maxTotalConnections: 3, maxPerUser: 2 });
    check('E 空载时可订阅', hub.canSubscribe('u1').ok === true);

    sub(hub, 'tE1', 'u1');
    sub(hub, 'tE2', 'u1');
    const perUser = hub.canSubscribe('u1');
    check('E 单用户达上限 → 拒绝且错误码正确',
        perUser.ok === false && perUser.errorCode === 'E429_SSE_LIMIT', JSON.stringify(perUser));
    check('E 其他用户仍可订阅（不是全局 10 连接硬上限）', hub.canSubscribe('u2').ok === true);

    sub(hub, 'tE3', 'u2');   // 全局已达 3
    const total = hub.canSubscribe('u3');
    check('E 全局达上限 → 拒绝且错误码可区分',
        total.ok === false && total.errorCode === 'E429_SSE_TOTAL_LIMIT', JSON.stringify(total));
    check('E 统计暴露上限值', hub.getStats().maxTotalConnections === 3, `max=${hub.getStats().maxTotalConnections}`);
    hub.destroy();
}

// ─── F. 移除幂等 ─────────────────────────────────────────────────────────
{
    const hub = newHub({ maxPerUser: 5, maxTotalConnections: 5 });
    const { res } = sub(hub, 'tF', 'uF');
    sub(hub, 'tF', 'uF');
    check('F 初始 2 连接 / 1 用户', hub.getStats().totalConnections === 2 && hub.getStats().totalUsers === 1);

    // 同一连接重复触发 close（模拟 close + 清理路径同时命中）
    res.end();
    res.emit('close');
    res.emit('close');
    const stats = hub.getStats();
    check('F 重复 close 后连接数只减 1', stats.totalConnections === 1, `total=${stats.totalConnections}`);
    check('F 重复 close 后用户计数不漂移（仍为 1 个用户）', stats.totalUsers === 1, `users=${stats.totalUsers}`);

    // 仍可继续占用该用户配额：说明计数没被多减（多减会导致限额被虚假放大）
    sub(hub, 'tF', 'uF');
    check('F 计数未多减：用户配额仍按真实占用计算',
        hub._userCounts.get('uF') === 2, `uF=${hub._userCounts.get('uF')}`);
    hub.destroy();
}

// ─── G. close(channel) 正确回收计数 ──────────────────────────────────────
{
    const hub = newHub();
    sub(hub, 'tG', 'uG');
    sub(hub, 'tG', 'uG');
    sub(hub, 'tG2', 'uG2');
    check('G 初始 3 连接 / 2 用户', hub.getStats().totalConnections === 3 && hub.getStats().totalUsers === 2);

    hub.close('tG');
    const stats = hub.getStats();
    check('G close(channel) 后连接数正确', stats.totalConnections === 1, `total=${stats.totalConnections}`);
    check('G close(channel) 后用户计数被回收（初版会永久虚高）',
        stats.totalUsers === 1 && hub._userCounts.has('uG') === false, `users=${stats.totalUsers}`);
    hub.destroy();
}

// ─── H. 心跳跳过背压连接 ─────────────────────────────────────────────────
{
    const hub = newHub();
    const { res } = sub(hub, 'tH');
    res.overflow = true;
    hub.emit('tH', 'orch:step:status', { n: 1 });   // 进入背压
    const before = res.written.length;
    hub._broadcastHeartbeat();
    check('H 心跳不为背压中的连接继续堆数据', res.written.length === before,
        `written ${before} → ${res.written.length}`);

    res.overflow = false;
    res.emit('drain');
    hub._broadcastHeartbeat();
    check('H 恢复后心跳正常发送', res.written.length > before, `written=${res.written.length}`);
    hub.destroy();
}

// ─── I. res 'error' 事件被监听 ───────────────────────────────────────────
{
    const hub = newHub();
    const { res, connId } = sub(hub, 'tI');
    let threw = false;
    try {
        res.emit('error', new Error('模拟 socket 错误'));
    } catch {
        threw = true;
    }
    check('I res 上的 error 事件不会抛出（已注册监听）', threw === false);
    check('I error 后连接被清理', hub.getStats().totalConnections === 0,
        `total=${hub.getStats().totalConnections} connId=${connId}`);
    hub.destroy();
}

// ─── J. 持续背压超阈值 → 由清理任务断开 ──────────────────────────────────
{
    const hub = newHub({ maxBackpressureMs: 10 });
    const { res } = sub(hub, 'tJ');
    res.overflow = true;
    hub.emit('tJ', 'orch:step:status', { n: 1 });
    await new Promise((r) => setTimeout(r, 40));
    hub._cleanZombies();
    const stats = hub.getStats();
    check('J 持续背压超阈值 → 断开该连接', stats.totalConnections === 0,
        `total=${stats.totalConnections}`);
    check('J 计入 droppedConnections', stats.totalDroppedConnections === 1,
        `dropped=${stats.totalDroppedConnections}`);
    hub.destroy();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
