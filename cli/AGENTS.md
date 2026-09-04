# cli —— 嵌入式引擎 CLI（@ohos-cpf/3rdloop_dev）

本目录是 3rdLibraryLoop 的嵌入式命令行工具包，直接复用 `Server/` 核心引擎
（LoopEngine / Brain / Orchestrator / FlexRunner / TestCheck / Knowledge），
无需启动 HTTP 服务即可从终端跑完整"任务拆解 → 编排执行 → 准出审核"大循环。

> 定位：**嵌入式模式**（`Loop Cli封装计划.md` 方案 A）——单进程内组装核心引擎依赖，
> 仅依赖 AI CLI serve（`CLI_TYPE` 决定 opencode/deveco-code，默认 deveco-code，端口 4096）+ LLM 凭据；
> 上 npm 以 `@ohos-cpf/3rdloop_dev` 发布。

## 目录结构

```
cli/
├── AGENTS.md            # 本文档
├── package.json         # bin: 3rdloop；files: bin/lib/vendor/web/workflows/README.md
├── bin/3rdloop.mjs         # 入口：argv 解析 + 退出码归一（任何异常 → 1）
├── lib/
│   ├── cli.js           # 命令分发（run/submit/step/orch/web/workflows...）
│   ├── config.js        # 环境装配：项目根/.env 链/数据目录/SKILL 目录/taskId
│   ├── config-cmd.js    # 3rdloop config 配置命令（白名单 .env 读写）
│   ├── update.js        # 3rdloop update 自更新（版本检测/卸载旧版/重装）
│   ├── runner.js        # 核心引擎组装（复刻 server.js 依赖注入）+ 执行能力
│   ├── queries.js       # 磁盘直读查询（progress/list/result，不实例化引擎）
│   ├── ui.js            # stdout/stderr 输出契约 + 增量 diff 渲染
│   ├── opencode.js      # AI CLI serve 生命周期管理（opencode/deveco-code，按 CLI_TYPE 选 bin/端口）
│   ├── step.js          # 3rdloop step 单步执行（FlexRunner 直连）
│   ├── orch.js          # 3rdloop orch 多步骤编排（Orchestrator）
│   ├── workflow.js      # 工作流执行器（固定编排入口，本期新增）
│   ├── workflows.js     # 工作流注册表/加载器（目录自动加载，本期新增）
│   ├── serve.js         # 3rdloop serve：同时启动 Server 后端 + Web 前端（含扩展子命令）
│   ├── web.js           # Web 前端服务库（serve 内嵌：静态 + 反代 + 扩展挂载）
│   ├── web-ext.js       # web 扩展机制（manifest 加载 + express 兼容 shim）
│   ├── mcp.js           # 3rdloop mcp：MCP Gateway 装配（install/uninstall/status）
│   ├── knowledge.js     # 3rdloop knowledge：知识打包回收（export/import，人工中转通道）
│   └── exit-codes.js    # 退出码约定
├── workflows/           # 工作流注册目录（每个 .js/.mjs 自动注册一个工作流）
├── scripts/
│   ├── prepack.mjs      # 发布期：复制 Server/ → cli/vendor/Server/、Web/public/ → cli/web/
│   ├── clean-vendor.mjs # 发布后：删除本地 cli/vendor/ 与 cli/web/
│   └── verify-deps.mjs  # 校验引擎 import 的依赖已声明
└── README.md            # 用户文档
```

## 核心机制：依赖注入链（runner.js）

CLI 复用核心引擎的关键是**复刻 `Server/Routes/server.js` 的组装逻辑，但不启动 HTTP**。
`RunContext._init()` 完成依赖注入链：

```
storage(用户数据目录)
  ├─ CLIController(共享, archive 指向本 storage 的 SessionStore)
  ├─ BrainController(注入 cli/orchestratorController/skillDirectory)
  ├─ TestCheck(注入 cli/storage/skillDirectory)
  ├─ LoopEngineController → createLoopEngine()
  └─ orchestratorController.flexRunnerFactory = createOrchestratorFlexRunnerFactory(this)
```

**关键设计（data 错位教训）**：
- 每个 FlexRunner 通过 `createOrchestratorFlexRunnerFactory` 注入**共享** cli/storage/knowledgeManager，
  避免 opencode 会话归档/知识沉淀落到 vendor 相对路径（`cli/db`）。
