# @ohos-cpf/3rdloop

3rdLibraryLoop 三方库自动化检视命令行工具（嵌入式模式）。

`3rdloop` CLI 直接复用 3rdLibraryLoop 的**核心引擎**（LoopEngine / Brain / Orchestrator /
FlexRunner / TestCheck / Knowledge），无需启动 HTTP 服务，即可从终端完整跑一遍
"任务拆解 → 编排执行 → 准出审核"的大循环。

## 快速开始

```bash
# 环境自检
3rdloop doctor

# 提交并阻塞到准出终态（最常用）
3rdloop run "为 libcurl 生成鸿蒙 demo 场景并跑通编译"

# 提交并立即返回 taskId（进程内继续跑，需保持进程存活）
3rdloop submit "分析 sqlite3 的鸿蒙化可行性"

# 等待到终态 / 查询进度 / 中止 / 列表 / 结果
3rdloop wait <taskId> --timeout 30m
3rdloop progress <taskId> --watch
3rdloop abort <taskId>
3rdloop list --status running
3rdloop result <taskId> --json
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `3rdloop run <desc>` | 提交任务并阻塞到准出终态（默认行为） |
| `3rdloop submit <desc>` | 提交任务，打印 taskId 后进程内继续执行 |
| `3rdloop wait <taskId> [--timeout 30m]` | 等待任务到终态 |
| `3rdloop progress <taskId> [--watch]` | 查询进度；`--watch` 持续轮询到终态 |
| `3rdloop abort <taskId>` | 中止任务 |
| `3rdloop list [--status st] [--limit N] [--older-than 7d]` | 列出任务 |
| `3rdloop result <taskId> [--raw]` | 读取最终结果 |
| `3rdloop step run <desc> [--task-id id] [--step-id N] [--input-report p] [--max-retries N] [--loop N] [--task-dir p] [--specified-skill <SKILL name\|目录名>]` | 单步执行（FlexRunner 直连，不经拆解/编排/审核） |
| `3rdloop step status <taskId> [--step-id N]` | 查询单步状态/产物/会话 |
| `3rdloop step result <taskId> [--step-id N]` | 读取该步 result.md 内容 |
| `3rdloop orch run <task-def.json>` | 加载任务定义 + 启动编排，阻塞到终态 |
| `3rdloop orch load <task-def.json>` | 仅加载任务定义（落盘 orchestration.json） |
| `3rdloop orch start <taskId>` | 从磁盘恢复 LOADED 状态并启动编排，阻塞到终态 |
| `3rdloop orch progress <taskId> [--loop N]` | 查询编排进度 |
| `3rdloop orch abort|pause|resume <taskId>` | 终止/暂停/恢复编排 |
| `3rdloop orch tasks` | 列出编排任务 |
| `3rdloop workflows` | 列出已注册的固定编排工作流 |
| `3rd3rdloop run <工作流名> [--flag <值> ...]` | 以固定编排执行工作流（阻塞到终态） |
| `3rdloop run pr-check --pr-url <URL> [--library-type <arkts\|flutter\|rn\|tpccplus>]` | PR 代码检视（等价前端 PR 检视面板，taskId 带 `codecheck_` 前缀） |
| `3rdloop config list\|get\|set\|unset` | 命令配置 `.env` 配置项（默认读写 `~/.3lib/.env`） |
| `3rdloop update [--check] [--yes] [--registry <url>]` | 自更新到 npm 最新版（尊重用户镜像源） |
| `3rdloop doctor` | 环境自检（Node/CLI_TYPE/AI CLI（按类型检测）/.env/SKILL/数据目录/serve 连通性） |
| `3rdloop version` | 版本信息 |

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 结构化输出到 **stdout**（进度/日志走 stderr，脚本可安全解析 stdout） |
| `-v, --verbose` | 详细模式 |
| `--quiet` | 仅输出最终结果 |
| `--data-dir <p>` | 数据目录覆盖（默认 `~/.3lib/3rdloop/db`） |
| `--project <n>` | 项目名覆盖（默认取 git 仓库根名） |
| `--skill-dir <p>` | SKILL 目录覆盖 |
| `-h, --help` | 帮助 |

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 通过 / 成功 |
| 1 | 错误（参数 / 环境 / 任务不存在） |
| 2 | 任务执行失败（终态 `failed` / `error` / 未通过） |
| 3 | `wait` 超时 |
| 130 | Ctrl+C（SIGINT） |
| 143 | SIGTERM |

## 单步执行（FlexRunner）

`3rdloop step` 直接复用通用单步执行器 **FlexRunner**（不经 Brain 拆解 / Orchestrator
编排 / TestCheck 审核），适合"只跑一个步骤"的精确控制场景：

```bash
# 阻塞执行单个步骤（成功退出码 0，失败 2）
3rdloop step run "为 libcurl 的 HTTP 请求生成 ArkTS demo" \
  --task-id step_demo_001 --step-id 1 --max-retries 2

