# Routes —— HTTP 接口层

对外暴露 REST API，供 Web 前端（同机反向代理）调用。采用分层架构，实现高内聚低耦合。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  server.js                                            │
│  创建 HTTP 服务、组装共享依赖、委派请求给 Router              │
├──────────────────────────────────────────────────────────────┤
│  路由层                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────┐ │
│  │ router/Router.js    │    │ routes/index.js              │ │
│  │ 路由匹配/参数提取   │    │ 路由注册表（Controller 挂载） │ │
│  │ 中间件链/统一响应   │    │ 新增模块只需在此追加         │ │
│  └─────────────────────┘    └──────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  控制器层  controllers/                                       │
│  HealthController.js   - 健康检查                            │
│  (TaskController.js)   - 任务管理（未来）                    │
│  (StreamController.js) - SSE 实时推送（未来）                │
├──────────────────────────────────────────────────────────────┤
│  依赖注入                                                    │
│  共享单例（CLIController / TaskStepStore / SseHub）           │
│  由 Server/composition/buildApp.js 装配，经 dependencies 注入 │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/Routes/
├── AGENTS.md                      # 本文档
├── server.js                      # 入口：HTTP 服务 + 依赖组装 + 优雅关闭
├── router/
│   └── Router.js                  # 路由器内核（匹配/分发/中间件/响应封装）
├── routes/
│   ├── index.js                   # 路由组装器（集中管理各域挂载）
│   ├── health.js                  # 健康检查域路由
│   └── stream.js                  # SSE 实时推送域路由
├── controllers/
│   ├── HealthController.js        # 健康检查控制器
│   └── StreamController.js        # SSE 订阅控制器
├── sse/
│   └── SseHub.js                  # SSE 推送中心（连接管理/心跳/限流/清理）
└── library/
    └── logger.js                  # 轻量日志工具
```

## 分层职责

### server.js — 入口层
- 创建 `http.Server`，仅绑定 `127.0.0.1`（同机回环，不对外暴露）
- 调用 `Server/composition/buildApp.js` 取得共享依赖，通过 `dependencies` 对象注入
- 将所有请求委派给 `Router.handle()`
- **不包含任何业务逻辑，也不自行 new 任何 Controller**

### router/Router.js — 路由器内核
- 路径模板编译：支持 `:param` 参数提取、`*` 通配符
- HTTP 方法匹配：GET / POST / PUT / DELETE
- 子路由挂载：`router.use(prefix, subRouter)` 按模块聚合
- 中间件链：支持 per-route 中间件（鉴权、日志等）
- 统一响应封装：`ResponseContext.json()` / `.error()` / `.stream()`
- 自动 JSON body 解析
- **与业务完全解耦，可独立测试**

### routes/ — 路由注册表
- `index.js` — 组装器，将各域路由挂载到主路由器，只做 `router.use()` 拼装
- `health.js` — 健康检查域：实例化 Controller + 定义路径映射
- 新增业务模块时：
  1. 在 `controllers/` 下创建 `XxxController.js`（业务逻辑）
  2. 在 `routes/` 下创建 `xxx.js`，导出 `createXxxRouter(dependencies)`
  3. 在 `routes/index.js` 追加 import + `router.use()`

### controllers/ — 控制器层
- 每个 Controller 封装一类业务逻辑
- 通过构造函数接收依赖（CLIController 等），不自行 new
- handler 方法只接收 `RequestContext` / `ResponseContext`，不直接操作原生 req/res

## 新增接口示例

以「任务管理」为例：

```js
// 1. controllers/TaskController.js — 业务逻辑
class TaskController {
    constructor(cli, taskStepStore) { ... }
    async list(req, res) { ... }
    async create(req, res) { ... }
    async get(req, res) { ... }
}

// 2. routes/task.js — 路由注册
import { Router } from '../router/Router.js';
import TaskController from '../controllers/TaskController.js';
export function createTaskRouter(dependencies) {
    const { cli, taskStepStore } = dependencies;
    const c = new TaskController(cli, taskStepStore);
    const router = new Router();
    router.get('',            c.list.bind(c));
    router.post('',           c.create.bind(c));
    router.get('/:taskId',    c.get.bind(c));
    return router;
}

