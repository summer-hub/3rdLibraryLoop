# @3lib/loop-cli

3rdLibraryLoop 三方库自动化检视命令行工具（嵌入式模式）。

`loop` CLI 直接复用 3rdLibraryLoop 的**核心引擎**（LoopEngine / Brain / Orchestrator /
FlexRunner / TestCheck / Knowledge），无需启动 HTTP 服务，即可从终端完整跑一遍
"任务拆解 → 编排执行 → 准出审核"的大循环。

## 快速开始

```bash
# 环境自检
loop doctor

# 提交并阻塞到准出终态（最常用）
loop run "为 libcurl 生成鸿蒙 demo 场景并跑通编译"

# 提交并立即返回 taskId（进程内继续跑，需保持进程存活）
loop submit "分析 sqlite3 的鸿蒙化可行性"

# 等待到终态 / 查询进度 / 中止 / 列表 / 结果
loop wait <taskId> --timeout 30m
loop progress <taskId> --watch
loop abort <taskId>
loop list --status running
loop result <taskId> --json
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `loop run <desc>` | 提交任务并阻塞到准出终态（默认行为） |
| `loop submit <desc>` | 提交任务，打印 taskId 后进程内继续执行 |
| `loop wait <taskId> [--timeout 30m]` | 等待任务到终态 |
| `loop progress <taskId> [--watch]` | 查询进度；`--watch` 持续轮询到终态 |
| `loop abort <taskId>` | 中止任务 |
| `loop list [--status st] [--limit N] [--older-than 7d]` | 列出任务 |
| `loop result <taskId> [--raw]` | 读取最终结果 |
| `loop step run <desc> [--task-id id] [--step-id N] [--input-report p] [--max-retries N] [--loop N] [--task-dir p]` | 单步执行（FlexRunner 直连，不经拆解/编排/审核） |
| `loop step status <taskId> [--step-id N]` | 查询单步状态/产物/会话 |
| `loop step result <taskId> [--step-id N]` | 读取该步 result.md 内容 |
| `loop orch run <task-def.json>` | 加载任务定义 + 启动编排，阻塞到终态 |
| `loop orch load <task-def.json>` | 仅加载任务定义（落盘 orchestration.json） |
| `loop orch start <taskId>` | 从磁盘恢复 LOADED 状态并启动编排，阻塞到终态 |
| `loop orch progress <taskId> [--loop N]` | 查询编排进度 |
| `loop orch abort|pause|resume <taskId>` | 终止/暂停/恢复编排 |
| `loop orch tasks` | 列出编排任务 |
| `loop doctor` | 环境自检（Node/opencode/.env/SKILL/数据目录） |
| `loop version` | 版本信息 |

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 结构化输出到 **stdout**（进度/日志走 stderr，脚本可安全解析 stdout） |
| `-v, --verbose` | 详细模式 |
| `--quiet` | 仅输出最终结果 |
| `--data-dir <p>` | 数据目录覆盖（默认 `<项目根同级>/db`，如 `D:\code\3rdLibraryLoop` → `D:\code\db`） |
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

`loop step` 直接复用通用单步执行器 **FlexRunner**（不经 Brain 拆解 / Orchestrator
编排 / TestCheck 审核），适合"只跑一个步骤"的精确控制场景：

```bash
# 阻塞执行单个步骤（成功退出码 0，失败 2）
loop step run "为 libcurl 的 HTTP 请求生成 ArkTS demo" \
  --task-id step_demo_001 --step-id 1 --max-retries 2

# 带输入报告 / 指定产物目录 / 指定大循环轮次
loop step run "根据检视报告修复 XTS 用例" \
  --task-id step_fix_001 --input-report output/report.md --loop 1

# 固定执行某个 SKILL（跳过 SkillSelector 匹配，直接使用该 SKILL）
loop step run "为 FastBle 生成 XTS 代码" \
  --task-id step_skill_001 --specified-skill arkts-library-xts-code

# 查询步骤状态或读取最终产物
loop step status step_demo_001
loop step result step_demo_001 --json
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
  `loop list` / `loop progress <taskId>` / `loop result <taskId>` 都能看到该任务。
