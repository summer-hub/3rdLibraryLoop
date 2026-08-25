#!/usr/bin/env node
/**
 * loop.mjs —— 3rdLibraryLoop CLI 入口
 *
 * 职责：
 *   - 解析 argv（自研轻量解析，无第三方依赖）
 *   - 命令分发到 lib/ 下各子命令实现
 *
 * 命令总览（v1）：
 *   loop run [taskDescription]     提交并阻塞到终态（submit + wait 组合）
 *   loop submit [taskDescription]  提交任务，返回 taskId 后立即退出
 *   loop wait <taskId>             等待任务到终态（可 --timeout）
 *   loop progress <taskId>         查询进度（--json 输出结构化状态）
 *   loop abort <taskId>            中止任务
 *   loop list                      列出任务（--status / --limit / --older-than）
 *   loop result <taskId>           读取最终结果（--json / --raw）
 *   loop doctor                    环境自检
 *   loop version                   版本信息
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

// 顶层 try：任何未捕获异常统一转换退出码 1，避免 Node 打印堆栈噪声
try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exit(exitCode ?? 0);
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`\n[loop] 致命错误: ${message}\n`);
    process.exit(1);
}