- 该 factory **必须用普通 function（非箭头）**——Orchestrator 以
  `this.flexRunnerFactory(node, inputReport)` 调用，`this` 即 Orchestrator 实例，
  需访问 `_taskId` / `_loopCount`。

## vendor 双模式

- **开发期**：`npm link` 直引仓库 `Server/` 源码（`resolveVendorServer()` 回退 `../Server`），零副本。
- **发布期**：`prepack` 复制核心模块 → `cli/vendor/Server/` → 打包 → `postpack` 自动删除。
  `.gitignore` 忽略 vendor，手工改动无效（下次打包重新生成）。
- **配套资产随包**（与 vendor/Server 平级，保证 SKILL 相对路径双模式一致）：
  `vendor/MCP`（Gateway + scripts）、`vendor/Archive`（kb 检索引擎 + data 种子）、
  `vendor/BadCase`（已知问题知识库种子）。依赖不装在各自子 package.json（npm 不为包内
  文件安装依赖），统一声明在 cli/package.json，模块解析沿目录树向上命中包内 node_modules。
  SKILL 中 `{{skillDir}}/../../../MCP/scripts/*.cjs`（skillDir = vendor/Server/Skills/<x>）
  与 McpToolGuide 的 `Server/library → ../../MCP/config.json` 在两种模式下同路径解析成功。
- `verify-deps` 双模式扫描（有 vendor 扫 vendor，否则回退源码；范围含 MCP/src + Archive/src）。

## mcp 命令（MCP Gateway 装配）

- 实现：`lib/mcp.js`，分发：`cli.js` `case 'mcp'`（惰性 import）。命令：
  `3rdloop mcp install [--cli opencode|deveco|all] [--force]` / `uninstall [--cli ...]` / `status`。
- **install 三步**：① 生成用户级配置 `~/.3lib/3rdloop/mcp/config.json`（scriptsDir/enginePath
  指向包内绝对路径，knowledgeBase.dataDir 指向 `~/.3lib/3rdloop/kb-data`；已存在仅刷新路径
  字段，保留 downstreamServers 等用户改动，--force 重置）② 种子复制 kb-data（← Archive/data）
  与 BadCase 副本（已存在跳过，保用户数据）③ 注册 `mcp-gateway` 到
  `~/.config/opencode/opencode.json` 与 `~/.config/deveco/deveco.jsonc`（保留其他字段，幂等）。
- **资产定位**：`resolveAssets()` vendor 优先回退仓库（与 resolveVendorServer 同模式），
  开发态 `3rdloop mcp install` 直接用仓库 MCP/。
- **deveco.jsonc 为 JSONC**：readJsonc 容错解析（剥注释重试），失败提示手动处理。
- **doctor 集成（自动装配）**：`3rdloop doctor` 默认 `fix=true`——collectChecks 的「MCP Gateway
  装配」检查（warning: true）未通过时，自动调用 `mcpInstall` 装配并复查回填检查项；`--no-fix`
  仅诊断。装配失败不阻断 doctor（仍为警告级，提示手动 `3rdloop mcp install`）。
- **precheck 零副作用约定**：`precheckEnv`（run/submit/step/orch/workflow 前置）复用同一检查集
  但**不自动装配**——任务命令不得偷偷改用户全局配置；未装配仅在 stderr 提示一行（警告级不阻断）。
- **为什么需要用户级配置**：kb 数据与 BadCase 是可写数据，落包目录会随 npm 更新被清除；
  scripts/engine 是代码，随包走获得更新。注册 command 指向包内入口 + 用户级 config。

## knowledge 命令（知识 JSON 打包回收，人工中转通道）

- 实现：`lib/knowledge.js`，分发：`cli.js` `case 'knowledge'`（惰性 import）。
- **export（用户侧）**：打包 `<dataDir>/Knowledge/` 下全部 JSON（index.json 登记表 +
  kn_*.json 知识条目，**只打 JSON，不含 md/kb-data/BadCase**）→ 单成员 zip
  （内含 payload.json：manifest + knowledgeFiles）。`--note` 备注、`--output` 路径覆盖。
- **import（维护者侧）**：解包到收件箱 `~/.3lib/3rdloop/knowledge-inbox/<来源主机>-<导出日期>/`
  ——多用户包互不冲突、**不覆盖本地 Knowledge 库**，人工评估后自行入库。`--dry-run` 预演。
