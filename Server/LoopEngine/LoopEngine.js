/**
 * Server/LoopEngine/LoopEngine.js —— 转发门面（实现已迁入 `plugins/engines/loopengine/`）
 *
 * 为什么留这一层：`Server/**` 侧唯一消费者（`Server/Routes/controllers/LoopEngineController.js`）、
 * `cli/lib/runner.js`（经 vendor 路径）与既有测试（m3 的 F-22/F-24 套件）都按老路径
 * import 这个文件/它的 `index.js`。插件化不该顺手改掉它们的 import。架构守卫只禁止
 * 「插件 → Server」方向，「Server → 插件」是允许的（与 `Server/Brain/Brain.js`、
 * `Server/TestCheck/TestCheck.js`、`Server/Orchestrator/Orchestrator.js` 同一形状）。
 *
 * 导出面前后逐名一致：`LoopEngine` / `LoopStatus` / `ABORTED_ERROR` + `default`，
 * 且**就是插件里那几个绑定**（`===`），不存在第二份实现——否则 `LoopStatus` 与
 * `CheckStatus` 的常量比较会分属两个对象，全部失效。
 *
 * ── 本文件不只是转发：它登记三条无宿主兜底 ───────────────────────────────────
 * 迁移前这三条是 `LoopEngine.js` 里的「1 条静态 import + 2 处运行时自建」，插件不得
 * 引用 `Server/`（架构守卫 R2），于是统一改成"门面登记 → 插件首次使用时调用"
 * （见 `plugins/engines/loopengine/lib/*Source.js`）：
 *
 *   1. `engine-testcheck`（`() => TestCheck`，**类**，取自**插件入口**
 *      `plugins/engines/testcheck/index.js` 的绑定）：
 *      迁移前 `_getTestCheck()` 里 `new TestCheck({...})`，静态 import `../TestCheck/index.js`。
 *      为什么取插件入口而不是实现文件：契约 `constants: ['CheckStatus']` 声明的冻结常量表
 *      是**插件入口**挂到类上的（`TestCheck.CheckStatus = CheckStatus`），实现文件单独被
 *      import 时没有那次赋值 —— 无宿主部署下会拿到一个没有常量表的类。这个文件与
 *      `../../plugins/engines/testcheck/TestCheck.js` 导出的是**同一个类对象**（`===`）。
 *      另有一条副作用 import 指向 `../TestCheck/index.js`，保留迁移前的模块图
 *      （让 testcheck 自己的四条兜底登记也就位）。
 *   2. `create-storage`（`() => createStorage`，**同步**加载器）：
 *      迁移前构造函数里 `this.storage = deps.storage || createStorage()`，静态 import
 *      `../DbUse/index.js`。插件的 `storage` 是**同步惰性 getter**（`Server/Routes` 里有
 *      一条构造后同步读 `engine.storage` 的兜底路径，不能改成 await），所以这里登记的
 *      必须是**同步**加载器——`() => createStorage`，加载时机与迁移前一致。
 *   3. `cli-controller`（`async () => (await import('../CLI/cli.js')).CLIController`）：
 *      迁移前 `_abortSessions()` 里是**惰性**动态 import（只有真要远程中止 session 时才
 *      加载），这里登记成惰性加载器，时机与迁移前逐字等价，也不会把 `@opencode-ai/sdk`
 *      拖进"只想 new 一个 LoopEngine"的模块图。`CLIController` 自己会按
 *      `resolveAiCliFactory(type)` 解析 `ai-cli` 接缝，所以**有宿主时这条路径照样走接缝**。
 *
 * ⚠️ 没有第 4 条 `engine-brain` 兜底：迁移前 `LoopEngine.js` 顶上那条
 *    `import { Brain, BrainStatus } from '../Brain/index.js'` 是**死 import**（全文件除该行
 *    外对两个符号零引用），插件里已删除，没有 resolver 会去取 `engine-brain`。
 *    凭空登记一条没人读的兜底是死代码，且会让人误以为"大循环自己会 new 一个 Brain"。
 *
 * 登记点是**本文件**（而不是 `index.js`）：`index.js` 的每一次转发都经过这里，
 * 所以「直接 import `LoopEngine/LoopEngine.js`」与「import `LoopEngine/index.js`」
 * 两条路径都必经本文件（`grep` 确认：仓库内两种写法都存在过，套件用的是后者）。
 */

import { createStorage } from '../DbUse/index.js';
// 副作用 import：保留迁移前本文件对 `../TestCheck/index.js` 的那条静态边。它让 testcheck
// 插件自己的四条无宿主兜底（llm / storage / cli / skillSelector，登记在
// `Server/TestCheck/TestCheck.js`）在任何"只 import 了 LoopEngine 门面"的部署形态下也就位
// ——本插件在 `deps.testCheck` 缺席时会自己 `new` 一个 TestCheck 实例，那时那些兜底必须
// 已经在（与 `Server/Orchestrator/Orchestrator.js` 保留 FlexRunner 那条边的理由同源）。
import '../TestCheck/index.js';
// 兜底登记的是**插件入口**的绑定，不是实现文件 `TestCheck.js` 的绑定：两者是**同一个类**
// （入口 `export … from './TestCheck.js'`），但只有入口那次模块求值会执行
// `TestCheck.CheckStatus = CheckStatus`（契约 `constants: ['CheckStatus']` 的那张冻结常量表）。
// 若这里指向实现文件，无宿主部署下消费者会拿到一个"没有 CheckStatus 的类"，
// 于是 fail closed —— 那不是契约违约，而是登记点选错了文件。
import { TestCheck } from '../../plugins/engines/testcheck/index.js';
import { setCliFallback } from '../../plugins/engines/loopengine/lib/cliSource.js';
import { setStorageFallback } from '../../plugins/engines/loopengine/lib/storageSource.js';
import { setTestCheckFallback } from '../../plugins/engines/loopengine/lib/testcheckSource.js';

// 幂等（先登记者优先）：重复 import 不会覆盖已登记的实现
setTestCheckFallback(() => TestCheck);
setStorageFallback(() => createStorage);
setCliFallback(async () => (await import('../CLI/cli.js')).CLIController);

export { LoopEngine, LoopStatus, ABORTED_ERROR } from '../../plugins/engines/loopengine/LoopEngine.js';
export { default } from '../../plugins/engines/loopengine/LoopEngine.js';
