# @ohos-cpf/3rdloop

三方库自动化检视命令行工具：基于 3rdLibraryLoop 核心引擎，从终端完整跑一遍"任务拆解 → 编排执行 → 准出审核"的大循环。

![npm version](https://img.shields.io/npm/v/@ohos-cpf/3rdloop)
![downloads](https://img.shields.io/npm/dm/@ohos-cpf/3rdloop)
![license](https://img.shields.io/npm/l/@ohos-cpf/3rdloop)

## 功能特性

- **嵌入式核心引擎**：直接复用 3rdLibraryLoop 的 LoopEngine / Brain / Orchestrator / FlexRunner / TestCheck / Knowledge，无需启动 HTTP 服务
- **完整大循环**：任务拆解 → 编排执行 → 准出审核，多轮次自动重规划直到通过
- **任务生命周期管理**：提交 / 等待 / 查询进度 / 中止 / 列表 / 读结果
- **单步与固定编排**：`step` 单步执行（FlexRunner 直连）、`orch` 多步骤依赖编排、`workflows` 预置固定工作流一键执行
- **命令行配置**：`config` 子命令管理 `.env` 配置项（默认 `~/.3lib/.env`，跨项目全局生效）
- **自更新**：`update` 一键更新到 npm latest，尊重用户镜像源



## 安装

```bash
npm i -g @ohos-cpf/3rdloop
```

需要 Node.js >= 22。查看版本与环境自检：

```bash
3rdloop version
3rdloop doctor
```



## 使用



### 前置条件

- **Node.js** >= 22
- **opencode CLI**：`3rdloop` 会自动拉起 `opencode serve`（在项目上一级目录运行），退出时清理进程树；已存在则复用
- **LLM 凭据**：以下任一层配置即可
  - 项目级：仓库 `Server/.env`
  - 用户级：`~/.3lib/.env`
  - 系统环境变量：`setx DASHSCOPE_API_KEY "sk-xxx"`



### 快速开始

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



### 命令一览


| 命令                                                                                                                                                         | 说明                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `3rdloop run <desc>`                                                                                                                                       | 提交任务并阻塞到准出终态（默认行为）                           |
| `3rdloop submit <desc>`                                                                                                                                    | 提交任务，打印 taskId 后进程内继续执行                      |
| `3rdloop wait <taskId> [--timeout 30m]`                                                                                                                    | 等待任务到终态                                      |
| `3rdloop progress <taskId> [--watch]`                                                                                                                      | 查询进度；`--watch` 持续轮询到终态                       |
| `3rdloop abort <taskId>`                                                                                                                                   | 中止任务                                         |
| `3rdloop list [--status st] [--limit N] [--older-than 7d]`                                                                                                 | 列出任务                                         |
| `3rdloop result <taskId> [--raw]`                                                                                                                          | 读取最终结果                                       |
| `3rdloop step run <desc> [--task-id id] [--step-id N] [--input-report p] [--max-retries N] [--loop N] [--task-dir p] [--specified-skill <SKILL name|目录名>]` | 单步执行（FlexRunner 直连，不经拆解/编排/审核）               |
| `3rdloop step status <taskId> [--step-id N]`                                                                                                               | 查询单步状态/产物/会话                                 |
| `3rdloop step result <taskId> [--step-id N]`                                                                                                               | 读取该步 result.md 内容                            |
| `3rdloop orch run <task-def.json>`                                                                                                                         | 加载任务定义 + 启动编排，阻塞到终态                          |
| `3rdloop orch load <task-def.json>`                                                                                                                        | 仅加载任务定义（落盘 orchestration.json，进程退出后仍可 start） |
| `3rdloop orch start <taskId>`                                                                                                                              | 从磁盘恢复 LOADED 状态并启动编排，阻塞到终态                   |
| `3rdloop orch progress <taskId> [--loop N]`                                                                                                                | 查询编排进度                                       |
| `3rdloop orch abort|pause|resume <taskId>`                                                                                                                 | 终止/暂停/恢复编排                                   |
| `3rdloop orch tasks`                                                                                                                                       | 列出编排任务                                       |
| `3rdloop workflows`                                                                                                                                        | 列出已注册的固定编排工作流                                |
| `3rdloop run <工作流名> [--flag <值> ...]`                                                                                                                      | 以固定编排执行工作流（阻塞到终态）                            |
| `3rdloop run pr-check --pr-url <URL> [--library-type <arkts|flutter|rn|tpccplus>]`                                                                         | PR 代码检视                                      |
| `3rdloop config list|get|set|unset`                                                                                                                        | 命令配置 `.env` 配置项（默认读写 `~/.3lib/.env`）         |
| `3rdloop update [--check] [--yes] [--force] [--registry <url>]`                                                                                            | 自更新到 npm 最新版（尊重用户镜像源）                        |
| `3rdloop doctor`                                                                                                                                           | 环境自检（Node/opencode/.env/SKILL/数据目录）          |
| `3rdloop version`                                                                                                                                          | 版本信息                                         |


更多进阶用法（`step` 参数细节、`orch` 任务定义格式、工作流注册），见仓库 `cli/README_DEVELOP.md` 或 `3rdloop <子命令> --help`。

### 退出码


| 码   | 含义                                  |
| --- | ----------------------------------- |
| 0   | 通过 / 成功                             |
| 1   | 错误（参数 / 环境 / 任务不存在）                 |
| 2   | 任务执行失败（终态 `failed` / `error` / 未通过） |
| 3   | `wait` 超时                           |
| 130 | Ctrl+C（SIGINT）                      |
| 143 | SIGTERM                             |




## 配置



### 数据目录（中间产物）

任务中间产物默认落在用户级统一目录，跨平台一致、不随执行目录或 npm 卸载变化：

> 默认 `~/.3lib/3rdloop/db`
>
> - Windows: `C:\Users\<用户>\.3lib\3rdloop\db`
> - macOS / Linux: `~/.3lib/3rdloop/db`

任务写入 `<数据目录>/task/{taskId}/`。可用 `--data-dir` flag 或 `3LIB_DATA_DIR` 覆盖（如团队共享目录）。

### 环境变量

CLI 自身配置（`3LIB_*` 前缀）：


| 变量                 | 作用                                | 默认值                  |
| ------------------ | --------------------------------- | -------------------- |
| `3LIB_DATA_DIR`    | 数据目录覆盖（等效 `--data-dir`）           | `~/.3lib/3rdloop/db` |
| `3LIB_ROOT`        | 项目根覆盖（须为系统环境变量，`.env` 文件不生效）      | 自动探测                 |
| `3LIB_HOME`        | 用户 3lib 主目录（含日志 `logs/`，须为系统环境变量） | `~/.3lib`            |
| `3LIB_SKILL_DIR`   | SKILL 目录覆盖（等效 `--skill-dir`）      | 默认按发布/开发状态自动解析       |
| `3LIB_TASK_PREFIX` | taskId 前缀（审计用）                    | 空                    |


LLM 凭据变量（`DASHSCOPE_API_KEY` / `LLM_MODEL` 等）：按上面的 `.env` 加载链任选一层配置即可。

### 命令行配置（3rdloop config）

`config` 子命令对 `.env` 配置项做命令式管理，默认读写用户级 `~/.3lib/.env`（跨项目全局生效），无需手改 `.env` 文件：

```bash
# 查看当前生效的数据目录
3rdloop config get 3LIB_DATA_DIR

# 将任务产物统一存到团队共享目录（全局生效，无需每次带 --data-dir）
3rdloop config set 3LIB_DATA_DIR "D:\code\team\shared-db"

# 查看全部配置项及当前生效值（密钥类脱敏）
3rdloop config list

# 恢复默认
3rdloop config unset 3LIB_DATA_DIR
```

- 读取优先级：**系统环境变量 >** `~/.3lib/.env`**（用户级） > 项目根** `Server/.env` **> 内置默认值**
- `config` 内置白名单与值校验，未知键 `set` 会报错；`DASHSCOPE_API_KEY` / `GIT_TOKEN` 等密钥在 `get`/`list` 中脱敏显示
- `3LIB_ROOT` / `3LIB_HOME` 为系统环境变量专用，`config set` 会拒绝，请用 `setx` / `export`
- `--data-dir` / `--skill-dir` 命令行 flag 仍是最高的单次覆盖



### 环境加载细节

- `.env` **加载链**：系统环境变量 > `~/.3lib/.env` > 项目根 `Server/.env`
- **opencode**：自动拉起 `opencode serve`（项目上一级目录），退出时清理进程树；已存在则复用
- **任务数据隔离**：CLI 任务数据默认与 Web 前端（读取仓库根 `db/`）分离，CLI 提交的任务不会出现在前端任务列表



## API

`3rdloop` 是纯命令行工具，无编程 API。对脚本使用方，输出契约如下：

- **stdout**：只放 `--json` 结构化数据或最终结果（脚本可安全解析）
- **stderr**：进度日志 / 诊断信息
- **退出码**：见 [退出码](#退出码)



### 全局选项


| 选项                | 说明                               |
| ----------------- | -------------------------------- |
| `--json`          | 结构化输出到 **stdout**（进度/日志走 stderr） |
| `-v, --verbose`   | 详细模式                             |
| `--quiet`         | 仅输出最终结果                          |
| `--data-dir <p>`  | 数据目录覆盖（默认 `~/.3lib/3rdloop/db`）  |
| `--project <n>`   | 项目名覆盖（默认取 git 仓库根名）              |
| `--skill-dir <p>` | SKILL 目录覆盖                       |
| `-h, --help`      | 帮助                               |




## 自更新

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

- 以 `npm link` 开发方式安装（连接到仓库源码）时，`update` 默认跳过并提示用 `git pull` 更新源码，加 `--force` 可强制替换为 registry 正式包
- 更新只替换程序文件，**数据目录** `~/.3lib/3rdloop/db` **与** `~/.3lib/.env` **配置不受影响**



## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)（计划中，待补）

## 贡献

欢迎提交 Issue 和 PR，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)（计划中，待补）

## 维护者

[@junxiaoliu927](https://gitcode.com/Sincerelyurs/3rdLibraryLoop)

## 许可证

[MIT](./LICENSE) © 2026 junxiaoliu927