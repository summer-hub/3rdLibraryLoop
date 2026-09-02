import CLIController, { OpenCodeCLI } from './cli.js';

/**
 * CLIController 接口调用测试
 *
 * 使用真实运行的 CLI 服务逐个调用 CLIController 暴露的全部接口，
 * 模拟真实使用流程：
 *
 *   checkHealth → listSessions → startSession → sendMessage →
 *   checkSessionStatus → getSessionMessages → getSession →
 *   getArchivedMessages → getArchiveMeta → listArchivedSessions →
 *   abortSession → deleteSession → getType / getAdapter
 *
 * 默认连接 opencode 服务（localhost:4096），可通过环境变量切换：
 *
 *   CLI_TYPE=deveco-code node test.js
 *
 * deveco-code 服务需先启动：deveco serve（默认 4096，与 opencode 一致）
 */

const SEP = '═'.repeat(72);
const SUB = '─'.repeat(72);

/** 格式化输出标题 */
function header(title) {
    console.log(`\n${SEP}\n  ${title}\n${SEP}`);
}

/** 格式化输出子标题 */
function sub(title) {
    console.log(`\n── ${title} ──────────────────────────────────────────`);
}

/** 安全地 JSON 序列化（处理 BigInt / 循环引用） */
function safeStringify(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    }, indent);
}

/** 打印结果 */
function printResult(label, result) {
    console.log(`\n✅ ${label}`);
    console.log(safeStringify(result));
}

/** 打印错误 */
function printError(label, err) {
    console.log(`\n❌ ${label}`);
    console.error(err);
}

/**
 * 等待 opencode session 完成（轮询 checkSessionStatus）
 * @param {CLIController} cli
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {number} [opts.maxWaitMs=60000]   - 最大等待时长
 * @param {number} [opts.intervalMs=2000]   - 轮询间隔
 * @param {(status:string)=>boolean} [opts.isDone] - 自定义完成判断
 */