- **zip 实现**：纯 Node 零依赖（zlib.deflateRawSync + 手写 local header/central
  directory/EOCD）。**坑**：EOCD 的 central directory size 字段必须含文件名长度
  （header 46 + name），否则 python zipfile 报 "Bad magic number for central directory"、
  unzip 报 "12 extra bytes"。
- **Knowledge 目录跟随 `--data-dir`**（npm 安装态默认 ~/.3lib/3rdloop/db/Knowledge；
  仓库开发态可能被 3LIB_DATA_DIR 覆盖到仓库 db/）。

## 输出契约

- **stdout**：只放 `--json` 结构化数据或最终结果（脚本可安全解析）
- **stderr**：进度日志 / 诊断信息
- `cli.js` 顶部 `_redirectStdoutLogs()` 把 Server 内部 `console.log/info` 重定向到 stderr，
  `console.debug` 丢弃，保护 `--json` 通道纯净
- **退出码**：`0` 通过 / `1` 参数或环境错误 / `2` 任务失败 / `3` wait 超时 /
  `130` SIGINT / `143` SIGTERM

## 工作流机制（本次新增）

### 定位

**固定编排 = 预置 taskDef 定义 + CLI flags 参数化 + 复用 orch 链路。**
前端（`Web/public/js/*librarycheck.js`）就是这种模式（硬编码 `_RN_STEP_DEFS` 等
steps 定义 → `POST /api/orchestrator/load` → `start`）。CLI 工作流是其命令行等价物：
`3rdloop run <工作流名> --flag <值>` → 运行时构造具参 taskDef → 复用 `orchLoad` + `orchStart`。

### 运行链路

```mermaid
flowchart LR
    cmd["3rdloop run &lt;workflow&gt; ..."] --> dispatch["cli.js submitAndRunImpl 工作流识别"]
    dispatch --> loader["lib/workflows.js loadWorkflows() 扫描 cli/workflows/*.js"]
    loader --> resolve["resolveWorkflow(workflows, flags.rest) 最长匹配"]
    resolve --> wf["lib/workflow.js cmdWorkflow()"]
    wf --> dry["--print-taskdef dry-run<br/>只构造落盘，不触碰引擎"]
    wf --> orch["runner.orchLoad + orchStart<br/>(复用 orch.js 的进度/信号语义)"]
```

### 工作流文件约定（cli/workflows/*.js）

每个文件默认导出一个对象即可自动注册：

```js
export default {
  name: 'pr push',                 // 多词名，空格分隔；分发时最长匹配
  description: '简述',
  params: [                        // CLI flags schema（驱动校验 / --help）
    { flag: 'workspace-dir', required: true,  describe: '...' },
    { flag: 'upstream-url', required: false, describe: '...' },
  ],
  buildTaskDef(params, env) {      // params: { 'workspace-dir': <值>, ... }
    return {
      taskId: '',                  // 缺省时 CLI 补全（generateTaskId()）
      title: '...',
      skillDirectory: '',
      loopCount: 0,
      steps: [{ stepId: 1, taskDescription: '...', specifiedSkill: '...',
                dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 3, inputReport: '' }],
    };
  },
};
```

- steps 格式与 `3rdloop orch run <task-def.json>` 的 taskDef 完全一致（Orchestrator.loadTask 协议）
- 步骤职责能匹配某可用 SKILL 时写入 `specifiedSkill`（执行层跳过 SkillSelector）
- `buildTaskDef` 第二参 `env` 携带 `{ dataDir }`，需要落盘相对路径时使用

### 命令面

- `3rdloop workflows`：列出已注册工作流（json / 文本）
- `3rdloop run <wf> --help`：打印该工作流参数说明（退出码 0）
- `3rdloop run <wf> ...` / `3rdloop submit <wf> ...`：执行（两者都支持工作流名）
- `3rdloop run <wf> ... --print-taskdef`：dry-run，构造并落盘 `task-def.dry.json`，不触碰引擎

**分发规则**：`submitAndRunImpl` 先用 `loadWorkflows()` + `resolveWorkflow()` 对
`flags.rest` 做最长匹配；**命中 → 转发 cmdWorkflow()；未命中 → 保持原"任务描述"语义**
（向后兼容 `3rdloop run "检视 xxx"` 完全不变）。

### 已知坑 / 实现要点

- **加载失败不阻断**：`loadWorkflows()` 对加载失败/缺 name/重名模块只记 warnings 跳过，
  但所有工作流目录为空时 `3rdloop workflows` 应给指引（退出码 0）。
