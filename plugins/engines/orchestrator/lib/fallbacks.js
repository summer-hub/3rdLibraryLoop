/**
 * fallbacks —— 本插件 7 个「未插件化的协作方」的统一无宿主兜底注册表
 *
 * ── 为什么是一个注册表，而不是 7 个 `xxxSource.js` ─────────────────────────
 * 前几片（brain / testcheck）每个协作方一个 `lib/xxxSource.js`，因为每个来源的
 * **解析顺序不同**：`llm` 是「门面类 → 宿主接缝」，`storage` 是「宿主接缝 → 门面
 * 惰性加载器」，`cli` 是「门面 → 宿主接缝」。本片（Orchestrator + FlexRunner）的
 * 7 个协作方里有 5 个是**同一种形状**：
 *
 *     显式注入 → [可选：宿主接缝] → 门面在 import 期登记的惰性加载器 → 抛错
 *
 * 把它们写成 7 份近乎相同的 resolver 文件，只会得到 7 份「幂等 + 先登记者优先 +
 * 点名报错」的复制粘贴，而任何一处文案改进都要改 7 遍。因此收成一个注册表：
 * 名字 + 加载器，其余语义（幂等、先登记者优先、同步取用、点名报错）只有一份实现。
 * 真正**形状不同**的两档留在调用点（那里才看得懂为什么顺序不同）：
 *   - `storage` / `engine-knowledge` / `app-logger`：**宿主接缝在前**（接缝是这条
 *     能力的正主，门面兜底只是无宿主时的旧路径）；
 *   - `cli-controller`：**门面在前、`ai-cli` 接缝在后**（照抄 Brain 的裁决：
 *     `ai-cli` 提供方是适配器工厂，而本插件的既有协作方是 `CLIController` 门面——
 *     门面独有的 type 闭集校验与 Session 调用计数适配器都不做）。
 *
 * ── 为什么兜底由 Server 侧门面登记，而不是插件自己 import ───────────────────
 * 架构守卫 R2 禁止插件引用 `Server/`，也禁止插件互相引用。`CLIController` /
 * `createStorage` / `McpToolGuide` 虽有对应门面，但门面本身就在 `Server/` 里；所以
 * 「无宿主时用什么」这条信息只能由 Server 侧在 import 期登记进来（与 brain / testcheck
 * 同一形状：装配层的事，不是能力层的事）。
 *
 * ── 其中三条已升级为「宿主接缝 → 门面兜底」（Agent 插件化那一波）──────────────
 * `role-limiter` / `multi-agent-runner` / `skill-selector` 曾经"尚未插件化、没有接缝可走"；现在
 * `plugins/agent/core` 提供 `agent-role-limiter` / `agent-multi-agent-runner` /
 * `agent-skill-selector`，因此这三条名字的解析顺序改为**四档**，与
 * `plugins/engines/testcheck/lib/skillSelectorSource.js` 的同一次升级同形：
 *
 *     显式注入（调用方 clear 掉本表 / 构造入参） → 宿主接缝 → 门面登记兜底 → 抛错
 *
 * 为什么接缝必须排在门面兜底**之前**：门面兜底背后是
 * `Server/Agent/Runtime/RoleLimiter.js` 与 `Server/Agent/Supervisor/MultiAgentRunner.js`，
 * 它们现在只是 `plugins/agent/core` 的转发门面 —— 第 3 档拿到的东西**必然**与第 2 档
 * 指向同一个类（`===`）。既然能力相同，正确顺序就是"装配层显式注册的提供方优先于
 * 装配层不便干预的内置回落"：宿主在时谁提供接缝就由谁决定实现（这是接缝存在的意义），
 * 宿主不在时才退回内置。顺序反过来会让接缝永远用不上。
 *
 * **三条**：`role-limiter` / `multi-agent-runner` 在 Orchestrator 侧，`skill-selector` 在
 * `FlexRunner` 侧（`FlexRunner` 的 SkillSelector 就是 `_loadSkillSelectorAgent()` 取的那条）。
 * 三者同属 `plugins/agent/core`，因此必须**一起**升级：同一个接缝若"某个消费者能命中、
 * 另一个命不中"，就会出现「有宿主时两处用不同实现」的静默分裂 —— 这正是接缝要消灭的东西。
 *
 * ── 为什么登记的是**加载器**而不是实现 ─────────────────────────────────────
 * 无宿主时仍要保持迁移前「第一次真正用到才 import」的时机：`@opencode-ai/sdk`、
 * `better-sqlite3`、SkillSelector 这批文件都不该进「只想 new 一个 Orchestrator」
 * 的模块图。唯一例外是 `role-limiter`：它的门面在 import 期就能拿到类（
 * `Server/Agent/Runtime/RoleLimiter.js` 只依赖 `plugins/agent/core/lib/LatencyRecorder.js`），
 * 而且 Orchestrator 有两处**同步**入口要用它（`getRoleLimiterStats()` /
 * `setRoleLimit()` 是模块级同步导出），所以那个加载器是**同步**的，由
 * `resolveFallbackSync()` 取。宿主接缝那一档天然同步（`resolveSeamProvider` 是纯查表），
 * 因此同步入口在**有宿主时**反而比无宿主时更宽松 —— 这是净收益，不是不一致。
 *
 * ── 为什么先登记者优先（`??=` 而不是覆盖）─────────────────────────────────
 * 门面在 import 期登记，宿主接缝（第 2 档）已经在调用点优先命中；此处若允许覆盖，
 * 宿主 dispose 之后仍指向一个已释放的宿主上下文，会把「无宿主」退化成「报错」。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** name → 加载器（`() => value | Promise<value>`） */