# 带输入报告 / 指定产物目录 / 指定大循环轮次
3rdloop step run "根据检视报告修复 XTS 用例" \
  --task-id step_fix_001 --input-report output/report.md --loop 1

# 固定执行某个 SKILL（跳过 SkillSelector 匹配，直接使用该 SKILL）
3rdloop step run "为 FastBle 生成 XTS 代码" \
  --task-id step_skill_001 --specified-skill arkts-library-xts-code

# 查询步骤状态或读取最终产物
3rdloop step status step_demo_001
3rdloop step result step_demo_001 --json
```

### 参数

| 参数 | 说明 |
|------|------|
| `--task-id <id>` | 任务 ID（**必填**，step 命令不自动生成） |
| `--step-id <N>` | 步骤编号（默认 `1`） |
| `--input-report <p>` | 输入报告/上下文文件路径（可选） |
| `--max-retries <N>` | 最多重试次数（默认 `3`） |
| `--loop <N>` | 大循环轮次编号（默认 `0`） |
| `--task-dir <p>` | 产物目录（默认 `<data-dir>/task/<taskId>`） |
| `--specified-skill <name>` | 固定执行的 SKILL name 或目录名（在 skill 目录内解析）；传入后跳过 SkillSelector 匹配直接执行该 SKILL |

### 行为与差异

- **产物**：写入 taskDir 下 `stepId{n}_loop{L}_result_{R}.md`
  （`R` 为第几次重试），并同时生成
  `stepId{n}_loop{L}_Summary_{R}.md` 经验总结与步骤记录
  `stepid_{stepId}_loop{L}.json`。
- **loop.json**：写精简状态（`isSingleExecution: true`），因此
  `3rdloop list` / `3rdloop progress <taskId>` / `3rdloop result <taskId>` 都能看到该任务。
- **与 `3rdloop run` 的差异**：`run` 走完整大循环（拆解→编排→审核→可重规划，
  自动生成 taskId）；`step` 只执行一步，适合把已拆好的任务按步骤手动串联。
- **中断**：Ctrl+C 会对 FlexRunner 调用 `controlExecution('abort')` 终止当前步骤
  并清理 AI CLI serve 子进程，退出码 130。
- **多次执行同一 taskId**：不会归档旧任务（与 `run` 的自动归档不同），
  每次 `step run` 在相同 loop 编号下会覆盖同名产物，建议不同尝试用不同 `--loop`。

## 编排执行（Orchestrator）

`3rdloop orch` 对应 HTTP 层 `POST /api/orchestrator/load` 与 `/api/orchestrator/start`
接口，直接复用 **Orchestrator** 核心类做多步骤依赖编排（不经 Brain 拆解 /
TestCheck 审核）。适合已经把任务拆成步骤、且步骤之间存在 `nextStepId` /
`failStepId` / `dependId` 依赖关系的场景。

```bash
# ① 加载任务定义 + 启动编排并阻塞到终态（推荐入口）
3rdloop orch run task-def-demo.json

# ② 仅加载任务定义（落盘 orchestration.json，进程退出后仍可 start）
3rdloop orch load task-def-demo.json

# ③ 从磁盘恢复 LOADED 状态并启动（跨进程）
3rdloop orch start task_xxx

