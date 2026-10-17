/**
 * cli/lib/lifecycle.js —— 进程级 RunContext 登记表（CLI 出口统一收口）
 *
 * 为什么需要它：`RunContext.close()` 负责关掉 storage（SQLite 连接等）并释放本上下文持有的
 * 插件宿主引用，但**命令入口从来没人调用它**——资源只是靠进程退出被操作系统回收。改造前
 * storage 也是如此，插件化之后又多了一份要回收的东西（宿主 + 引用计数），继续依赖进程退出
 * 就变成了"看起来能用、实际从未验证过清理路径"。
 *
 * 为什么不在 9 个创建点各自包 `try/finally`：
 *   1. 创建点分散在 4 个文件（cli/step/orch/workflow），且多处在 `try` **之前**就有早退
 *      （例如 `step.js` 在 `ai serve` 起不来时直接 `return EXIT.ERROR`）——逐点包裹既容易漏，
 *      也会把大段命令逻辑重新缩进一遍；
 *   2. CLI 是**一进程一命令**：命令结束 === 进程结束，所以"出口统一关闭"与"命令结束时关闭"
 *      在语义上等价，而覆盖更完整（新增命令入口不必再记得写 finally）。
 *
 * 为什么单独一个模块、且不 import 任何东西：
 *   `cli/bin/3rdloop.mjs` 要静态引入它。runner.js 会牵出 config.js（`.env` 链），而 bin 的
 *   顶层必须保持"先加载环境、再加载核心引擎"的次序，所以这里刻意做到零依赖。
 *
 * 幂等性：`RunContext.close()` 自身幂等（`_closed` 守卫），本表只是去重与统一遍历。
 */

/** 本进程创建过、尚未关闭的 RunContext */
const _live = new Set();

/**
 * 登记一个 RunContext（由 `createRunContext()` 调用，业务代码不需要直接用）。
 * @param {object} ctx
 */
export function registerRunContext(ctx) {
    _live.add(ctx);
}

/**
 * 注销一个 RunContext（由 `RunContext.close()` 调用）。
 * @param {object} ctx
 */
export function unregisterRunContext(ctx) {
    _live.delete(ctx);
}

/** 当前仍在册的上下文数量（测试/诊断用） */
export function liveRunContextCount() {
    return _live.size;
}

/**
 * 关闭本进程创建的全部 RunContext。
 *
 * 每个上下文独立 try/catch：一个关不掉不该阻止其它上下文清理。
 * 返回统计而不是抛错——清理失败不该把一条已成功的命令变成失败退出码。
 *
 * @returns {Promise<{closed:number, failed:number, failures:Error[]}>}
 */
export async function closeAllRunContexts() {
    const all = [..._live];
    _live.clear();
    const failures = [];
    for (const ctx of all) {
        try {
            await ctx.close();
        } catch (err) {
            failures.push(err);
            process.stderr.write(`[3rdloop] 关闭运行上下文失败: ${err?.message ?? err}\n`);
        }
    }
    return { closed: all.length - failures.length, failed: failures.length, failures };
}