async function waitForStatus(cli, sessionId, opts = {}) {
    const maxWaitMs = opts.maxWaitMs ?? 60_000;
    const intervalMs = opts.intervalMs ?? 2000;
    const isDone = opts.isDone ?? (s => s === 'completed' || s === 'error' || s === 'unknown');
    const start = Date.now();
    let lastStatus = 'unknown';

    while (Date.now() - start < maxWaitMs) {
        const status = await cli.checkSessionStatus(sessionId).catch(e => {
            console.warn(`  ⚠️ 轮询失败: ${e.message}`);
            return { status: 'unknown' };
        });
        lastStatus = status.status;
        if (isDone(lastStatus)) return status;
        await sleep(intervalMs);
    }
    console.warn(`  ⚠️ 等待超时 (${maxWaitMs}ms)，最后状态: ${lastStatus}`);
    return { status: lastStatus };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    header('CLIController 接口调用测试');

    // ─── 创建 CLIController 实例 ───────────────────────────────────────────
    // CLI 类型与连接配置可由环境变量覆盖（CLI_TYPE / CLI_HOST / CLI_PORT）
    const cliType = process.env.CLI_TYPE || 'opencode';
    const cliHost = process.env.CLI_HOST || 'localhost';
    const cliPort = process.env.CLI_PORT || '4096';
    sub(`1. 创建 CLIController (${cliType})`);

    const cli = new CLIController(cliType, {
        host: cliHost,
        port: cliPort
    });

    // ─── checkHealth ──────────────────────────────────────────────────────
    sub('2. checkHealth()');

    const health = await cli.checkHealth();
    if (health.status !== 'ok') {
        console.error(`\n🛑 ${cliType} 服务不可用，终止测试`);
        process.exit(1);
    }

    // ─── listSessions (已有列表) ──────────────────────────────────────────
    sub('3. listSessions()');

    const sessionsBefore = await cli.listSessions();

    // ─── startSession (带初始 prompt) ─────────────────────────────────────
    sub('4. startSession(title, prompt)');

    const title = `测试 Session ${new Date().toLocaleString('zh-CN')}`;
    const prompt = '请用一句话介绍你自己。';
    const startResult = await cli.startSession(title, prompt);

    const sessionId = startResult.sessionId;

    // ─── checkSessionStatus (等待初始 prompt 完成) ────────────────────────
    sub('5. checkSessionStatus() — 等待初始 prompt 完成');

    const status1 = await waitForStatus(cli, sessionId, {
        maxWaitMs: 90_000,
        intervalMs: 3000
    });

    // ─── sendMessage ──────────────────────────────────────────────────────
    sub('6. sendMessage(sessionId, message)');

    const followUp = '请再说一句关于天气的话。';
    const sendResult = await cli.sendMessage(sessionId, followUp);

    // ─── injectPrompt (注入上下文，不触发 AI 响应) ───────────────────────
    sub('6a. injectPrompt(sessionId, message) — 注入上下文');

    const injectText = '【补充规则】后续回复请始终以"好的，"开头。';
    try {
        const injectResult = await cli.injectPrompt(sessionId, injectText);
        printResult('injectPrompt', injectResult);
    } catch (err) {
        printError('injectPrompt', err);
    }

    // ─── getLiveMessages (对话运行中实时查看) ─────────────────────────────
    sub('6b. getLiveMessages(sessionId) — 对话运行中实时查看');

    // sendMessage 刚发出，opencode 正在生成回复，此时 getLiveMessages 应能看到已有消息
    const liveMsgs = await cli.getLiveMessages(sessionId);

    console.log(`\n  实时消息 (${liveMsgs.length} 条)`);
    for (const msg of liveMsgs) {
        console.log(`  [${msg.role}] ${msg.content}`);
    }

    // ─── checkSessionStatus (等待跟进消息完成) ─────────────────────────────
    sub('7. checkSessionStatus() — 等待跟进消息完成');

    const status2 = await waitForStatus(cli, sessionId, {
        maxWaitMs: 90_000,
        intervalMs: 3000
    });

    // ─── sendAndWaitMessage (同步等待 AI 回复) ───────────────────────────
    sub('7a. sendAndWaitMessage(sessionId, message) — 同步等待 AI 回复');

    const syncQuestion = '请用一句话介绍鸿蒙系统。';
    try {
        const syncResult = await cli.sendAndWaitMessage(sessionId, syncQuestion);
        console.log(`\n  ✅ AI 回复 (同步等待):`);
        console.log(`  ${syncResult.content}`);
        console.log(`  finish: ${syncResult.response?.info?.finish ?? 'N/A'}`);
    } catch (err) {
        printError('sendAndWaitMessage', err);
    }

    // ─── getSessionMessages ───────────────────────────────────────────────
    sub('8. getSessionMessages(sessionId)');

    const messages = await cli.getSessionMessages(sessionId);

    // ─── getSession ───────────────────────────────────────────────────────
    sub('9. getSession(sessionId)');

    const sessionInfo = await cli.getSession(sessionId);

    // ─── getArchivedMessages ──────────────────────────────────────────────
    sub('10. getArchivedMessages(sessionId)');

    const archived = await cli.getArchivedMessages(sessionId);

    // ─── getArchiveMeta ───────────────────────────────────────────────────
    sub('11. getArchiveMeta(sessionId)');

    const meta = await cli.getArchiveMeta(sessionId);

    // ─── exportSession (JSON 格式) ──────────────────────────────────────
    sub('11b. exportSession(sessionId, { format: "json" })');

    const exportedJson = await cli.exportSession(sessionId, { format: 'json' });
    printResult(`导出对话 JSON (${exportedJson.messages.length} 条消息)`, exportedJson);

    // ─── exportSession (Markdown 格式) ───────────────────────────────────
    sub('11c. exportSession(sessionId, { format: "markdown" })');

    const exportedMd = await cli.exportSession(sessionId, { format: 'markdown' });;

    // ─── listArchivedSessions ─────────────────────────────────────────────
    sub('12. listArchivedSessions()');

    const archivedSessions = await cli.listArchivedSessions();

    // ─── abortSession ─────────────────────────────────────────────────────
    sub('13. abortSession(sessionId)');

    const abortResult = await cli.abortSession(sessionId);

    // // ─── deleteSession ────────────────────────────────────────────────────
    // sub('14. deleteSession(sessionId)');

    // const deleteResult = await cli.deleteSession(sessionId);
    // printResult('删除 Session 结果', deleteResult);

    // // ─── listSessions (删除后确认) ────────────────────────────────────────
    // sub('15. listSessions() — 删除后确认');

    // const sessionsAfter = await cli.listSessions();
    // printResult(`删除后 Session 列表 (${sessionsAfter.length} 个)`, sessionsAfter);

    // const stillExists = sessionsAfter.some(s => s.id === sessionId);
    // console.log(`\n  ${stillExists ? '⚠️ Session 仍存在' : '✅ Session 已成功删除'}`);

    // ─── 不支持的类型 ───────────────────────────────────────────────────────
    sub('14. 不支持的 CLI 类型');

    try {
        new CLIController('unknown-type');
        console.log('  ⚠️ 未抛出异常');
    } catch (err) {
        printResult('预期异常捕获', { message: err.message });
    }

    // ─── 完成 ─────────────────────────────────────────────────────────────
    header('✅ 全部接口调用完成');
}

main().catch(err => {
    console.error('\n🛑 测试执行失败:', err);
    process.exit(1);
});


