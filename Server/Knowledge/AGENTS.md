# Knowledge —— 知识沉淀系统（门面层）

> ⚠️ **实现已整体迁入插件 `plugins/engines/knowledge/`**（`KnowledgeManager.js` /
> `KnowledgeImporter.js` 两个文件原样搬走，逻辑逐行不变；无状态依赖 `nowCST` 归一到内核
> `core/cstTime.js`，另有 `AtomicJsonFile` / `McpToolGuide` 两份插件内副本）。
> 本目录**全部是转发门面**，零业务逻辑；`Server/**` 侧 4 处消费者与既有 M3 用例按老路径
> import，插件化不该顺手改掉它们。这是「引擎插件化」的第一片，`Brain` / `Orchestrator` /
> `FlexRunner` / `TestCheck` / `LoopEngine` 照同一形状迁移即可。

## 目录结构

```
plugins/engines/knowledge/            # ← 实现实体 + 插件入口
├── plugin.json                       # 清单：name=engines/knowledge, seam=engine-knowledge
├── index.js                          # definePlugin 入口：ctx.provide('engine-knowledge', KnowledgeManager)
├── KnowledgeManager.js               # 知识管理器（经验 CRUD + 词法相关性检索），原样迁入
├── KnowledgeImporter.js              # 知识导入执行引擎（CLI + knowledge-import SKILL），原样迁入
└── lib/                              # 插件内副本 / 解析器（插件不得引用 Server/，也不得跨插件 import）
    ├── AtomicJsonFile.js             # ← plugins/storage/core/lib/AtomicJsonFile.js（副本 #3，同上）
    ├── McpToolGuide.js               # ← Server/library/McpToolGuide.js（零 Server 依赖，随插件走）
    └── storageSource.js              # createStorage 解析：宿主 storage 接缝 → 门面登记的内置兜底

Server/Knowledge/                     # ← 门面层：路径与导出面与迁移前逐名一致
├── index.js                          # 转发 KnowledgeManager / KnowledgeImporter / default
├── KnowledgeManager.js               # 转发 default + **登记无宿主存储兜底**
└── KnowledgeImporter.js              # 转发 KnowledgeImporter / default
```

契约：`seams/engine-knowledge.js`（`factory: false` + 8 项 `methods` + `notes`/`invariants`）。
profile：`profiles/{default,mock-llm}.json` 各一条 `"engines/knowledge": { "enabled": true, "options": {} }`。

## 门面不改对象身份

三个门面文件都是 `export … from` 转发，**不是重新实现**：

```js
import { KnowledgeManager, KnowledgeImporter, default as KM2 } from './Knowledge/index.js';
KM2 === KnowledgeManager;   // true
// 且与插件里的类对象 ===：await import('../../plugins/engines/knowledge/KnowledgeManager.js')
```

对象身份必须保持，否则 `AtomicJsonFile` 的 `_chains`（按 key 的串行链）会出现**两份锁表**——
`knowledge:<rootDir>` 上就不再串行，并发 `addExperience` 会丢更新（F-15 的真实故障）。

## `createStorage` 的解析链（本次迁移唯一需要"接线"的地方）

`KnowledgeManager.init()` 迁移前直接 `await import('../DbUse/index.js')` 取 `createStorage`；
插件里这条路径非法（架构守卫 R2 禁止插件引用 `Server/`）。改为三档解析
（实现见 `plugins/engines/knowledge/lib/storageSource.js`）：

| 顺序 | 来源 | 场景 |
|------|------|------|
| 1 | 构造入参 `new KnowledgeManager({ createStorage })` | 测试 / 嵌入式注入 |
| 2 | 宿主的 `storage` 接缝（`core/hostBridge.js` 的 `resolveSeamProvider`，作用域宿主优先） | 有活跃插件宿主 |
| 3 | 门面登记的内置兜底（`Server/Knowledge/KnowledgeManager.js` 在 import 期登记**惰性加载器**） | 无宿主（默认部署形态） |
| — | 三档都没有 → fail closed，错误信息点名缺哪条接缝 | — |

