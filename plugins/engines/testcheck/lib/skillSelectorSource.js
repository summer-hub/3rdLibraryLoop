/**
 * skillSelectorSource —— 本插件解析 SkillSelector Agent 的唯一入口（接缝优先，门面兜底）
 *
 * 为什么需要这一层：迁移前 `TestCheck._loadSkillSelectorAgent()` 直接
 * `await import('../Agent/SkillSelector/index.js')` 取 `Agent` 再 `new`。插件不得引用
 * `Server/`（架构守卫 R2），这条运行期自建必须换成解析器。
 *
 * ── 本片（Agent 插件化）之后的档位：四档 ────────────────────────────────────
 *
 *   1. 调用方显式注入（`new TestCheck({ skillSelector })`）—— 永远最优先；
 *   2. **活跃宿主的 `agent-skill-selector` 接缝** —— `resolveSeamProvider()` 命中就直接
 *      `new Agent()`。这是本片新加的一档，也是"一切即插件"的目标形态：消费者只认契约，
 *      提供方换成任何实现都不改本文件；
 *   3. `Server/TestCheck/TestCheck.js` 门面在 import 期登记的内置兜底
 *      （`async () => (await import('../Agent/SkillSelector/index.js')).Agent`）。保留它
 *      有两种真实形态要用：**无宿主**（默认部署形态里的嵌入式/脚本场景），以及
 *      **宿主没启用 `agent/core`**（某个 profile 只装引擎不装 Agent）。登记**加载器**而不是
 *      类，保持"第一次真正匹配 SKILL 才加载"的时机；
 *   4. 三档都没有 → fail closed，文案点名缺哪条接缝、哪个登记函数、哪三条修法。
 *
 * ── 为什么"接缝"排"门面兜底"之前 ────────────────────────────────────────────
 * 门面兜底背后是 `Server/Agent/SkillSelector/index.js`，它现在只是
 * `plugins/agent/core` 的转发门面 —— 也就是说第 3 档拿到的东西**必然**与第 2 档指向同一
 * 个类（`===`）。既然两者能力相同，正确的优先顺序就是"装配层显式注册的提供方优先于
 * 装配层不便干预的内置回落"：宿主在时，谁提供 `agent-skill-selector` 就由谁决定实现
 * （这正是接缝存在的意义）；宿主不在时才退回内置。顺序反过来会让接缝永远用不上。
 *
 * ⚠️ 与 `lib/{llm,storage,cli}Source.js` 的一处差别：那三条的接缝提供的是**工厂/类**，
 * 而本文件要的是**实例**（`TestCheck.skillSelector.selectSkill(...)`），所以第 2/3 档都
 * 需要 `new`。`Agent` 的构造函数在无协作方时也不抛（LLM 解析推迟到首次 `selectSkill()`），
 * 因此"构造成功但首次使用才报错"是这条链的既定语义。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** 本插件依赖的接缝名（报错文案与探针共用一份，避免两处写歪） */
export const SKILL_SELECTOR_SEAM = 'agent-skill-selector';

/** 无宿主兜底：`() => Agent | Promise<Agent>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：宿主接缝在第 2 档已经优先命中；这里若允许覆盖，
 * 宿主 dispose 之后仍指向一个已释放的宿主上下文，会把「无宿主」退化成「报错」。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 SkillSelector Agent 类的加载器
 * @throws {TypeError} loader 不是函数时
 */
export function setSkillSelectorFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setSkillSelectorFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetSkillSelectorFallback() {
    _fallbackLoader = null;
}

/** @returns {boolean} 是否已登记无宿主兜底（不触发加载） */
export function hasSkillSelectorFallback() {
    return typeof _fallbackLoader === 'function';
}

/**
 * 解析一个可用的 SkillSelector Agent **实例**。
 *
 * @param {object|null} [explicit=null] - 显式注入的实例（`deps.skillSelector`）
 * @returns {Promise<object>} 具备 `selectSkill(taskDescription, skillDirectory)` 的对象
 * @throws {Error} 四档都解析不到时
 */
export async function resolveSkillSelector(explicit = null) {
    if (explicit) return explicit;

    // 第 2 档：活跃宿主的接缝（作用域宿主优先于默认宿主，见 core/hostBridge.js）
    const fromHost = resolveSeamProvider(SKILL_SELECTOR_SEAM);
    if (typeof fromHost === 'function') return new fromHost();
    if (fromHost !== null && fromHost !== undefined) return fromHost;

    // 第 3 档：门面登记的内置兜底（无宿主 / 宿主没启用 agent/core）
    if (typeof _fallbackLoader === 'function') {
        const Agent = await _fallbackLoader();
        if (typeof Agent === 'function') return new Agent();
    }

    throw new Error(
        'engines/testcheck：无法解析 SkillSelector Agent —— 既没有活跃插件宿主的 '
            + `'${SKILL_SELECTOR_SEAM}' 接缝，也没有登记无宿主兜底。请三选一：`
            + '加载提供该接缝的插件（plugins/agent/core，profile 里默认启用），'
            + '或从门面 Server/TestCheck/TestCheck.js 导入（它会在 import 期登记内置实现），'
            + '或显式注入 new TestCheck({ skillSelector })'
    );
}