- **与 `loop run` 的差异**：`run` 走完整大循环（拆解→编排→审核→可重规划，
  自动生成 taskId）；`step` 只执行一步，适合把已拆好的任务按步骤手动串联。
- **中断**：Ctrl+C 会对 FlexRunner 调用 `controlExecution('abort')` 终止当前步骤
  并清理 opencode 子进程，退出码 130。
- **多次执行同一 taskId**：不会归档旧任务（与 `run` 的自动归档不同），
  每次 `step run` 在相同 loop 编号下会覆盖同名产物，建议不同尝试用不同 `--loop`。

## 编排执行（Orchestrator）

`loop orch` 对应 HTTP 层 `POST /api/orchestrator/load` 与 `/api/orchestrator/start`
接口，直接复用 **Orchestrator** 核心类做多步骤依赖编排（不经 Brain 拆解 /
TestCheck 审核）。适合已经把任务拆成步骤、且步骤之间存在 `nextStepId` /
`failStepId` / `dependId` 依赖关系的场景。

```bash
# ① 加载任务定义 + 启动编排并阻塞到终态（推荐入口）
loop orch run task-def-demo.json

# ② 仅加载任务定义（落盘 orchestration.json，进程退出后仍可 start）
loop orch load task-def-demo.json

# ③ 从磁盘恢复 LOADED 状态并启动（跨进程）
loop orch start task_xxx

# ④ 查询 / 控制 / 列表
loop orch progress task_xxx --loop 0
loop orch abort task_xxx
loop orch pause task_xxx     # 恢复：loop orch resume task_xxx
loop orch tasks
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

- **load 可跨进程**：`loop orch load` 会立即落盘 `orchestration.json`
  （状态 `loaded`），之后任何终端/进程都能 `loop orch start <taskId>` 恢复并启动。
- **start 仅接受 LOADED**：任务处于 `completed`/`failed`/`running` 等状态时
  拒绝启动（与 HTTP `controller.start` 校验一致）。
- **progress 读磁盘**：`loop orch progress` 直接读 `orchestration.json` /
  `orchestration_loop{N}.json`，不依赖内存实例，历史轮次可用 `--loop N`。
- **loop.json**：编排结束后写精简状态（`isOrchestration: true`），因此
  `loop list` / `loop result` 也能看到编排任务。
- **中断**：Ctrl+C 会对 Orchestrator 调用 `abort()` 并清理 opencode 子进程，
  退出码 130。
- **跨进程控制限制**：`abort`/`pause`/`resume` 优先作用于**当前进程内**正在
  运行的编排实例；无法中断另一进程的运行中任务（v1 与 `loop run` 语义一致）。

## 环境约定

- **`.env`** 加载链：系统环境变量 > `~/.3lib/.env`（用户级） > 项目根 `Server/.env`。
- **数据目录**：`<项目根同级>/db`（如 `D:\code\3rdLibraryLoop` → `D:\code\db`），与核心引擎默认 workspace 级数据库一致；任务写入 `<数据目录>/task/{taskId}/`。
- **opencode**：`loop` 会自动拉起 `opencode serve`（需在项目**上一级**目录运行），
  退出时负责清理进程树。若已存在运行中的 opencode 服务则直接复用。

## 环境变量

CLI 自身配置（`3LIB_*` 前缀）：

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `3LIB_DATA_DIR` | 数据目录覆盖（等效 `--data-dir`） | `<项目根同级>/db` |
| `3LIB_ROOT` | 项目根覆盖（须为系统环境变量，`.env` 文件不生效） | 自动探测 |
| `3LIB_HOME` | 用户 3lib 主目录（含日志 `logs/`，须为系统环境变量） | `~/.3lib` |
| `3LIB_SKILL_DIR` | SKILL 目录覆盖（等效 `--skill-dir`） | `vendor/Server/Skills` |
| `3LIB_TASK_PREFIX` | taskId 前缀（审计用） | 空 |

Windows 设置方式：

```powershell
# 当前终端临时生效
$env:3LIB_DATA_DIR = "D:\code\tmp\db"
# 用户级永久生效（需重开终端）
setx 3LIB_DATA_DIR "D:\code\tmp\db"
# 或写入 C:\Users\<用户>\.3lib\.env
```

> **注意**：提交用的 `--data-dir` / `3LIB_DATA_DIR` 必须与 `wait`/`progress`/`list`/`result` 一致，
> 否则会出现"任务不存在"。跨终端统一最简单的方式是 `setx 3LIB_DATA_DIR` 一人设全局。

LLM 凭据变量（`DASHSCOPE_API_KEY` / `LLM_MODEL` 等）：按 `.env` 加载链任选一层配置即可。

## 场景一：新用户接入

### 前置条件

- Node.js >= 22
- opencode CLI（`opencode serve` 可运行）
- LLM 凭据（一个 `.env` 即可）

### 接入步骤

```bash
# ① 安装 CLI（正式发布后）
npm i -g @3lib/loop-cli