两个要点：

- **登记的是加载器不是函数**：无宿主时仍然"第一次 `init()` 才加载存储实现"，时机与迁移前
  等价，也不会把 `@opencode-ai/sdk` / `better-sqlite3` 之类拖进"只想 import 一个类"的路径；
- **第 2 档依赖"活跃宿主"，不是"某个已 load 的宿主"**：只 `host.load()` 不激活
  （`setActiveHost` / `runInHostScope`），深处消费者看不见它——这是 `core/hostBridge.js`
  的既有语义，插件侧不做任何绕行。本插件注册的是**类**，消费者自己 `new`，所以
  `dependencies` 留空：`topoSort` 对"声明了依赖但依赖未启用"是**硬报错**，
  而本插件并不需要装配顺序保证。

## 迁 KNOWN 的两处行为差异（有意为之）

1. **`KnowledgeImporter._getCLI()` 改为 fail closed**：迁移前它会 `await import('../CLI/cli.js')`
   兜底 `new CLIController()`；插件里不再能引用 `Server/CLI`。该路径实际不可达——
   `buildApp` 一直把共享 CLI 注入 `KnowledgeImportController` → 透传给本类。
   少了 `deps.cli` 现在在调用点直接报错（点名注入项），而不是在插件内部偷偷自建一份。
2. **两处默认路径推导深度 +3**：`getSkillDir()` 默认 `<树根>/Server/Skills`、
   MCP 引导默认 `<树根>/MCP/config.json`，均改为按"插件目录上溯 3 层 = 树根"计算。
   解析结果与迁移前是**同一个绝对路径**（prepack 后 `vendor/{Server,plugins,MCP}` 平级，
   层数关系不变）。正常路径上这两个默认值都不生效：`buildApp` 一定注入 `skillDirectory`，
   `McpToolGuide` 的 configPath 一定显式传入。

## 副本债务（已回报；收口需要 test/ 或 `Server/library/**` 的边界）

| 副本 | 现状 | 收口方向 |
|------|------|----------|
| ~~`lib/cstTime.js`~~ | **已收口**：`nowCST()` 是无状态纯函数，实现已归一到内核 `core/cstTime.js`（R1 只要求它不 import 外部实现，它只用 `Date`；R2 允许插件引用 `core/`），全仓库 5 份插件内副本全部删除 | 本插件改为 `import { nowCST } from '../../../core/cstTime.js'`；`test/m8-plugin-kernel/f50-util-copies.test.mjs` 的 A 组改为单实现断言（`plugins/` 下 0 个 `cstTime.js` 副本） |
| `lib/AtomicJsonFile.js` | 全仓库第 3 份（storage、stats、本插件），实现体逐字节相同（f50 剥掉文件头后可直接比对） | 同上，E 组加一条路径 |
| `lib/McpToolGuide.js` | 与 `Server/library/McpToolGuide.js` **两份实现**（该类零 Server 依赖，故复制最省事） | 做成独立小插件（如 `util/mcp-tool-guide`）+ 接缝，`Server/library/McpToolGuide.js` 退化为转发门面 |

两份副本的文件头都写了来源与"与哪份同源、由哪个守卫覆盖/未覆盖"，改一份请同步另一份；
`nowCST` 只有一份，不再有同步问题。

## 验证

```bash
node test/m3/run-all.mjs                       # 8 套件 / 160 条断言（f25 直接覆盖知识闭环 23 条）
node test/m8-plugin-kernel/run-all.mjs         # 266 条（含 cstTime 单实现守卫）
node test/m9-contract-conformance/run-all.mjs  # 契约一致性（新增接缝自动纳入）
node scripts/arch-guard.mjs                    # R1/R2/R3
node cli/scripts/verify-deps.mjs               # 依赖声明核对
```
