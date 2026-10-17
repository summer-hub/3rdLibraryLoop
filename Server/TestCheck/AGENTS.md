# TestCheck —— 任务准出审核引擎（门面层）

> ⚠️ **实现已整体迁入插件 `plugins/engines/testcheck/`**（2 个文件 / 787 行原样搬走，业务逻辑
> 逐行不变；无状态依赖 `nowCST` 归一到内核 `core/cstTime.js`，四个协作方改为解析器）。
> 本目录**全部是转发门面**，零业务逻辑；`Server/**` 侧消费者与既有测试按老路径 import，
> 插件化不该顺手改掉它们。这是「引擎插件化」的第三片（前两片是 `Server/Knowledge/`、
> `Server/Brain/`，形状照抄它们）。

## 职责（迁移前后不变）

在 Orchestrator 所有步骤执行完成后，对最终产物进行验收审核。通过 Agent 选择合适的 SKILL
执行准出检查，对照 Brain 生成的任务级验收标准判断是否满足准出条件。

```
Brain（拆解/重规划）→ Orchestrator（编排）→ FlexRunner（执行）→ TestCheck（准出审核）
                                                                        │
                                                    未通过 ──→ 回到 Brain 重新生成目标
```

## 目录结构

```
plugins/engines/testcheck/            # ← 实现实体 + 插件入口
├── plugin.json                       # 清单：name=engines/testcheck, seam=engine-testcheck, dependencies=[]
├── index.js                          # definePlugin 入口：ctx.provide('engine-testcheck', TestCheck)
├── TestCheck.js                      # 准出审核核心类，原样迁入（仅 import / 接线 / 两处动态 import 变了）
└── lib/                              # 插件内副本 / 解析器（插件不得引用 Server/，也不得跨插件 import）
    ├── storageSource.js              # createStorage 解析：宿主 storage 接缝 → 门面登记兜底 → fail closed
    ├── llmSource.js                  # LLM 客户端解析：宿主 llm 接缝 → 门面登记兜底 → fail closed
    ├── cliSource.js                  # CLI 协作方解析：门面登记 CLIController → 宿主 ai-cli 接缝 → fail closed
    └── skillSelectorSource.js        # SkillSelector 解析：显式注入 → 门面登记兜底 → fail closed（**无接缝档**）

Server/TestCheck/                     # ← 门面层：路径与导出面与迁移前逐名一致
├── index.js                          # 纯转发 TestCheck / CheckStatus / default
├── TestCheck.js                      # 转发同三项 + **登记四条无宿主兜底**
└── AGENTS.md                         # 本文档
```

契约：`seams/engine-testcheck.js`（`factory: false` + 3 项 `methods` + `properties: ['status']` +
`invariants` / `notes`）。
profile：`profiles/{default,mock-llm}.json` 各一条 `"engines/testcheck": { "enabled": true, "options": {} }`。
`dependencies` 保持空数组：setup 不 inject 任何服务，四条协作方都在**首次使用时**解析，
不需要拓扑顺序保证（`topoSort` 对"声明了依赖但依赖未启用"是硬报错）。

## 门面不改对象身份

门面文件都是 `export … from` 转发，**不是重新实现**：

```js
import { TestCheck, CheckStatus, default as T2 } from './TestCheck/index.js';
T2 === TestCheck;                                                          // true
// 且与插件里的类对象 ===
(await import('../../plugins/engines/testcheck/TestCheck.js')).TestCheck === TestCheck;   // true
```

对象身份必须保持，否则 `CheckStatus.PASSED` 常量会分属两个对象，
`LoopEngine` 里 `checkResult.status === CheckStatus.PASSED` 这类比较全部失效。

## 四条解析链（本次迁移唯一需要"接线"的地方）

迁移前 TestCheck 有 **4 条静态 import + 2 处运行时自建**。静态 import 在插件里全部非法
（R2 禁止插件引用 `Server/`），运行时自建会"无宿主时炸在深处"，因此各换成解析器：

| 协作方 | 顺序（高 → 低） | fail closed 文案点名 |
|--------|------------------|----------------------|
| `llm` | ① `new TestCheck({ llm })` → ② 宿主 `llm` 接缝 → ③ 门面 `Server/TestCheck/TestCheck.js` 在 import 期登记的内置 `LLMClient` → ④ 抛错 | `'llm' 接缝` / `Server/TestCheck/TestCheck.js` / `new TestCheck({ llm })` |
| `storage` | ① `new TestCheck({ storage })` → ② 宿主 `storage` 接缝 → ③ 门面登记的惰性 `() => createStorage` → ④ 抛错 | `'storage' 接缝` / `Server/TestCheck/TestCheck.js` / `new TestCheck({ storage })` |
| `cli` | ① `new TestCheck({ cli })` → ② 门面登记的惰性 `CLIController` → ③ 宿主 `ai-cli` 接缝（`resolveAiCliFactory(type)`）→ ④ 抛错 | `'ai-cli' 接缝` / `Server/TestCheck/TestCheck.js` / `new TestCheck({ cli })` |
| `skillSelector` | ① `new TestCheck({ skillSelector })` → ② 门面登记的惰性 `Agent`（`Server/Agent/SkillSelector/index.js`）→ ③ 抛错 | 无接缝（尚未插件化）/ `Server/TestCheck/TestCheck.js` / `new TestCheck({ skillSelector })` |