- **taskId 必填**：`runner.orchLoad` 要求 `taskDef.taskId` 非空；工作流未显式给时，
  执行器在构造后统一补 `generateTaskId() + '_wf'` 后缀。
- **`--print-taskdef` 不触 opencode**：dry-run 分支在 `_ensureOpcodene` 之前返回，
  验收已实测不会拉起/连接 opencode。
- **多词匹配截断**：`resolveWorkflow` 只对连续位置参数前缀匹配（遇 `--flag` 截断），
  避免把 flag 值错当工作流名。
- **未知 flag 报错**：执行器校验 `--print-taskdef` 之外的未声明 flag → 退出码 1。
- **信号处理**：正式执行沿用 orch.js 模式——SIGINT/SIGTERM → `orchControl(abort)` →
  `oc.stop()` 清 opencode 子进程 → 退出 130/143。

### 职责边界（重要）

- **本期只交付机制，不预置业务工作流**（`pr push` 等由其他项目开发者按约定注册）
- **不改动 `Server/Skills/` 下任何 SKILL**；业务 SKILL 归其他开发者维护
- 工作流只做"参数 → taskDef"，执行细节由 `specifiedSkill` 绑定的 SKILL 承载

## 如何新增一个固定编排命令（面向 AI agent）

**一句话**：在 `cli/workflows/` 下新建一个 `.mjs` 文件，默认导出工作流声明对象，自动注册为
`3rdloop run <name>` 命令。零改动分发代码。

**范本**：[`cli/workflows/pr-check.mjs`](workflows/pr-check.mjs) 是最简完整示例，新建工作流时先通读它。

### 第 1 步：新建文件

在 `cli/workflows/` 下新建 `<name>.mjs`（文件名随意，但建议与 `name` 字段一致）。默认导出一个
对象即可自动注册，无需改动 `cli/lib/cli.js` / `workflows.js` / `workflow.js`。

### 第 2 步：声明 name 与 description

- `name`：命令名，用户通过 `3rdloop run <name>` 触发。**用连字符单词**（如 `pr-check`、`pr-push`），
  不用空格分隔多词——连字符写法语义清晰，避免"是否逐级路由"的歧义。
- `description`：一句话简述，供 `3rdloop workflows` 列表与 `--help` 展示。

### 第 3 步：声明 params（CLI flags schema）

`params` 是数组，每项 `{ flag, required, describe }`：

- `flag`：去掉 `--` 前缀的参数名，如 `pr-url`
- `required`：是否必填（缺填时执行器报错退出码 1）
- `describe`：帮助文本

执行器据此做：必填校验、未知 flag 报错、`--help` 渲染。`--print-taskdef` 是框架级 flag，无需声明。

### 第 4 步：实现 buildTaskDef(params, env)

核心职责：把 CLI 参数构造为与 `Orchestrator.loadTask` 对齐的 taskDef 对象。返回值必须包含
`taskId` + 非空 `steps` 数组。

- `params`：`{ 'pr-url': <值>, 'library-type': <值>, ... }`，key 与 `params[].flag` 对应
- `env`：`{ dataDir }`，需落盘相对路径时使用
- 必填参数缺失时主动 `throw new Error(...)`，执行器会捕获并报错退出码 1
- 非法参数值（如不支持的枚举）同样 throw

taskDef 字段约定（与 `3rdloop orch run <task-def.json>` 完全一致）：

```js
return {
  taskId: '',              // 缺省时 CLI 补 generateTaskId()+'_wf'；需与前端协同时自定义前缀
  title: '...',             // 供前端历史页解析（可编码类型/参数）
  skillDirectory: '',      // 留空用默认 Server/Skills
  loopCount: 0,
  steps: [{
    stepId: 1,
    taskDescription: '...',  // 发给 LLM 的任务描述
    dependId: 0,            // 0=无依赖（入口步骤）
    nextStepId: 0,          // 0=成功后无后续
    failStepId: 0,          // 0=失败即终止
    maxRetries: 3,
    skillDirectory: '',
    specifiedSkill: '...',   // 绑定 SKILL（name 或目录名），跳过 SkillSelector 自动匹配
    inputReport: '',
  }],
};
```

### 第 5 步：dry-run 验收

新建工作流后必跑（零 LLM 成本）：

