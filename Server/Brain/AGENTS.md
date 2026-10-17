# Brain —— 自然语言任务拆解引擎（门面层）

> ⚠️ **实现已整体迁入插件 `plugins/engines/brain/`**（6 个文件 / 1966 行原样搬走，业务逻辑
> 逐行不变；另有无状态依赖 `nowCST` 归一到内核 `core/cstTime.js`，`BoundedRegistry` 以插件内副本
> 落地 + 三个解析器）。本目录**全部是转发门面**，
> 零业务逻辑；`Server/**` 侧消费者与既有测试按老路径 import，插件化不该顺手改掉它们。
> 这是「引擎插件化」的第二片（第一片是 `Server/Knowledge/`，形状照抄它）。

## 职责（迁移前后不变）

Brain 是 AI Loop 系统的"大脑"层：把自然语言任务描述经 AI SKILL（opencode CLI）或 LLM
fallback 拆解为 Orchestrator 可执行的结构化任务 JSON。

```
自然语言任务 → Brain（拆解）→ Orchestrator（编排）→ FlexRunner（执行）
```

工作流程：**ANALYZING**（分析意图 + 生成验收标准）→ **PLANNING**（拆出步骤图）→
**VALIDATING**（校验 stepId 唯一/依赖存在/入口/终止）→ **COMPLETED**（产出 BrainPlan）。

## 目录结构

```
plugins/engines/brain/                # ← 实现实体 + 插件入口
├── plugin.json                       # 清单：name=engines/brain, seam=engine-brain, dependencies=[]
├── index.js                          # definePlugin 入口：ctx.provide('engine-brain', Brain)
├── Brain.js                          # 编排层（状态管理/流程协调/校验/组装），原样迁入
├── SkillExecutor.js                  # CLI SKILL 执行引擎（健康检查/Session/轮询/结果读取）
├── AnalysisStrategies.js             # 任务分析策略（CLI 优先 + LLM fallback）
├── DecompositionStrategies.js        # 任务拆解策略（CLI 优先 + LLM fallback）
├── PlanPersistence.js                # 计划持久化与历史加载
└── lib/                              # 插件内副本 / 解析器（插件不得引用 Server/，也不得跨插件 import）
    ├── BoundedRegistry.js            # ← Server/library/BoundedRegistry.js（零依赖容器，副本 #2）
    ├── storageSource.js              # createStorage 解析：宿主 storage 接缝 → 门面登记兜底 → fail closed
    ├── llmSource.js                  # LLM 客户端解析：宿主 llm 接缝 → 门面登记兜底 → fail closed
    └── cliSource.js                  # CLI 协作方解析：门面登记 CLIController → 宿主 ai-cli 接缝 → fail closed

Server/Brain/                         # ← 门面层：路径与导出面与迁移前逐名一致
├── index.js                          # 转发 Brain / BrainStatus / default
├── Brain.js                          # 转发 Brain / BrainStatus / default + **登记 llm/storage 无宿主兜底**
├── SkillExecutor.js                  # 转发 SkillExecutor 等 5 个绑定 + **登记 cli 无宿主兜底**
├── AnalysisStrategies.js             # 纯转发（协作者由 Brain 注入）
├── DecompositionStrategies.js        # 纯转发（同上）
└── PlanPersistence.js                # 纯转发（storage 由 Brain 注入）
```

契约：`seams/engine-brain.js`（`factory: false` + 9 项 `methods` + `properties: ['status']` + `invariants`/`notes`）。
profile：`profiles/{default,mock-llm}.json` 各一条 `"engines/brain": { "enabled": true, "options": {} }`。
`dependencies` 保持空数组：setup 不 inject 任何服务，三条协作方都在**首次使用时**解析，
不需要拓扑顺序保证（`topoSort` 对"声明了依赖但依赖未启用"是硬报错）。

## 门面不改对象身份

门面文件都是 `export … from` 转发，**不是重新实现**：

```js
import { Brain, BrainStatus, default as B2 } from './Brain/index.js';
B2 === Brain;                                            // true
// 且与插件里的类对象 ===
(await import('../../plugins/engines/brain/Brain.js')).Brain === Brain;   // true
```

对象身份必须保持，否则：`BrainStatus` 常量会分属两个模块（状态比较全失效）、
`m2/f12` 里 `brain._plans` 断言会打在另一个类上。

## 三条解析链（本次迁移唯一需要"接线"的地方）

迁移前 Brain 有 **1 条静态 import + 3 处运行时自建**。静态 import 在插件里全部非法
（R2 禁止插件引用 `Server/`），运行时自建会"无宿主时炸在深处"，因此各换成解析器：