# ④ 查询 / 控制 / 列表
3rdloop orch progress task_xxx --loop 0
3rdloop orch abort task_xxx
3rdloop orch pause task_xxx     # 恢复：3rdloop orch resume task_xxx
3rdloop orch tasks
```

### 任务定义 JSON（task-def.json）

格式与 `Orchestrator.loadTask` 对齐：

```json
{
  "taskId": "task_xxx",
  "taskDir": "",
  "skillDirectory": "",
  "loopCount": 0,
  "steps": [
    { "stepId": 1, "taskDescription": "分析三方库接口", "dependId": 0, "nextStepId": 2, "failStepId": 0, "maxRetries": 3 },
    { "stepId": 2, "taskDescription": "生成 demo 场景", "dependId": 1, "nextStepId": 0, "failStepId": 1, "maxRetries": 3 }
  ]
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `taskId` | 任务 ID（必填） |
| `taskDir` | 产物目录（可选，默认 `<data-dir>/task/<taskId>`） |
| `skillDirectory` | SKILL 目录（可选，默认 CLI 解析的 skill-dir） |
| `loopCount` | 大循环轮次（默认 `0`，用于区分各轮产物文件） |
| `steps[].stepId` | 步骤唯一 ID（必填） |
| `steps[].taskDescription` | 步骤任务描述（必填） |
| `steps[].dependId` | 前置依赖（`0`=入口；支持数组做 fan-in 聚合） |
| `steps[].nextStepId` | 成功后下一步（`0`=结束） |
| `steps[].failStepId` | 失败后修复步骤（`0`=失败即终止） |
| `steps[].maxRetries` | 最大重试次数（默认 `3`） |
| `steps[].specifiedSkill` | 固定执行的 SKILL name 或目录名（可选，在 `skillDirectory` 内解析）；传入后该步骤跳过 SkillSelector 匹配直接执行该 SKILL |

### 语义与限制

- **load 可跨进程**：`3rdloop orch load` 会立即落盘 `orchestration.json`
  （状态 `loaded`），之后任何终端/进程都能 `3rdloop orch start <taskId>` 恢复并启动。
- **start 仅接受 LOADED**：任务处于 `completed`/`failed`/`running` 等状态时
  拒绝启动（与 HTTP `controller.start` 校验一致）。
- **progress 读磁盘**：`3rdloop orch progress` 直接读 `orchestration.json` /
  `orchestration_loop{N}.json`，不依赖内存实例，历史轮次可用 `--loop N`。
- **loop.json**：编排结束后写精简状态（`isOrchestration: true`），因此
  `3rdloop list` / `3rdloop result` 也能看到编排任务。
- **中断**：Ctrl+C 会对 Orchestrator 调用 `abort()` 并清理 AI CLI serve 子进程，
  退出码 130。
- **跨进程控制限制**：`abort`/`pause`/`resume` 优先作用于**当前进程内**正在
  运行的编排实例；无法中断另一进程的运行中任务（v1 与 `3rdloop run` 语义一致）。

## 工作流机制（固定编排）

工作流是将"固定步骤编排"封装为带参数的 CLI 命令入口：`3rd3rdloop run <工作流名>` 会在运行时
把参数构造为具参 taskDef，并复用 `3rdloop orch` 链路（`orchLoad` + `orchStart`）阻塞执行到终态。
适合把一组固定的 SKILL 串联（如 `pr push`、`code check` 等）沉淀为可复用命令。

### 使用

```bash
# 查看已注册工作流
3rdloop workflows

# 查看某个工作流的参数说明
3rd3rdloop run <工作流名> --help

# 正式执行（阻塞到终态；退出码 0=通过 / 2=任务失败）
3rd3rdloop run <工作流名> --flag1 <值> --flag2 <值>

# dry-run：只构造并打印/落盘 taskDef，不触碰引擎（调试新工作流用）
3rd3rdloop run <工作流名> --flag1 <值> --print-taskdef
```

- `3rdloop run submit` 同样支持工作流名（命中时走工作流，未命中保持原任务描述语义）
- 产物落默认 `<数据目录>/task/{taskId}/`；`--print-taskdef` 会额外写
  `task-def.dry.json` 供人工核对
- 退出码：`0` 通过 / `1` 参数或环境错误 / `2` 任务执行失败 / `130` Ctrl+C / `143` SIGTERM

### 已注册工作流

- **`pr-check` —— PR 代码检视**（等价封装前端 `Web/public/js/codecheck.js` 的 PR 检视面板）：

```bash
# 按库类型检视 PR（arkts 为默认，不传 --library-type 即可）
3rdloop run pr-check --pr-url https://gitcode.com/owner/repo/pulls/123 --library-type rn

# dry-run：核对构造出的 taskDef 与前端是否等价（不触碰引擎）
3rdloop run pr-check --pr-url https://gitcode.com/owner/repo/pulls/123 --print-taskdef
```

与前端协同的两个约定：

- **taskId 前缀 `codecheck_`**：格式 `codecheck_{owner}_{repo}_{prNum}_{ts36}`，与前端
  `codecheck.js` 一致。前端 PR 检视历史页按 `taskIdPrefix=codecheck_` 过滤，故 CLI 提交的
  检视任务在前端历史页同样可见。
- **SKILL 映射**：`arkts→arkts-code-check`（默认） / `flutter→flutter-code-check` /
  `rn→rn-code-check` / `tpccplus→tpc-cpp-check`，与前端 `_CC_SKILL_MAP` 同构；单步骤
  `specifiedSkill` 固定绑定，`maxRetries: 3`，`title` 格式 `PR检视|{libraryType}|{prUrl}`
  （供前端历史恢复解析）。
- **参数校验**：`--pr-url` 必填；`--library-type` 非法值（非上述四种）在 dry-run 阶段即报错退出。

- **`pr-push` —— 三方库自动提 PR**（绑定 `Server/Skills/ohos-lib-pr-push` SKILL）：

```bash
# 最常用：workspace-dir 缺省取 CLI 命令执行目录（须为 fork 仓库克隆的 git 根）
3rdloop run pr-push

# 显式指定工作区 / 可选参数
3rdloop run pr-push --workspace-dir D:\work\fork-repo --upstream-url https://gitcode.com/CPF-RN/lib

# dry-run：只构造 taskDef 核对（不触碰引擎；SKILL 级 dry-run 用 --dry-run true）
3rdloop run pr-push --workspace-dir D:\work\fork-repo --print-taskdef
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--workspace-dir` | 否（默认 CLI 执行目录） | 本地 fork 仓库克隆的 git 根目录；未传时取 `process.cwd()`，仍须为 git 仓库 |
| `--upstream-url` | 否 | 源仓库（上游）URL；缺省按 SKILL Phase 1.1 推断 |
| `--base-branch` | 否 | PR 目标（上游）分支；缺省先探测上游同名分支，否则上游默认分支 |
| `--branch-name` | 否 | 提交分支名；SKILL 默认使用当前分支，不自动建/切分支 |
| `--commit-message` | 否 | 提交信息；缺省由修改点总结自动生成 |
| `--changelog` | 否 | `auto`(默认)/`true`/`false`，决定是否更新 CHANGELOG |
| `--dry-run` | 否 | SKILL 级 dry-run：`true` 只总结修改点与生成报告，不执行发布 |

与 `pr-check` 的关键差异：

- **`specifiedSkill: 'ohos-lib-pr-push'`，`maxRetries: 0`**：提 PR 是**非幂等**发布操作，
  自动重试可能重复创建 Issue/PR，故恰好执行一次、绝不自动重试（失败恢复由 SKILL 的
  "保留已完成产物编号/链接写入报告"逻辑承担）。
- **`--workspace-dir` 默认 = CLI 执行目录**：未传时对 `process.cwd()` 做 git 仓库校验，
  非 git 仓库报错退出码 1。
- **报告复制（`afterRun` 钩子）**：SKILL 最终报告生成在
  `{workspaceDir}/ohos-lib-pr-push-report.md`；编排**成功后**由 CLI 自动复制到
  执行目录同名文件（目标已存在时先改名备份 `.bak_<ts>`），脚本可在执行目录稳定取报告。
  失败时保留报告在工作区供人工查看。
- **taskId 前缀 `prpush_`**：格式 `prpush_{ts36}{rand8}`，无前端协同页面，仅便于 `list` 过滤。

### 如何新增一个工作流

在 `cli/workflows/` 目录下新增一个 `.js`/`.mjs` 文件，默认导出一个工作流声明对象 **即可自动注册**，
无需改动任何分发代码：

```js
export default {
  name: 'demo prep',               // 工作流名，支持多词（空格分隔，分发时最长匹配）
  description: '示例：构造一个占位固定编排（仅演示注册约定）',
  params: [                        // CLI flags schema（驱动参数校验 / --help）
    { flag: 'workspace-dir', required: true,  describe: '本地工作区 git 仓库根目录' },
    { flag: 'report-name', required: false, describe: '输出报告名（默认 check-report.md）' },
  ],
  // params: { 'workspace-dir': <值>, ... } → 返回与 Orchestrator.loadTask 对齐的 taskDef
  buildTaskDef(params) {
    return {
      taskId: '',                  // 缺省时 CLI 自动生成（generateTaskId()）
      title: 'Demo 固定编排',
      skillDirectory: '',
      loopCount: 0,
      steps: [{
        stepId: 1,
        taskDescription: `分析工作区修改并输出 ${params['report-name'] || 'check-report.md'} 报告`,
        dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 3,
        inputReport: '',
      }],
    };
  },
  // afterRun 可选：编排结束后执行的后置动作（成功/失败均调用；入参含 result.passed；
  // 抛错只记录不改变退出码）。典型场景：把 SKILL 产出的报告复制到 CLI 执行目录。
  async afterRun({ params, taskDef, result, dataDir, cwd }) {
    // 仅在任务成功时动作，失败时产物保留在工作区
    if (result.passed !== true) return;
  },
};
```

约定与细节：

- **周边机制**：`run` 执行分两段——`buildTaskDef`（参数 → taskDef，可 dry-run）与
  `afterRun`（编排后的后置动作）。后者对**成功与失败都会调用**，由工作流自身按
  `result.passed` 决定是否动作；抛出的异常仅记录 stderr，不影响退出码。

- **自动注册**：`cli/lib/workflows.js` 启动时扫描 `cli/workflows/*.mjs|*.js`，每文件默认导出一个工作流。
  加载失败 / name 缺失 / 重名的工作流会被跳过并输出警告（不阻断其余工作流）。
- **多词名最长匹配**：`3rdloop run pr push ...` 会先试完整 `pr push`，未注册再退 `pr`。
- **steps 格式**：与 `3rdloop orch run <task-def.json>` 的 [taskDef 格式](#编排执行orchestrator) 完全一致
  （stepId / taskDescription / dependId / nextStepId / failStepId / maxRetries / specifiedSkill / inputReport）。
- **specifiedSkill 建议**：与核心引擎约定一致——步骤职责能匹配某可用 SKILL 时，把它写入
  `specifiedSkill`（值为 SKILL name 或目录名），执行层将跳过 SkillSelector 自动匹配。
- **只读环境注入**：`buildTaskDef(params, { dataDir, cwd })` 第二参携带运行时环境
  （数据目录、CLI 执行目录等），需要落盘相对路径或"缺省取执行目录"语义时使用。

### 职责边界

- 工作流注册表只负责"参数 → taskDef"。**业务工作流（如 `pr-push`）与所需 SKILL 由其他项目
  开发者按上述约定注册与维护**，CLI 核心不预置通用业务工作流；`pr-check` / `pr-push` 是
  当前仓库内已注册的业务工作流范本，新增业务 SKILL 请放在 `Server/Skills/` 下（沿用既有
  SKILL 约定），工作流文件中以 `specifiedSkill` 引用即可。

## config 配置命令（.env 配置项）

`3rdloop config` 提供对 `.env` 配置项的命令式管理，**默认读写用户级 `~/.3lib/.env`**（跨项目全局生效），无需每次命令携带 flag 或手改 `.env` 文件。

### 子命令

| 子命令 | 作用 |
|--------|------|
| `3rdloop config list` | 列出全部已知配置项及当前生效值（密钥类脱敏） |
| `3rdloop config get <KEY>` | 查看某项当前生效值（密钥类脱敏） |
| `3rdloop config set <KEY> <VALUE>` | 设置某项并写入 `~/.3lib/.env`（密钥不回显） |
| `3rdloop config unset <KEY>` | 删除 `~/.3lib/.env` 中的某项（恢复默认） |

### 读取优先级（与 `.env` 加载链一致）

**系统环境变量 > `~/.3lib/.env`（用户级） > 项目根 `Server/.env` > 内置默认值**。
`config` 命令会模糊识别每项当前来源（`env` / `user-env` / `project-env` / `default`），在 `list`/`get` 输出中标注。

### 白名单与校验

`config` 命令内置全部已知配置键的白名单目录（LLM / Selector / 编排并发 / CLI / GitCode / `3LIB_*`），每项带默认值、说明与校验器（布尔、端口、权重、URL、枚举等）。**未知键 `set` 会报错**列出已知项。`DASHSCOPE_API_KEY`、`GIT_TOKEN` 等密钥类在 `get`/`list` 中脱敏显示。

### 示例：配置默认存储路径

```bash
# 查看当前生效的数据目录（默认 ~/.3lib/3rdloop/db）
3rdloop config get 3LIB_DATA_DIR

# 将任务产物统一存到团队共享目录（全局生效，无需每次带 --data-dir）
3rdloop config set 3LIB_DATA_DIR "D:\code\team\shared-db"

# 确认生效：doctor 数据目录变为该路径，run 产物落 <dir>/task/<taskId>/
3rdloop doctor

# 恢复默认
3rdloop config unset 3LIB_DATA_DIR
```

### 说明

- `3LIB_ROOT` / `3LIB_HOME` 为**系统环境变量专用**（`.env` 写入不生效），`config` 会拒绝 `set`，请用 `setx` / `export` 配置。
- 密钥 `set` 后明文写入 `~/.3lib/.env`（与手写 .env 一致），但 CLI 标准输出不回显明文。
- `--data-dir` / `--skill-dir` 等**命令行 flag 仍是最高的单次覆盖**，不受 `config` 影响。

## 自更新（3rdloop update）

`3rdloop update` 检查 npm registry 上的发布时间，确认后自动重装到最新版：

```bash
# 检查 + 交互确认后更新到 latest
3rdloop update

# 仅检查是否有新版本，不执行更新（适合 CI / 提醒）
3rdloop update --check

# 跳过交互确认直接更新（非 TTY 场景或自动化）
3rdloop update --yes

# 覆盖 npm registry（默认尊重用户 npm 镜像配置，如 npmmirror）
3rdloop update --registry https://registry.npmjs.org/
```

### 更新姿势

| 安装方式 | update 行为 |
|----------|-------------|
| 正式全局安装（`npm i -g @ohos-cpf/3rdloop`） | 检查发现新版本后 `npm install -g @ohos-cpf/3rdloop@latest` 重装 |
| `--check` | 只查询与输出版本差异，不做任何修改 |

### 安全说明

- 所有 npm 调用（`view`/`config get`/`uninstall`/`install`）统一经 `runNpm(args, opts)` 封装。
- **Windows 兼容**：win32 下 `npm` 是 `npm.cmd` 批处理 shim，`execFileSync('npm')` 会因
  CreateProcess 无法执行批处理而抛 `spawnSync npm ENOENT`；`runNpm` 在 win32 用 `shell:true`
  让 cmd.exe 按 PATHEXT 解析 `npm.cmd`，POSIX（macOS/Linux）保持 `shell:false` 直接调用、行为不变。
- **注入防护**：win32 分支对用户可控的 `--registry` 值做 http(s) URL 白名单校验（拒绝空白/引号/
  `&|<>^();%` 等元字符），其余参数均为代码内常量。
- 更新只替换程序文件，**数据目录 `~/.3lib/3rdloop/db`、`~/.3lib/.env` 配置均不受影响**（数据根在设计上不随 npm 包变化）。
- 更新走 `npm install -g` 全量重装，保证引擎与依赖（`@opencode-ai/sdk` / `better-sqlite3` / `dotenv` 等）版本自洽，不手动改动 `node_modules`。
- 更新完成后请用 `3rdloop version` / `3rdloop doctor` 确认新版本与引擎来源。
- 非 TTY 下交互确认自动拒绝，需配合 `--yes` 才能脚本化更新。

## 环境约定

- **`.env`** 加载链：系统环境变量 > `~/.3lib/.env`（用户级） > 项目根 `Server/.env`。
- **数据目录**：`~/.3lib/3rdloop/db`（Windows: `C:\Users\<用户>\.3lib\3rdloop\db`，macOS/Linux: `~/.3lib/3rdloop/db`），跨平台一致、不随执行目录变化、不随 npm 卸载清空；任务写入 `<数据目录>/task/{taskId}/`。
- **AI CLI（`CLI_TYPE`，默认 deveco-code）**：`3rdloop` 会自动拉起对应的 `serve`
  （`deveco serve` / `opencode serve`，需在项目**上一级**目录运行），
  退出时负责清理进程树。若已存在运行中的服务则直接复用。

## 环境变量

CLI 自身配置（`3LIB_*` 前缀）：可用 `3rdloop config set <KEY> <VALUE>` 配置（写入 `~/.3lib/.env`），下表列出默认值。

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `3LIB_DATA_DIR` | 数据目录覆盖（等效 `--data-dir`） | `~/.3lib/3rdloop/db` |
| `3LIB_ROOT` | 项目根覆盖（须为系统环境变量，`.env` 文件不生效） | 自动探测 |
| `3LIB_HOME` | 用户 3lib 主目录（含日志 `logs/`，须为系统环境变量） | `~/.3lib` |
| `3LIB_SKILL_DIR` | SKILL 目录覆盖（等效 `--skill-dir`） | `vendor/Server/Skills` |
| `3LIB_TASK_PREFIX` | taskId 前缀（审计用） | 空 |

推荐用 `3rdloop config` 管理（默认写入 `~/.3lib/.env`）：

```powershell
# 配置默认存储路径（全局生效，无需每次带 --data-dir）
3rdloop config set 3LIB_DATA_DIR "D:\code\team\shared-db"
3rdloop config list          # 查看全部配置项及当前生效值

> **注意**：提交用的 `--data-dir` / `3LIB_DATA_DIR` 必须与 `wait`/`progress`/`list`/`result` 一致，
> 否则会出现"任务不存在"。跨终端统一最简单的方式是 `setx 3LIB_DATA_DIR` 一人设全局。

LLM 凭据变量（`DASHSCOPE_API_KEY` / `LLM_MODEL` 等）：按 `.env` 加载链任选一层配置即可。

## 场景一：新用户接入

### 前置条件

- Node.js >= 22
- AI CLI（`opencode serve` 或 `deveco serve` 可运行，按 `CLI_TYPE`）
- LLM 凭据（一个 `.env` 即可）

### 接入步骤

```bash
# ① 安装 CLI（正式发布后）
npm i -g @ohos-cpf/3rdloop

# 开发期替代：与后端共用仓库时用 npm link（直引 Server/ 源码，无需生成 vendor）
cd cli && npm install && npm link

# ② 环境自检，缺什么看什么
3rdloop doctor

# ③ 配置 LLM 凭据（三选一）
#   A. 项目级：在仓库 Server/.env 填 key（推荐，跟仓库走）
#   B. 用户级：C:\Users\<用户>\.3lib\.env
#   C. 系统环境变量：setx DASHSCOPE_API_KEY "sk-xxx"

# ④ 跑一个最小任务验证
3rdloop run "冒烟：分析一个三方库的鸿蒙化可行性" --max-loops 1
```

数据目录默认在用户三义库主目录 `~/.3lib/3rdloop/db`（跨平台一致，不随执行目录/ npm 卸载变化）；如需自定义位置（如团队共享目录），用 `--data-dir` 或 `3LIB_DATA_DIR` 覆盖。

> **注意**：CLI 任务数据默认与 Web 前端（读取仓库根 `db/`）分离，CLI 提交的任务不会出现在前端任务列表。

## 场景二：后端更新与软链

### 开发期（仓库内共享）：零副本，直引源码

CLI 在**开发期不生成 `cli/vendor/`**，直接引用仓库 `Server/` 源码：
- 核心树解析：`cli/lib/core-paths.js` 四级解析（`3LIB_CORE_DIR` > 已安装核心包 > `cli/vendor` > 仓库根），
  `runner.js` / `serve.js` / `mcp.js` / `config.js` / `doctor.js` 共用同一份结果。
- SKILL 目录：核心树 `Server/Skills`（开发期即仓库 `Server/Skills`），`config.js: resolveSkillDir`。

后端代码改完立即可用，无需任何复制步骤：

```bash
cd cli

# ① npm link 后全局 3rdloop 与本地一致（直引 Server/ 源码）
npm link

# ② 校验 Server/ 源码引入的外部依赖都在 package.json 声明
#    后端新增第三方库时会在这一步暴露，然后 npm install <新依赖> 补上
npm run verify-deps

# ③ 回归冒烟
npm test

# ④ 确认当前用的引擎来源（vendor 缺失时显示源码回退）
3rdloop doctor
```

### 发布期（双包发布）：先核心包，再 CLI 包

核心不再复制进 CLI 包：**仓库根本身就是核心包** `@ohos-cpf/3rdloop_core`
（`Server/ plugins/ core/ seams/ profiles/ MCP/ Archive/ BadCase/` 全部原地保留，
所有相对 import 与接缝路径一字不改），CLI 包只装自己的 `bin/lib/web/workflows`。

```bash
# ① 发布核心包（仓库根）
npm publish

# ② 发布 CLI（cli/）—— dependencies 里带上核心包的版本范围
cd cli && npm publish
```

| 包 | 位置 | 内容 | 示例版本 |
|----|------|------|----------|
| `@ohos-cpf/3rdloop_core` | 仓库根 | 引擎 + 插件内核 + 插件 + 契约 + profile + `MCP/Archive/BadCase` | `0.0.11` |
| `@ohos-cpf/3rdloop` | `cli/` | CLI（`bin/lib/web/workflows`），`dependencies` 声明核心包 | `0.0.11` |

**版本联动**：两者各自独立发版，但 CLI 必须以范围声明核心包（当前 `^0.0.11`）。
注意 `0.0.x` 的 caret 等价于锁 patch（`^0.0.11` = `>=0.0.11 <0.0.12`）：核心包升 patch
后必须同步改 CLI 的依赖范围并重发 CLI；若希望少一次联动，可把范围放宽成
`>=0.0.11 <0.1.0`（代价是允许不兼容的小版本混装）。发完核心包，CLI 侧跑
`npm i && npm test` 再 `npm publish`。

**排障入口**：`3rdloop version`、`3rdloop version --json`、`3rdloop doctor` 都打印
解析到的核心包版本与来源（`核心引擎（@ohos-cpf/3rdloop_core）` 检查项），
版本不匹配一眼可见。

#### 核心树四级解析（`cli/lib/core-paths.js`）

| 级别 | 来源 | 典型场景 |
|------|------|----------|
| ① | 环境变量 `3LIB_CORE_DIR` | 运维/测试指定任意核心树（写错即报错，不静默降级） |
| ② | 已安装 `@ohos-cpf/3rdloop_core`（`node_modules`） | **双包发布态正路** |
| ③ | `cli/vendor`（prepack 产物） | 单包回退 / 离线本地调试 |
| ④ | 仓库根（`cli/` 的上一级） | 开发期直引源码 |

四级都指向同构的「核心树根」（其下有 `Server/ plugins/ core/ seams/ profiles/`），
所以三种形态下相对路径完全一致。四级全落空时，错误信息会逐级列出实测结果，
并给出可照抄的修法（`npm i @ohos-cpf/3rdloop_core` 等）。

#### vendor 现在只是本地工具

`cli/scripts/prepack.mjs` / `clean-vendor.mjs` 保留，但**发布态不再使用 vendor**
（`cli/package.json` 的 `files` 不含 `vendor`，产物不进 tarball）：

| 阶段 | 钩子 | 动作 |
|------|------|------|
| 打包前 | `prepack` | 生成 `cli/vendor/`（核心副本，供四级解析第③级，含 `vendor/Web/public` 前端副本） |
| 打包后 | `postpack` | 删除本地 `cli/vendor/`，并清理历史遗留的 `cli/web/`（前端已并入核心包，该副本已退役），删完断言两者都不存在 |

> `npm run verify-deps` 现在是**三模式**：① 已安装核心包（扫
> `node_modules/@ohos-cpf/3rdloop_core/{Server,MCP/src,Archive/src,plugins,core,seams,profiles}`，
> 比对**核心包 manifest**）② `cli/vendor`（副本，核对口径取已装核心包 → 仓库根 → cli 的遗留单包形态）
> ③ 仓库源码（核心树比对仓库根 `package.json`）。
> 每种模式都额外扫 `cli/{lib,bin,workflows}` 并比对 `cli/package.json`——
> 核心树与 CLI 自身代码**各认自己的 manifest**，`dotenv` 两边都直接 import 因此两边都必须声明。

## 开发者

```bash
cd cli
npm install
npm link              # 直引仓库 Server/ 源码（四级解析第④级），无需 prepack
node bin/3rdloop.mjs doctor
```

发布前检查：`npm run verify-deps`（三模式：已安装核心包 / vendor / 仓库源码）
校验核心树与 CLI 自身代码的依赖声明完整性——核心树比对核心包 manifest，
CLI 代码比对 `cli/package.json`，`dotenv` 因两边都直接 import 而在两个包中各声明一次。