const _loaders = new Map();

/** name → 已解析的值（同步取用的唯一来源） */
const _resolved = new Map();

/**
 * 兜底名 → 宿主接缝名（**已插件化的那三条**）。
 *
 * 表中没有的名字一律跳过接缝档，直接走加载器 —— 这样"哪些名字升级过"是一份可读的
 * 清单，而不是散在两个函数里的 `if`。
 */
const FALLBACK_SEAMS = Object.freeze({
    'role-limiter': 'agent-role-limiter',
    'multi-agent-runner': 'agent-multi-agent-runner',
    'skill-selector': 'agent-skill-selector',
});

/**
 * 取宿主接缝提供的实现（不抛错）。
 *
 * 不缓存：宿主是**进程级可变状态**（`runInHostScope` 进出作用域、`dispose` 后消失），
 * 把它的提供方写进 `_resolved` 会让"宿主 dispose 之后仍用一个已释放的实现"。
 *
 * @param {string} name - 兜底名
 * @returns {unknown} 接缝提供方；无宿主 / 该名字未升级 / 宿主没注册该接缝时返回 `undefined`
 */
function _fromHost(name) {
    const seam = FALLBACK_SEAMS[name];
    if (!seam) return undefined;
    const provider = resolveSeamProvider(seam);
    return provider === null || provider === undefined ? undefined : provider;
}

/** 本插件认识的兜底名（报错文案据此提示拼写错误的可能） */
export const FALLBACK_NAMES = Object.freeze([
    'cli-controller',
    'skill-selector',
    'create-storage',
    'knowledge-manager',
    'mcp-tool-guide',
    'role-limiter',
    'multi-agent-runner',
]);

/**
 * 登记无宿主兜底（幂等：先登记者优先，重复登记不覆盖）。
 *
 * @param {string} name - 兜底名（见 `FALLBACK_NAMES`）
 * @param {() => (unknown | Promise<unknown>)} loader - 返回实现/类/工厂的加载器
 * @throws {TypeError} 名字为空或加载器不是函数
 */
export function registerFallback(name, loader) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('registerFallback(name, loader)：name 必须是非空字符串');
    }
    if (typeof loader !== 'function') {
        throw new TypeError(`registerFallback(${name}, loader)：loader 必须是函数`);
    }
    if (!_loaders.has(name)) _loaders.set(name, loader);
}

/**
 * 清空登记（**仅测试/热替换用**；正常部署不应调用）。
 * @param {string} [name] - 只清一个；省略则全部清空
 */
export function resetFallback(name) {
    if (name === undefined) {
        _loaders.clear();
        _resolved.clear();
        return;
    }
    _loaders.delete(name);
    _resolved.delete(name);
}

/** 该名字是否已登记（不触发加载）。 */
export function hasFallback(name) {
    return _loaders.has(name);
}