| 协作方 | 顺序（高 → 低） | fail closed 文案点名 |
|--------|------------------|----------------------|
| `llm` | ① `new Brain({ llm })` → ② 宿主 `llm` 接缝 → ③ 门面 `Server/Brain/Brain.js` 在 import 期登记的内置 `LLMClient` → ④ 抛错 | `'llm' 接缝` / `Server/Brain/Brain.js` / `new Brain({ llm })` |
| `storage` | ① `new Brain({ storage })` → ② 宿主 `storage` 接缝 → ③ 门面登记的惰性 `() => createStorage` → ④ 抛错 | `'storage' 接缝` / `Server/Brain/Brain.js` / `new Brain({ storage })` |
| `cli` | ① `new Brain({ cli })` → ② 门面 `Server/Brain/SkillExecutor.js` 在 import 期登记的惰性 `CLIController` → ③ 宿主 `ai-cli` 接缝（`resolveAiCliFactory(type)`）→ ④ 抛错 | `'ai-cli' 接缝` / `Server/Brain/SkillExecutor.js` / `new Brain({ cli })` |

三个要点：

- **登记的是加载器不是实现**：无宿主时仍保持"第一次真正用到才加载实现"的时机，也不会把
  `@opencode-ai/sdk` / `better-sqlite3` 拖进"只想 import 一个类"的路径（LLM 是唯一例外：
  它本来就是静态 import，登记的是类本身，加载时机与迁移前一致）；
- **`cli` 的第 2 档排在宿主接缝之前**（与 `storage` 相反，是有意的）：`ai-cli` 接缝提供方是
  **适配器工厂**，而 `SkillExecutor` 的既有协作方是 `CLIController` **门面**——门面独有的两件事
  （type 闭集校验的原文案、`startSession` 的 `stats` 旁路计数）适配器都不做，直接取接缝会
  静默丢掉 Session 调用计数。`CLIController` 自身再走 `resolveAiCliFactory(type)`，所以
  **有宿主时第 2 档照样用宿主接缝**，只是外面套了门面。第 3 档仅服务"纯宿主、完全不 import
  `Server/`"的嵌入场景；该路径拿到适配器（无 `getType()`、不记 `stats`），`SkillExecutor`
  的错误文案因此用 `cliType(cli)`（`getType()` → `cliType` 字段，取到同一个类型名）；
- **第 2 档依赖"活跃宿主"**（`setActiveHost` / `runInHostScope`），不是"某个已 load 的宿主"：
  只 `host.load()` 不激活，深处消费者看不见它——这是 `core/hostBridge.js` 的既有语义。

## 与迁移前的四处行为差异（有意为之）

1. **删掉 `await loadServerEnv()`**：迁移前 Brain 模块顶层有这行，属于"import 即改进程环境变量"
   的隐式副作用。env 现在是入口职责——`Server/composition/buildApp.js` 首行、
   `cli/lib/config.js` 的 `loadEnvChain()`、以及手工入口显式引导（与 `Server/CLI/cli.js` 的
   处理完全同源）。插件作为能力实现不再有环境副作用。
2. **llm/storage 的解析时机**：构造函数不能 await（兜底是惰性加载器），所以解析挪到
   `_ensureWired()`（幂等）：`deps.llm` + `deps.storage` 都注入时**构造期当场接线**（与迁移前
   一致）；解析不到时**构造期不抛**，留到首次 `planTask`/`replanTask`/`loadPlan`/
   `loadPlanHistory`/`listPlans` 时 fail closed。构造期不抛是刻意的：
   `test/m9-contract-conformance` 会用 `new Brain({})` 真构造一次提供方（无宿主上下文），
   构造期抛错会把一条"契约声明 vs 实现"的断言变成误报。
   `cli` 不受影响——它本来就是第一次 `getCLI()` 才解析。
3. **`skillDirectory` 默认值推导深度 +3**：`<插件目录>/../../..` = 树根，再拼 `Server/Skills`，
   与迁移前是**同一个绝对路径**（发布态 `vendor/{Server,plugins}` 平级，层数关系不变）。
   正常路径上默认值不生效：`buildApp` 一定注入 `skillDirectory`。
4. **无宿主 fail closed 取代"永久自建"**：迁移前三处自建在无宿主时各自 `import` 一份实现；
   现在必须先由门面登记兜底，否则报错点名缺哪个来源。正常部署形态（任何 `Server/**`
   消费者都 import 过 `Server/Brain/index.js`）下与迁移前逐字节等价。

## 副本债务（已回报；收口需要 test/ 或 `Server/library/**` 的边界）