```bash
# 1. 列表能查到
node cli/bin/3rdloop.mjs workflows

# 2. 参数说明正常
node cli/bin/3rdloop.mjs run <name> --help

# 3. dry-run 构造的 taskDef 正确
node cli/bin/3rdloop.mjs run <name> --<必填flag> <值> --print-taskdef

# 4. 缺必填 / 非法值 / 未知 flag → 退出码 1
node cli/bin/3rdloop.mjs run <name> --print-taskdef    # 缺必填
```

验收后清理 dry-run 产物（`<数据目录>/task/<taskId>/task-def.dry.json`）。

### 易踩坑提醒

- **name 用连字符**：`pr-check` 而非 `pr check`。路由是注册表查找式（`resolveWorkflow` 把位置参数
  `join(' ')` 拼字符串查 Map），不是逐级 switch 分发；连字符写法让"一个命令"的语义更清晰。
- **specifiedSkill 要对**：值必须是 `Server/Skills/` 下某 SKILL 的目录名或 frontmatter `name` 字段；
  解析失败会降级为无 SKILL 模式（仍耗 LLM 但不按预期执行）。
- **taskId 前缀与前端协同**：若希望 CLI 提交的任务在前端某历史页可见，taskId 前缀需与前端过滤条件
  一致（如 PR 检视页用 `taskIdPrefix=codecheck_`）。参考 `pr-check.mjs` 的
  `codecheck_{owner}_{repo}_{prNum}_{ts36}` 格式。
- **不改 SKILL**：工作流只做"参数 → taskDef"，执行细节由 `specifiedSkill` 绑定的 SKILL 承载。
  新增业务能力应注册新工作流 + 复用现有 SKILL，不改动 `Server/Skills/`。

## serve 命令（后端 + Web 前端一体启动）

- 实现：`lib/serve.js`（命令编排：后端 + 前端 + 扩展子命令）+ `lib/web.js`（Web 前端服务库）+
  `lib/web-ext.js`（扩展 manifest 加载 + 轻量 express 兼容 shim），分发：`cli.js` `case 'serve'`（惰性 import）。
  后端复用 `Server/Routes/server.js` 的 createServer；前端**进程内启动**（node:http 零新增依赖，
  SSE 反代语义复刻 `Web/server.js`，不再 spawn Web/server.js 子进程）。
- 命令：`3rdloop serve [--port 3000] [--web-port 8080] [--web-root <dir>] [--ext-root <dir>]...
  [--ext <name,...>] [--no-ext] [--open]`；子命令 `install-ext <dir>` / `list-ext` / `remove-ext <name>`。
- **Web 前端随 serve 默认启动**（原独立 `3rdloop web` 命令已移除；`-w/--web` 仅兼容接受并提示；
  用户误输 `3rdloop web` 时 cli.js 给出迁移提示并退出码 1）。
- **典型模式**：仓库内 `node cli/bin/3rdloop.mjs serve` = 后端 + 核心前端 + `Web/ext/` 全部扩展；
  `3rdloop serve --no-ext` = 纯后端操作（仅核心工作台，`--no-ext` 优先于 `--ext`，不受已安装扩展影响）；
  `--ext tag,issue` = 白名单挂载（未发现的名字打 stderr 警告）。
- **设计（方案 A+D）**：核心前端（PR/仓库检视 + loop/knowledge）进 npm 包；tag/issue/prcheck 等
  二级目录功能以"扩展"形式留仓库 `Web/ext/`，**不进包、按需启用**：
  - 前端资产解析：`--web-root` > `3LIB_WEB_ROOT` > 仓库 `Web/public`（开发态）> `cli/web`（prepack 复制的内置副本）
  - 扩展根解析：`--ext-root` > `3LIB_WEB_EXT_ROOT` > 仓库 `Web/ext`（开发态自动全量挂载）> `~/.3lib/3rdloop/web-ext`（用户安装）
  - 扩展数据目录：`<dataDir>/web-ext/<name>`（跟随 `--data-dir`）；扩展同名时先注册者优先（开发态仓库源优先于用户安装）
- 路由优先级：`/api/ext-registry`（本地响应）→ `/<mount>` 扩展（页面/API/静态）→ `/api/*`、`/stream*` 后端反代 → 核心前端静态。
- 启动顺序：Web 前端先监听（端口冲突在后端启动前快速失败）→ 再起 Server 后端；两者端口相同直接报错。
- 扩展协议：`Web/ext/<name>/manifest.json`（name/title/mount/order/server/page）+ `router.cjs`
  （`module.exports.createExtRouter({ express, Database, dbDir, serverRoot, logger })`）+ `public/`。
  shim 仅支持 `get/post/put/patch/delete`（`:param` 路径参数、`req.params/query/body`、
  `res.status/json/send/setHeader/end/sendFile`），**不支持** `router.use`。