# 开发期替代：与后端共用仓库时用 npm link（直引 Server/ 源码，无需生成 vendor）
cd cli && npm install && npm link

# ② 环境自检，缺什么看什么
loop doctor

# ③ 配置 LLM 凭据（三选一）
#   A. 项目级：在仓库 Server/.env 填 key（推荐，跟仓库走）
#   B. 用户级：C:\Users\<用户>\.3lib\.env
#   C. 系统环境变量：setx DASHSCOPE_API_KEY "sk-xxx"

# ④ 跑一个最小任务验证
loop run "冒烟：分析一个三方库的鸿蒙化可行性" --max-loops 1
```

数据目录默认在仓库根同级 `<项目根同级>/db`（与核心引擎默认一致，团队同机共享任务数据）；如需每用户隔离，用 `--data-dir` 或 `3LIB_DATA_DIR` 覆盖。

## 场景二：后端更新与软链

### 开发期（仓库内共享）：零副本，直引源码

CLI 在**开发期不生成 `cli/vendor/`**，直接引用仓库 `Server/` 源码：
- 引擎模块回退：`cli/vendor/Server` 不存在时，加载 `../Server`（`runner.js: resolveVendorServer`）。
- SKILL 目录回退：`vendor/Server/Skills` 不存在时，用仓库 `Server/Skills`（`config.js: resolveSkillDir`）。

后端代码改完立即可用，无需任何复制步骤：

```bash
cd cli

# ① npm link 后全局 loop 与本地一致（直引 Server/ 源码）
npm link

# ② 校验 Server/ 源码引入的外部依赖都在 package.json 声明
#    后端新增第三方库时会在这一步暴露，然后 npm install <新依赖> 补上
npm run verify-deps

# ③ 回归冒烟
npm test

# ④ 确认当前用的引擎来源（vendor 缺失时显示源码回退）
loop doctor
```

### 发布期（打包给他人）：临时生成 vendor + 自动清理

发布 tarball 必须自包含引擎（npm `files` 只能打包包内文件），所以发布时才把
`Server/` 快照复制进 `cli/vendor/`，打包完成后自动删除本地副本：

```bash
cd cli
npm version patch        # 0.1.0 → 0.1.1
npm publish              # prepack 自动复制 vendor → 打包 → postpack 自动清理
```

`npm pack` / `npm publish` 的全自动流程：

| 阶段 | 钩子 | 动作 |
|------|------|------|
| 打包前 | `prepack` | 复制 `Server/` → `cli/vendor/Server/`，写 VERSION，扫描敏感文件 |
| 打包中 | — | tarball 包含完整 vendor（自包含引擎） |
| 打包后 | `postpack` | 删除本地 `cli/vendor/`，工作区回归仅一份源码 |

> **不要**手工改动 `cli/vendor/Server/` —— 它是发布期临时生成物，不入库
> （`.gitignore` 已忽略），下次 `npm pack/publish` 会重新生成并自动清理。
> `npm run verify-deps` 同样双模式：有 vendor 扫 vendor，否则回退扫 `Server/` 源码。

## 开发者

```bash
cd cli
npm install
npm link              # 直引仓库 Server/ 源码，无需 prepack
node bin/loop.mjs doctor
```

发布前检查：`npm run verify-deps`（有 vendor 扫 vendor，否则回退扫 `Server/` 源码）
校验引擎代码的依赖声明完整性。