// 3. routes/index.js — 组装器中追加
import { createTaskRouter } from './task.js';
router.use('/api/tasks', createTaskRouter(dependencies));
```

## 依赖注入

共享单例由 `Server/composition/buildApp.js` 统一装配（唯一装配点，Composition Root）。
`server.js` 只负责调用它，再把结果交给路由层：

```js
const { host, shutdownHost, dependencies } = await resolveDependencies({
    cliType, cliOptions, cli, pluginHost, profile
});
const { sseHub, storage, orchestratorController } = dependencies;
registerRoutes(router, dependencies);
```

`buildApp` 返回的键集合固定为 **13 个**（历史 11 个 + `host` + `engineClasses`）：
`cli / sseHub / storage / flexRunnerController / orchestratorController / brainController /
testCheck / loopEngineController / knowledgeManager / knowledgeImportController / skillDirectory /
host / engineClasses`。

`host` 是本次装配使用的插件宿主引用（未传宿主时为 `null`）：入口据此在停机时释放它，测试也可
据此断言「装配确实用了这个宿主」。

`engineClasses` 是本次装配**实际使用**的引擎类 `{ brain, testCheck, orchestrator, loop, knowledge }`：
无宿主时五项全为 `null`（＝用门面导入的类），有宿主时是接缝注入的类。测试据此断言「装配确实从
接缝取引擎」，而不是因为门面转发同一个类对象才碰巧相等。

### `buildApp({ host })` 的宿主分支（可选）

传了已 load 的宿主，装配层就从接缝取能力：

| 能力 | 不传 `host`（默认，逐字节不变） | 传了 `host` |
|------|--------------------------------|-------------|
| 存储 | `createStorage(storageOptions)`（内置实现） | `host.inject('storage')(storageOptions)`；**接缝缺失即抛错**（fail closed，错误信息指出缺哪条接缝 + 列出可用接缝） |
| 统计 | 消费者自己 `resolveStats() ?? StatsService` | `host.inject('stats')` 经 `cliOptions.stats` 显式注入给 `CLIController`（显式注入优先于全局桥，见 `Server/CLI/AGENTS.md`） |
| 引擎（五个） | 门面导入的类（`new Brain(...)` 等） | `host.inject('engine-*')` 得到的类，经 `deps.<X>Class` / `new TestCheckClass` / `new KnowledgeManagerClass` 使用；**缺失即抛错**（见下 `engineSeams`） |
| AI CLI | `CLIController` 回落内置适配器 | `CLIController` 解析 `ai-cli@cli/<type>`——**要求入口先把宿主激活**（见下），否则仍是内置适配器 |
| 日志 | `plugins/util/logger` 缺省 | 同左（`app-logger` 接线由 `plugins/cli/opencode` 的 setup 完成，装配层不碰） |

#### `engineSeams`：引擎接缝两态

五个引擎各有一条接缝（注册的都是**类**，装配层「取类 → 交给控制器自己 new」，不托管单例）：

| 接缝 | 提供方插件 | 装配层消费者 | 注入方式 |
|------|-----------|-------------|----------|
| `engine-brain` | `engines/brain` | `BrainController` | `deps.BrainClass` |
| `engine-testcheck` | `engines/testcheck` | `buildApp` 自己 `new TestCheckClass({...})` | — |
| `engine-orchestrator` | `engines/orchestrator` | `OrchestratorController` | `deps.OrchestratorClass` |
| `engine-loop` | `engines/loopengine` | `LoopEngineController` | `deps.LoopEngineClass` |
| `engine-knowledge` | `engines/knowledge` | `new KnowledgeManagerClass()` + `await init()`（`knowledgeManager:null` 仍然优先：CLI 侧不建 KM） | — |

- `'require'`（**默认**，只在传了 `host` 时生效）：缺任何一条就抛错（**fail closed**）。错误信息
  列出「缺哪条接缝 + 已注册接缝清单 + 两条修法（在 profile 里启用对应插件／显式传
  `engineSeams:'allow-builtin'`）」。**绝不静默回落门面类**——那会让装配看起来成功、实际是
  「一半引擎来自插件、一半来自内置实现」的混合体。
- `'allow-builtin'`：缺失的接缝回落门面类（等价于改造前行为）。这是**给测试/过渡期的显式
  逃生阀，不是默认值**。
- 不传 `host` 时 `engineSeams` 无效：旧装配路径一行行为都不变，`engineClasses` 五项全 `null`。

> `FlexRunnerController`（`FlexRunner` 是 orchestrator 插件的内部组件，无接缝）与
> `StatsController`（`getSessionSemaphoreStats` 是模块级函数）**仍用门面导入**，这是有意的。

**`buildApp` 不改变进程级活跃宿主**（不调用 `setActiveHost`）：装配点会被反复调用（每个
`RunContext`、每个测试、甚至每次请求），而默认宿主的语义是「一进程一个应用」——在装配点里 set
一次，等于把 `core/hostBridge.js`（`Server/composition/hostBridge.js` 是转发门面）的覆盖守卫
（已有不同默认宿主即抛错）变成随机抛错源。
「让深处消费者看见宿主」是**入口**的职责：`appHost.activateAppHost(options)` 负责
load + 设为默认宿主，返回 `{ host, shutdown }`（`shutdown` 顺序固定：`clearActiveHost()` →
`await host.dispose()`，幂等）。

为什么抽出去：`cli/lib/runner.js`（嵌入式 CLI，不启动 HTTP）装的是同一套引擎，过去两处各写一遍
手工构造，任何参数调整都要同步改两处，且已出现事实漂移。现在两端共用 `buildApp`，差异只通过
选项表达：

| 选项 | server.js | cli/lib/runner.js |
|------|-----------|-------------------|
| `sseHub` | 不传（自建实例） | `null`（不创建；心跳/清理 timer 会拖住 CLI 进程） |
| `knowledgeManager` | 不传（自建并 `init()`） | `null`（知识库按任务惰性创建） |
| `storageOptions` | 不传（`createStorage()`） | `{ rootDir: dataDir }` |
| `skillDirectory` | 不传（`<Server>/Skills`） | `skillDir` |
| `orchestratorSkillDirectory` | 不传（同 `skillDirectory`） | `null`（不注入，保持 `''`） |
| `attachCliArchive` | `false` | `true`（`cli.archive` 指向本 storage 的 SessionStore） |
| `shareCliWithControllers` | `false` | `true`（Brain/TestCheck 复用共享 CLI） |
| `host` | 见下 `pluginHost` | 见 `cli/AGENTS.md` 的 `pluginHost` |

Controller 通过构造函数接收依赖，便于测试时 mock。

## 插件宿主装配与停机（`createServer` 的 `pluginHost`）

`createServer({ pluginHost })` 三态（默认 `'auto'`）：

| 取值 | 行为 | 停机时对宿主做什么 |
|------|------|--------------------|
| `'auto'`（默认） | `activateAppHost({ profile })`：load 宿主 → 设为进程默认宿主 → 交给 `buildApp({ host })` | 宿主由入口**创建**，入口负责 `clearActiveHost()` + `await host.dispose()` |
| `false` | **安全阀**：不装配宿主，`buildApp` 不传 `host`（旧装配路径） | — |
| 宿主实例 | 只做 `setActiveHost(instance)` 激活（不 load、不接管） | **只 `clearActiveHost()` 摘桥，不 dispose** —— 实例的生命周期归调用方 |

> **显式传入的宿主实例，生命周期归调用方；入口只摘桥不销毁。** 调用方交进来的是「已经 load
> 好、也可能还要继续用」的宿主（多入口共享、测试里复用同一宿主做多轮断言），入口把它 dispose
> 掉会让人拿到一个 `host.root === null` 的死人。分流只用一个 `ownsHost` 标志，不是两套清理逻辑。

- `profile` 选项透传给宿主（profile 名或已解析对象）。
- **启动失败不降级**（fail closed）：宿主 load 失败或装配失败都让 `createServer` 抛错、进程失败，
  错误信息里带 `pluginHost:false` 逃生提示。降级会掩盖 profile 配置错误，让服务实际跑在
  「一部分插件能力 + 一部分内置实现」的混合形态上。
- 装好的宿主暴露在 `server.pluginHost`（`pluginHost:false` 时为 `null`），便于运维/测试观测。
- **停机顺序**（`gracefulShutdown`，F-04）：
  `断开 SSE → server.close() → 编排收尾 → 关存储 → 释放插件宿主 → 清硬超时 →（可选）process.exit`。
  最后一步调用 `shutdownHost()`，其顺序固定为
  **`clearActiveHost()` →（仅 `ownsHost` 时）`await host.dispose()`**：先摘桥，避免 dispose 期间
  还有代码解析到一个正在释放（root 已置 null）的宿主；任一步异常只记录日志，不阻断其它清理。

> `Server/composition/` 在发布态 vendor 白名单内（`cli/scripts/prepack.mjs` 的 `CORE_MODULES`），
> CLI 从 `vendor/Server/composition/buildApp.js` 动态加载同一份装配。

## 运行

```bash
# 启动后端服务
node Server/Routes/server.js --port 3000 --type opencode

# 接口列表
#   GET  /api/health        - 大模型健康检查
#   GET  /api/health/ping   - 后端探活
#   GET  /api/health/check  - 健康检查（别名）
```