- prepack 同步复制 `Web/public → cli/web`（files 白名单含 `web`），postpack（clean-vendor）一并清理；
  `.gitignore` 忽略 `cli/web/`。
- 前端导航：`Web/public/index.html` 的 `#nav-ext-section` + `navigation.js` `ExtNav` 经
  `/api/ext-registry` 动态渲染扩展入口（端点缺失/无扩展时静默隐藏，兼容旧版 `Web/server.js` 纯静态部署）。
- 退出码：常驻服务，SIGINT→130 / SIGTERM→143（信号处理器必须在 createServer **之前**注册，
  否则 Server 内部的退出码 0 处理器会抢先）；端口占用 EADDRINUSE→1。

## 环境预检（precheck，本期新增）

- 实现：`lib/doctor.js`——`collectChecks()`（doctor 与预检共用的检查集，每项含 `fix` 修复提示，
  如 `3rdloop config set DASHSCOPE_API_KEY <sk-xxx>`）+ `precheckEnv()`（预检）+
  `reportPrecheckFailures()`（失败报告打印，各入口共用）。
- **触发命令**（正式执行引擎/LLM 前调用）：`run` / `submit`（含工作流正式执行）、
  `step run`、`orch run` / `orch start`。任一项不通过直接退出码 1（区别于任务失败 2），
  避免环境问题跑到一半才失败、被误报为任务失败。
- **不预检的路径**：`--print-taskdef` dry-run（保持"不触引擎"约定）、`orch load`（仅落盘
  taskDef）、`wait`/`progress`/`list`/`result` 等磁盘查询命令。
- 语义差异（相对 doctor）：serve 未运行**不算失败**（执行命令时会自动拉起；
  端口有响应但异常仍算失败，提示清理残留进程）。
- LLM 凭据检查用**生效环境**（`process.env.DASHSCOPE_API_KEY`，loadEnvChain 已注入
  系统环境变量 > `~/.3lib/.env` > 项目 `Server/.env` 三层），仅强制 `DASHSCOPE_API_KEY`
  （`LLM_BASE_URL`/`LLM_MODEL` 引擎有内置默认值，见 `Server/Agent/SkillSelector/llm/llmClient.js`）。
- doctor 输出同步升级：失败项附加 `修复:` 行（与预检一致），照抄命令即可配置。

## 命令家族

| 层 | 命令 | 复用引擎 |
|----|------|---------|
| 任务生命周期 | `run`/`submit`/`wait`/`progress`/`abort`/`list`/`result` | LoopEngine 全闭环 |
| 单步直通 | `step run`/`status`/`result` | FlexRunner 直连 |
| 固定编排 | `orch run`/`load`/`start`/`progress`/控制/`tasks` | Orchestrator |
| **工作流** | `3rdloop run <wf>`/`3rdloop workflows` | Orchestrator + 注册表 |
| 配置 | `config list/get/set/unset` | ~/.3lib/.env 白名单读写 |
| **MCP 装配** | `mcp install/uninstall/status` | 注册 Gateway 到 AI CLI + 种子复制 kb/BadCase 数据 |
| **知识回收** | `knowledge export/import` | 本地知识打包 zip（用户侧）/ 解包合入（维护者侧） |
| **服务/前端** | `serve`/`serve install-ext|list-ext|remove-ext` | Server 后端 + 静态托管 + 反代 + 扩展挂载 |
| 运维 | `doctor`/`version`/`update` | check-env 维度（按 CLI_TYPE 检测 AI CLI + serve 连通性）+ npm registry |

## 环境约定

- `.env` 加载链：系统环境变量 > `~/.3lib/.env`（用户级） > 项目根 `Server/.env`。
  `loadEnvChain` 必须在任何核心引擎 import 前执行（使 Server 内部 dotenv 变静默 no-op）。
- 数据目录：`~/.3lib/3rdloop/db`（`--data-dir` / `3LIB_DATA_DIR` / `config set 3LIB_DATA_DIR` 可覆盖），任务写
  `<数据目录>/task/{taskId}/`。