| 副本 | 现状 | 收口方向 |
|------|------|----------|
| ~~`lib/cstTime.js`~~ | **已收口**：`nowCST()` 是无状态纯函数，实现已归一到内核 `core/cstTime.js`（R1 只要求它不 import 外部实现，它只用 `Date`；R2 允许插件引用 `core/`），全仓库 5 份插件内副本全部删除 | 本插件改为 `import { nowCST } from '../../../core/cstTime.js'`；`test/m8-plugin-kernel/f50-util-copies.test.mjs` 的 A 组改为单实现断言（`plugins/` 下 0 个 `cstTime.js` 副本） |
| `lib/BoundedRegistry.js` | 全仓库第 2 份（`Server/library/BoundedRegistry.js` + 本插件），实现体逐字节相同 | 同上，或做成 util 小插件 + 接缝（也可按 `cstTime` 的路子归一到 `core/`）；其状态是**每实例**的（`_map`/`_order`），两份副本不会互踩，风险只剩代码分叉 |

`lib/BoundedRegistry.js` 的文件头写了来源与"由哪个守卫覆盖/未覆盖"，改一份请同步另一份；
`nowCST` 只有一份，不再有同步问题。

## 接口（迁移前后不变）

```js
const brain = new Brain({
  llm: new LLMClient(),      // 可选，注入自定义 LLM（不传走 llm 解析链）
  storage: createStorage(),  // 可选，存储门面（不传走 storage 解析链）
  sseHub: sseHubInstance,    // 可选，SSE 推送
  cli: cliController,        // 可选，CLI 协作方（不传则惰性解析）
  skillDirectory: '...',     // 可选，SKILL 目录
  maxPlans: 200              // 可选，内存计划缓存上限（默认 BRAIN_MAX_PLANS 或 200）
});
```

| 方法 | 说明 |
|------|------|
| `planTask(taskDescription, options?)` | 拆解任务，返回 BrainPlan |
| `replanTask(taskDescription, options)` | 重规划（基于上轮审核失败，**复用 taskId**） |
| `planAndExecute(taskDescription, orchController, options?)` | 拆解并直接执行 |
| `getPlans()` / `getPlan(planId)` / `getRegistryStats()` | 内存计划缓存（有界 LRU） |
| `loadPlan(planId, options?)` | 从文件系统加载（支持 taskId / loopCount 快速路径） |
| `loadPlanHistory(taskId)` | 加载某 Task 下所有轮次计划（按轮次升序） |
| `listPlans()` | 列出所有历史计划（按 planId 去重） |
| `status`（getter） | 当前状态（`BrainStatus`） |

### BrainPlan 结构

```js
{
  planId: 'plan_xxx', taskId: 'task_xxx', taskDescription: '原始自然语言描述',
  analysis: { intent, domain, keywords, constraints, techStack, complexity, estimatedSteps, acceptanceCriteria },
  taskDef: { taskId, taskDir, skillDirectory, acceptanceCriteria, loopCount,
             steps: [{ stepId, taskDescription, specifiedSkill, dependId, nextStepId, failStepId, maxRetries, acceptanceCriteria }] },
  validation: { valid, issues }, createdAt: '2026-07-31T...+08:00', status: 'completed'
}
```

## SSE 事件

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `brain:plan:start` | 开始拆解 | `{ planId, taskId, taskDescription }` |
| `brain:analyze:done` | 分析完成 | `{ planId, analysis, sessionId }` |
| `brain:plan:done` | 步骤拆解完成 | `{ planId, stepCount, steps, sessionId }` |
| `brain:validate:done` | 校验完成 | `{ planId, validation }` |
| `brain:plan:complete` | 拆解全部完成 | `{ planId, taskDef }` |
| `brain:plan:error` | 拆解失败 | `{ planId, error }` |
| `brain:replan:*` | 重规划对应阶段 | 同形，频道用 taskId |

未注入 `sseHub` 时所有推送静默跳过，不影响拆解结果。

## 验证

```bash
node test/m3/run-all.mjs                        # 8 套件 / 160 条断言
node test/m5-phase2/run-all.mjs                 # 3 套件 / 166 条断言
node test/m8-plugin-kernel/run-all.mjs          # 266 条（含 cstTime 单实现守卫）
node test/m9-contract-conformance/run-all.mjs   # 165 条（新增接缝自动纳入）
node test/m2/run-all.mjs                        # 165 条（F-12 覆盖 Brain._plans 有界）
node scripts/arch-guard.mjs                     # R1/R2/R3
node cli/scripts/verify-deps.mjs                # 依赖声明核对
```