四个要点：

- **登记的是加载器不是实现**：无宿主时仍保持"第一次真正用到才加载实现"的时机，也不会把
  `@opencode-ai/sdk` / `better-sqlite3` / SkillSelector 的 5499 行拖进"只想 import 一个类"的路径
  （LLM 是唯一例外：它本来就是静态 import，登记的是**类本身**，加载时机与迁移前一致）；
- **`cli` 的第 2 档排在宿主接缝之前**（与 `storage` 相反，是有意的）：`ai-cli` 接缝提供方是
  **适配器工厂**，而 TestCheck 的既有协作方是 `CLIController` **门面**——门面独有的两件事
  （type 闭集校验的原文案、`startSession` 的 `stats` 旁路计数）适配器都不做，直接取接缝会
  静默丢掉 Session 调用计数。`CLIController` 自身再走 `resolveAiCliFactory(type)`，所以
  **有宿主时第 2 档照样用宿主接缝**，只是外面套了门面。第 3 档仅服务"纯宿主、完全不 import
  `Server/`"的嵌入场景；该路径拿到适配器（无 `getType()`）；
- **`skillSelector` 没有接缝档**，见下面的待办；
- **第 2/3 档依赖"活跃宿主"**（`setActiveHost` / `runInHostScope`），不是"某个已 load 的宿主"：
  只 `host.load()` 不激活，深处消费者看不见它——这是 `core/hostBridge.js` 的既有语义。

### 待办：SkillSelector 插件化后再立接缝

`Server/Agent/SkillSelector/`（**5499 行 / 18 文件**）仍未插件化，因此**故意没有**
`seams/agent-skill-selector.js`——一个没有提供方的契约是死契约。当前 `skillSelector` 只有
「显式注入 → 门面登记加载器 → fail closed」三档。

**待办**：SkillSelector 插件化后，立 `seams/agent-skill-selector.js`，并把
`plugins/engines/testcheck/lib/skillSelectorSource.js` 的第 2 档之后升级为接缝解析
（`resolveSeamProvider('agent-skill-selector')`）；届时 `Server/TestCheck/TestCheck.js` 里的
`setSkillSelectorFallback(...)` 才可降级为纯兜底或移除。

## 与迁移前的行为差异（有意为之）

1. **删掉构造期的强解析**：迁移前构造函数里 `this.llm = deps.llm || createLlmFromHost(LLMClient)`
   与 `this.storage = deps.storage || createStorage()` 都是构造即解析。现在只登记注入值，
   解析挪到 `_ensureWired()`（幂等，`runCheck` / `loadCheckResult` / `listCheckResults` 各自入口调用）。
   构造期不抛是刻意的：`test/m9-contract-conformance` 会用 `new TestCheck({})` 真构造一次提供方
   （无宿主上下文），构造期强解析会必红。
   **故障位置不变**：`_ensureWired()` 仍在 `runCheck` 的 `try` **之外**，所以 llm/storage 解析
   失败照旧**抛出**；而 `skillSelector` / `cli` 的解析失败仍在 `try` 之内，照旧落成
   `result.status = 'error'`（F-22 三态语义不变）。
2. **`skillDirectory` 默认值推导深度 +3**：`<插件目录>/../../..` = 树根，再拼 `Server/Skills`，
   与迁移前是**同一个绝对路径**（发布态 `vendor/{Server,plugins}` 平级，层数关系不变）。
   正常路径上默认值不生效：`buildApp` 一定注入 `skillDirectory`。
3. **无宿主 fail closed 取代"永久自建"**：迁移前两处运行时自建在无宿主时各自 `import` 一份实现；
   现在必须先由门面登记兜底，否则报错点名缺哪个来源。正常部署形态（任何 `Server/**` 消费者都
   import 过 `Server/TestCheck/index.js`）下与迁移前逐字节等价。