- AI CLI（`CLI_TYPE`，默认 deveco-code）：`run`/`step run`/`orch run|start`/`run <工作流>` 的 `cliType`
  统一经 `config.js resolveCliType()` 解析（显式参数 > `CLI_TYPE` env/.env 链 > deveco-code），并传给
  `CLIController` 与 `CliServeManager`（`lib/opencode.js`）：自动拉起 `deveco serve` /
  `opencode serve --port <port>`（项目上一级 cwd，端口取 `OPENCODE_PORT`/`DEVECO_PORT`，默认 4096），
  已运行则复用；退出时清理进程树（Windows 用 `taskkill /pid X /T /F`）。`CLI_TYPE` 写了无效值时
  回退默认值 deveco-code 并 stderr 告警（doctor 会将其报为失败项）。

## config 命令（`.env` 配置项）

- 实现：`lib/config-cmd.js`，白名单 `ENV_KEYS`（key/label/description/default/validate/secret/envOnly）。
- 写入目标：用户级 `~/.3lib/.env`（跨项目全局），`loadEnvChain` 加载它，故 `set` 后立即生效。
- 读取优先级：系统环境变量 > 用户 `~/.3lib/.env` > 项目 `Server/.env` > 内置默认值。
  来源识别：`effectiveValue()` 直接解析各层文件比对（因 `loadEnvChain` 已把所有 `.env` 注入
  `process.env`，无法用 `process.env` 反推来源，必须读文件比对）。
- 密钥脱敏：`DASHSCOPE_API_KEY`/`GIT_TOKEN` 等 `secret:true` 的键在 `get`/`list` 只显示部分，`set` 不回显。
- 易踩坑：
  - `dotenv.parse` 需同步加载：`_dotenv()` 用 `createRequire` 同步 require（`import()` 返回 Promise 会失效）。
  - `~` 展开：`3LIB_DATA_DIR` 等默认值用 `expandHome` 展开成绝对路径。
  - `3LIB_ROOT`/`3LIB_HOME` 是 `envOnly`：`.env` 写入不生效，`config set` 拒绝并提示 `setx/export`。
  - 未知键 set 报错；行级写入保留注释/其他键（`applyEnvKey`/`removeEnvKey`）。

## update 命令（自更新）

- 实现：`lib/update.js`，分发：`cli.js` `case 'update'`（惰性 import）。
- 命令：`3rdloop update [--check] [--yes] [--registry <url>]`。
- 流程：`getCliVersion()`（本地）→ `npm view @ohos-cpf/3rdloop version`（registry，尊重用户镜像，
  失败回退 packument API）→ `compareVersions` 判断 → 交互确认 → 卸载旧版 + `npm install -g ...@latest` 重装。
- registry 覆盖：`--registry` 追加到 `npm view`/`npm install`；默认用 `npm config get registry`
  （兼容 npmmirror 等镜像）。所有 npm 调用统一经 `runNpm(args, opts)` 封装。
- 易踩坑：
  - **不手动改 node_modules**：更新统一走 `npm install -g` 全量重装，保证依赖自洽。
  - **Windows 下 npm 是 `npm.cmd`**：`execFileSync('npm')` 的 CreateProcess 无法执行批处理 shim，
    抛 `spawnSync npm ENOENT`。`runNpm` 在 win32 用 `shell:true`（cmd 按 PATHEXT 解析 npm.cmd，
    已被 cmd.exe 转义防注入），POSIX（macOS/Linux）保持 `shell:false` 直接调用，行为零变化。
  - **`--registry` 注入防护**：`runNpm` 在 win32 分支对 `--registry` 值做 http(s) URL 白名单校验
    （拒绝空白/引号/`&|<>^();%` 等元字符），其余参数均为代码内常量，无用户输入面。
  - **非 TTY 交互确认自动拒绝**：脚本化必须 `--yes`。
  - **`--help` 不联网**：`cmdUpdateImpl` 先处理 `-h/--help` 打印用法后返回，避免无网络环境卡死。
  - 更新只替换程序文件，数据目录 `~/.3lib/3rdloop/db` 与 `~/.3lib/.env` 不受影响。

## 自检清单

改动 cli 后至少验证：语法 `node --check`、`node bin/3rdloop.mjs workflows`、
新工作流 `--help` 与 `--print-taskdef`、缺参/未知 flag 退出码 1、
回归冒烟（后端依赖）`npm run verify-deps` + 现有测试。