/**
 * 取一个兜底实现（异步）。
 *
 * 档位：宿主接缝（仅 `FALLBACK_SEAMS` 里列出的名字）→ 已登记的加载器 → 抛错。
 * 接缝档**不缓存**（宿主是进程级可变状态）；加载器档缓存（同一名字只加载一次）。
 *
 * @param {string} name - 兜底名
 * @returns {Promise<unknown>} 实现/类/工厂
 * @throws {Error} 未登记（点名 name + 三条修法）、或加载器产出空值
 */
export async function resolveFallback(name) {
    const fromHost = _fromHost(name);
    if (fromHost !== undefined) return fromHost;

    if (_resolved.has(name)) return _resolved.get(name);

    const loader = _loaders.get(name);
    if (typeof loader !== 'function') throw _missing(name);

    const value = await loader();
    if (value === null || value === undefined) throw _empty(name);
    _resolved.set(name, value);
    return value;
}

/**
 * 取一个兜底实现（同步）。
 *
 * 档位与 `resolveFallback()` 相同：宿主接缝 → 已登记的同步加载器 → 抛错。
 * 接缝档本身是同步的（`resolveSeamProvider` 纯查表），因此**有宿主时**同步入口不会
 * 因为"加载器是异步的"而失败 —— 这正是这一档升级带来的净收益。
 *
 * 加载器档只对**同步加载器**有效：`role-limiter` 是唯一需要它的名字（Orchestrator 的
 * `getRoleLimiterStats()` / `setRoleLimit()` 是同步导出）。异步加载器（`import()`）
 * 在这里不可等待，因此按「未就绪」处理并抛点名错误——绝不返回半成品。
 *
 * @param {string} name
 * @returns {unknown}
 * @throws {Error} 未登记 / 加载器是异步的 / 产出空值
 */
export function resolveFallbackSync(name) {
    const fromHost = _fromHost(name);
    if (fromHost !== undefined) return fromHost;

    if (_resolved.has(name)) return _resolved.get(name);

    const loader = _loaders.get(name);
    if (typeof loader !== 'function') throw _missing(name);

    const value = loader();
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
        // 异步加载器不能同步取用。挂一个空 catch，避免"抛错 + 未处理的 rejection"双报。
        value.catch(() => {});
        throw new Error(
            `engines/orchestrator：兜底 '${name}' 的加载器是异步的，无法同步取用。` +
                '同步入口（getRoleLimiterStats / setRoleLimit）要求同步加载器，' +
                '例如 registerFallback(\'role-limiter\', () => RoleLimiter)'
        );
    }
    if (value === null || value === undefined) throw _empty(name);
    _resolved.set(name, value);
    return value;
}

/**
 * 未登记的错误文案：点名缺哪个名字 + 该名字的接缝（若已升级）+ 三条修法。
 * @param {string} name
 * @returns {Error}
 */
function _missing(name) {
    const known = FALLBACK_NAMES.includes(name) ? '' : `（本插件认识的兜底名：${FALLBACK_NAMES.join(', ')}）`;
    const seam = FALLBACK_SEAMS[name];
    const seamHint = seam
        ? `既没有活跃插件宿主提供 '${seam}' 接缝，也没有登记无宿主兜底。请三选一：` +
          `加载提供该接缝的插件（plugins/agent/core，profile 里默认启用），`
        : '既没有活跃宿主的对应接缝，也没有登记无宿主兜底。请三选一：';
    return new Error(
        `engines/orchestrator：无法解析兜底 '${name}'${known} —— ` +
            seamHint +
            `从门面 Server/Orchestrator/index.js 或 Server/FlexRunner/index.js 导入（它们在 import 期登记内置实现），` +
            `或加载提供对应接缝的插件（storage / app-logger / engine-knowledge / ai-cli），` +
            `或按构造/方法入参显式注入（registerFallback('${name}', loader) 也可手工登记）`
    );
}

/**
 * 加载器产出空值的错误文案（区别于「没登记」：登记了但拿不到实现是另一个故障）。
 * @param {string} name
 * @returns {Error}
 */
function _empty(name) {
    return new Error(
        `engines/orchestrator：兜底 '${name}' 的加载器返回了空值（null/undefined）。` +
            '通常是门面登记时取错了导出名——请核对 Server 侧门面里 registerFallback 的加载器'
    );
}
