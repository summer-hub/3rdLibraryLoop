/**
 * appHost —— 应用级插件宿主的创建，以及「在临时宿主作用域内跑一段工作」的包装
 *
 * 与 hostBridge 的分工：
 *   appHost 负责「把宿主装起来」（createDefaultHost → load）并在作用域内交给 fn，
 *   hostBridge 负责「让深处的消费者看见这个宿主」（作用域宿主优先，默认宿主垫底）。
 *
 * 作用域包装刻意用 runInHostScope（AsyncLocalStorage）而不是全局 setActiveHost：
 * 全局状态在多宿主并发时会互相覆盖，详见 hostBridge 头部的三态模型说明。
 *
 * 本文件只提供能力，**不接入默认路径**：buildApp / server.js / cli/lib/runner.js
 * 仍然不加载宿主，因此默认部署形态下 Agent / Brain / TestCheck 依旧 `new LLMClient()`。
 * 切换到「宿主提供 LLM」是后续阶段的事，届时由入口显式调用 withAppHost。
 *
 * 注意：本文件 import 仓库根的 core/，而 cli 发布态只复制 Server/ 到 cli/vendor/，
 * 所以本文件不允许被 cli/lib/runner.js 的默认路径静态依赖（现状也确实没有）。
 */

import { createDefaultHost } from '../../core/index.js';
import { clearActiveHost, runInHostScope, setActiveHost } from './hostBridge.js';

/**
 * 创建并加载一个插件宿主。
 *
 * @param {object} [options]
 * @param {string|object} [options.profile] - profile 名（默认内核默认 profile）或已解析的 profile 对象
 * @param {string[]} [options.roots]        - 插件根目录；不传＝内核默认（仓库 plugins/ + ~/.3lib/plugins）
 * @param {NodeJS.ProcessEnv} [options.env] - 环境变量来源（测试可注入）；不传＝process.env
 * @param {(msg: string) => void} [options.logger] - 日志回调
 * @returns {Promise<import('../../core/PluginHost.js').PluginHost>} 已 load 的宿主（调用方负责 dispose）
 */
export async function createAppHost({ profile, roots, env, logger } = {}) {
    // 传 undefined 即「用内核默认值」：插件根不在此处硬编码。
    const host = createDefaultHost({ roots, env, logger });
    await host.load({ profile });
    return host;
}

/**
 * 在一个临时的**宿主作用域**内执行 fn：
 * 加载 → runInHostScope(host, fn) → finally dispose。
 *
 * 与前一代实现的差别（重要）：这里**不再** setActiveHost / clearActiveHost 全局状态。
 * 全局状态是进程级单例，两个 withAppHost 并发（并行测试、多任务宿主）会互相覆盖，
 * 而且「谁在退出时把别人的宿主清掉」取决于完成顺序——串味且不可诊断。作用域宿主
 * 挂在调用链上（AsyncLocalStorage），并发互不可见，退出即自动失效，无需清理。
 *
 * 作用域只包住 fn（含其 await 链），dispose 在作用域之外执行：宿主已回收之后不该
 * 再有任何消费者能解析到它。
 *
 * 供 CLI / 服务端 / 测试使用；退出作用域后桥回到外层状态（外层作用域宿主或默认宿主，
 * 都没有就是「没有宿主」），消费者行为复位。
 *
 * @template T
 * @param {object} [options] - 同 createAppHost
 * @param {(host: object) => T|Promise<T>} fn - 宿主激活期间要执行的工作
 * @returns {Promise<T>} fn 的返回值
 */
export async function withAppHost({ profile, roots, env, logger } = {}, fn) {
    if (typeof fn !== 'function') throw new TypeError('withAppHost(options, fn): fn 必须是函数');

    const host = await createAppHost({ profile, roots, env, logger });
    try {
        return await runInHostScope(host, () => fn(host));
    } finally {
        await host.dispose();
    }
}

/**
 * **应用级**激活：装配宿主并把它设为「进程默认宿主」，返回 `{ host, shutdown }`。
 *
 * 与 withAppHost 的分工：
 *   - `withAppHost` 是**短生命周期 / 作用域隔离**用法（测试、一次性任务）：进出作用域，
 *     并发互不可见，不碰进程默认宿主；
 *   - `activateAppHost` 是**长生命周期入口**用法（HTTP 服务、CLI 命令上下文）：把宿主设为
 *     默认宿主，让深处那些「没有构造注入通道」的消费者（Agent / Brain / TestCheck）
 *     也能解析到它，直到入口自己调用 `shutdown()`。一个进程只应有一个应用级宿主。
 *
 * 重复激活是**响亮的失败**：进程内已存在另一个不同的默认宿主时，`setActiveHost` 的
 * 覆盖守卫会抛错（多宿主并存请用 `runInHostScope`）。这正是我们要的语义——静默覆盖会
 * 让先激活者的消费者在下一个 await 之后突然用上别人的实现。
 *
 * `shutdown()` 顺序固定且幂等：
 *   ① `clearActiveHost()` —— 先摘桥，之后任何解析都回落到内置实现；
 *   ② `await host.dispose()` —— 再回收插件（dispose 结束时宿主 root 已置 null，若顺序
 *      反过来，期间仍在解析的代码会撞上「PluginHost 尚未 load」这种与停机无关的错误）。
 *
 * @param {object} [options] - 同 createAppHost（profile / roots / env / logger）
 * @returns {Promise<{host: object, shutdown: () => Promise<void>}>}
 * @throws {Error} 宿主 load 失败；或进程内已存在另一个不同的默认宿主
 */
export async function activateAppHost(options = {}) {
    const host = await createAppHost(options);

    try {
        setActiveHost(host);
    } catch (err) {
        // 覆盖守卫拒绝：刚 load 的宿主不能留在进程里（已占用插件资源与静态钩子）
        try {
            await host.dispose();
        } catch { /* 忽略：原始守卫错误更重要 */ }
        throw err;
    }

    let done = false;
    const shutdown = async () => {
        if (done) return;
        done = true;
        clearActiveHost();
        await host.dispose();
    };

    return { host, shutdown };
}