4. **既有缺陷已修复（M11 / `test/m11-storage-list-semantics`）**：`listCheckResults()` 原来调
   `storage.json('task').list('<taskId>/testcheck_loop')`，恒返回 `[]`。根因比"目录前缀 vs 文件名
   前缀"更靠下：`JsonAdapter.list(prefix)` 用 `rel.startsWith(prefix)` 比较，而 Windows 下 `rel`
   由 `path.join` 产出、带 `\`——**任何含分隔符的前缀恒不匹配**（`list('task_x/testcheck_loop')`
   → `[]`；单段前缀 `list('task_x')` 反而正常，所以缺陷长期静默）。现两处收口：适配器把 key
   规范成 `/` 形式并按 key 前缀匹配（第二参数 `{ recursive: true }` 供整树列举），本方法改成
   `list(taskId)` 拿目录条目 + 按文件名前缀 `testcheck_loop{n}` 过滤。同一临时数据目录实测：
   修复前 `[]` → 修复后 2 条（按 `loopCount` 升序）。

## 接口（迁移前后不变）

```js
const checker = new TestCheck({
  llm: llmClient,          // 可选，不传走 llm 解析链
  storage: createStorage(),// 可选，不传走 storage 解析链
  sseHub: sseHubInstance,  // 可选，SSE 推送
  cli: cliController,      // 可选，不传走 cli 解析链
  skillSelector: agent,    // 可选，不传走 skillSelector 解析链
  skillDirectory: '...',   // 可选，默认 <树根>/Server/Skills
});
```

| 方法 | 说明 |
|------|------|
| `runCheck(params)` | 执行完整准出审核（MATCHING → EXECUTING → EVALUATING → 持久化） |
| `loadCheckResult(taskId, loopCount)` | 读回某轮审核结果（读不到返回 `null`） |
| `listCheckResults(taskId)` | 列出某 Task 全部轮次（读不到返回 `[]`；M11 已修复） |
| `status`（getter） | 当前状态（`CheckStatus`） |

`runCheck` 参数：`taskId`（必填）/ `taskDir` / `taskDescription` / `acceptanceCriteria` /
`orchestratorResult` / `loopCount` / `skillDirectory` / `isAborted` / `onSessionCreated`。

返回 `CheckResult`：

```js
{
  checkId, taskId, loopCount,
  taskDescription, acceptanceCriteria, orchestratorResult,
  startTime, endTime,
  status,        // 'passed' | 'failed' | 'error'
  passed,        // boolean
  matchedSkillDir, checkReportPath, sessionId,
  criteriaResults: [{ id, criterion, satisfied, evidence, note }],
  summary, improvementSuggestions, error
}
```

审核流程：**MATCHING**（SkillSelector 匹配审核 Skill）→ **EXECUTING**（CLIController 执行，
产出审核报告）→ **EVALUATING**（LLM 读取报告逐条判定，报告里出现 `## 准出结论` 时先算一份
快速结论作为 fallback）→ **持久化**。

## 持久化文件布局

```
<数据目录>/task/{taskId}/
├── brain_loop{n}.json / brain.json        ← Brain 拆解计划
├── orchestration_loop{n}.json             ← Orchestrator 编排状态
├── loop.json                              ← LoopEngine 大循环状态
├── testcheck_loop{n}.json                 ← 第 n 次循环准出审核（本模块写入）
├── testcheck_loop{n}_result.md            ← 审核报告（审核 SKILL 写入）
├── testcheck_loop{n}_Summary.md           ← 审核摘要（审核 SKILL 写入）
└── stepid_1_loop{n}.json                  ← 步骤执行记录
```

## SSE 事件

频道为 `taskId`：`testcheck:start` / `testcheck:match` / `testcheck:execute` /
`testcheck:evaluate` / `testcheck:result` / `testcheck:error`。未注入 `sseHub` 时全部静默跳过。

## 副本债务（已回报）

| 副本 | 现状 | 收口方向 |
|------|------|----------|
| ~~`plugins/engines/testcheck/lib/cstTime.js`~~ | **已收口**：`nowCST()` 是 16 行无状态纯函数，实现已归一到内核 `core/cstTime.js`（R1 只要求它不 import 外部实现，它只用 `Date`；R2 允许插件引用 `core/`），全仓库 5 份插件内副本全部删除 | 本插件改为 `import { nowCST } from '../../../core/cstTime.js'`；`test/m8-plugin-kernel/f50-util-copies.test.mjs` 的 A 组改为**单实现断言**（内核存在 + 行为冻结 + `plugins/` 下 0 个 `cstTime.js` 副本 + 插件内说明符只能指向 core） |

`nowCST` 不再有「改一份请同步 N 份」的问题——只有一份。`Server/library/cstTime.js` 仍是转发门面，
与 `core/cstTime.js` 是**同一个函数对象**。

## 与 LoopEngine 的关系

TestCheck 是 LoopEngine 大循环的准出判断环节：

- `passed=true` → LoopEngine 结束循环，任务完成
- `passed=false` → LoopEngine 调用 `Brain.replanTask()` 重新生成目标，进入下一轮循环
- `status=error` → LoopEngine 根据策略决定是否重试或终止

TestCheck 不感知 LoopEngine 的存在，只负责执行审核并返回结果。

## 验证

```bash
node test/m3/run-all.mjs                        # 8 套件 / 160 条断言
node test/m5-phase2/run-all.mjs                 # 3 套件 / 166 条断言
node test/m8-plugin-kernel/run-all.mjs          # 266 条（含 cstTime 单实现守卫）
node test/m9-contract-conformance/run-all.mjs   # 176 条（新增 engine-testcheck 后 165 → 176）
node test/m11-storage-list-semantics/run-all.mjs # 38 条（list 语义 + 两个公开方法回归锁）
node scripts/arch-guard.mjs                     # R1/R2/R3（53 个插件文件 / 10 个插件）
node cli/scripts/verify-deps.mjs                # 依赖声明核对
npx --no-install biome lint --reporter=summary  # 0 error
```
