#!/usr/bin/env node
/**
 * 3rdloop.mjs —— 3rdLibraryLoop CLI 入口
 *
 * 职责：
 *   - 解析 argv（自研轻量解析，无第三方依赖）
 *   - 命令分发到 lib/ 下各子命令实现
 *
 * 命令总览（v1）：
 *   3rdloop run [taskDescription]     提交并阻塞到终态（submit + wait 组合）
 *   3rdloop submit [taskDescription]  提交任务，返回 taskId 后立即退出
 *   3rdloop wait <taskId>             等待任务到终态（可 --timeout）
 *   3rdloop progress <taskId>         查询进度（--json 输出结构化状态）
 *   3rdloop abort <taskId>            中止任务
 *   3rdloop list                      列出任务（--status / --limit / --older-than）
 *   3rdloop result <taskId>           读取最终结果（--json / --raw）
 *   3rdloop doctor                    环境自检
 *   3rdloop version                   版本信息
 *
 * 全局选项：
 *   --json        数据走 stdout（结构化），进度/日志走 stderr
 *   -v/--verbose  详细模式
 *   --quiet       仅输出最终结果
 *   --data-dir    数据目录覆盖
 *   --project     项目名覆盖（默认 git 仓库根名）
 *   --skill-dir   SKILL 目录覆盖
 *   --help/-h     帮助
 *
 * 退出码：
 *   0   通过 / 成功
 *   1   错误（参数错误 / 环境不满足 / 任务不存在）
 *   2   任务执行失败（终态为 failed/error）
 *   3   wait 超时
 *   130 用户按 Ctrl+C（SIGINT）
 *   143 SIGTERM
 */

import { runCli } from '../lib/cli.js';
import { closeAllRunContexts } from '../lib/lifecycle.js';

// 顶层 try：任何未捕获异常统一转换退出码 1，避免 Node 打印堆栈噪声。
// finally 是**唯一**的收口点：关掉本进程创建的 RunContext（storage 连接 + 宿主引用计数）。
// 命令模块里有多处早退（ai serve 起不来、端口占用……），逐点写 finally 必然漏；而 CLI 是
// "一进程一命令"，所以出口统一收口与"命令结束时收口"语义等价、覆盖更完整。
// 清理失败只告警，不改变已确定的退出码。
let exitCode = 0;
try {
    exitCode = (await runCli(process.argv.slice(2))) ?? 0;
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`\n[3rdloop] 致命错误: ${message}\n`);
    exitCode = 1;
} finally {
    try {
        await closeAllRunContexts();
    } catch (err) {
        process.stderr.write(`[3rdloop] 关闭运行上下文失败: ${err?.message ?? err}\n`);
    }
}
process.exit(exitCode);