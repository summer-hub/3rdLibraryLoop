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

按使用场景组织：装好之后，先做**环境自检**并完成**必要配置**，然后**快速开启一个任务**；进阶场景（PR 检视/自动提 PR、Web 界面、自更新）按需查阅。

### 场景一：初次使用 —— 环境自检

安装后第一步，先跑环境自检：

```bash
3rdloop doctor
```

`doctor` 会逐项检查 Node / opencode / `.env` 凭据 / SKILL 目录 / 数据目录，缺什么会明确提示。除此之外还需要了解：

- **Node.js** >= 22
- **opencode CLI**：`3rdloop` 会自动拉起 `opencode serve`（在项目上一级目录运行），退出时清理进程树；已存在则复用，一般无需手动管理
- **LLM 凭据**：`doctor` 提示凭据缺失时，见下面"配置"一节

### 场景二：配置 —— 需要注意哪些配置项

绝大多数配置项都有内置默认值，**开箱即用**。只有 LLM 凭据是必配项：

```bash
# 必配：百炼 API Key（从 https://bailian.console.aliyun.com/ 获取，get/list 脱敏显示）
3rdloop config set DASHSCOPE_API_KEY <sk-xxxxxxxx>
```

按需可选（不设置即关闭/自动）：

```bash
# GitCode Token（仅访问私有仓库时需要，get/list 脱敏显示）
3rdloop config set GIT_TOKEN <your-gitcode-token>

# SKILL 目录覆盖（等效 --skill-dir，不设置则自动解析）
3rdloop config set 3LIB_SKILL_DIR </path/to/Skills>
```

有默认值、一般无需改（调整时参考）：

```bash
# LLM 端点（默认百炼 OpenAI 兼容端点，仅切换其他 LLM 服务时修改）
3rdloop config set LLM_BASE_URL https://dashscope.aliyuncs.com/compatible-mode/v1

# LLM 模型 id
3rdloop config set LLM_MODEL glm-5.2

# 默认 CLI 类型（opencode | deveco-code，HarmonyOS 场景切 deveco-code）
3rdloop config set CLI_TYPE deveco-code

# 数据存储目录（默认 ~/.3lib/3rdloop/db，如团队共享目录）
3rdloop config set 3LIB_DATA_DIR "D:\code\team\shared-db"
```

> 其余配置项（`LLM_MAX_TOKENS` / `LLM_ENABLE_THINKING` / `SELECTOR_*` / `MAX_CONCURRENT_SESSIONS` / `OPENCODE_*` / `DEVECO_*`）均有内置默认值，完整清单执行 `3rdloop config list` 查看。`3LIB_ROOT` / `3LIB_HOME` 仅支持系统环境变量（`export` / `setx`），`config set` 会拒绝写入。

配置完成后统一验证：

```bash
3rdloop config list      # 查看全部配置项及当前生效值
3rdloop doctor           # 环境自检
```

凭据也可以不通过 `config` 配置，任选一层即可：系统环境变量（`setx DASHSCOPE_API_KEY "sk-xxx"`）、用户级 `~/.3lib/.env`、项目根 `Server/.env`。

### 场景三：快速开启一个任务

在目标三方库仓库目录下，一句话描述任务，提交并阻塞到准出终态（**最常用**）：

```bash
3rdloop run "为 libcurl 生成鸿蒙 demo 场景并跑通编译"
```

`run` 会自动完成"任务拆解 → 编排执行 → 准出审核"的完整大循环，多轮次自动重规划直到通过；退出码 `0` 即通过。

任务比较耗时、不想干等？提交后立即返回 taskId（进程内继续跑，需保持进程存活），之后可用 `3rdloop progress/wait/result <taskId>` 跟进：

```bash
3rdloop submit "分析 sqlite3 的鸿蒙化可行性"
```

### 场景四：跑预置工作流（PR 检视 / 自动提 PR 等）

常用固定流程已封装为一键工作流，先看有哪些：

```bash
3rdloop workflows                # 列出已注册的固定编排工作流
3rdloop run <工作流名> --help     # 查看某个工作流的参数说明
```

**三方库自动提 PR**（fork 工作区修改 → 源仓库 Issue/PR + 触发 CI）：

```bash
# 最常用：在 fork 仓库克隆目录下直接执行（workspace-dir 缺省取当前目录）
3rdloop run pr-push

# 显式指定工作区与可选参数
3rdloop run pr-push --workspace-dir D:\work\fork-repo --upstream-url https://gitcode.com/CPF-RN/lib \
  --changelog auto --dry-run false
```

> 提 PR 是非幂等发布操作，失败不会自动重试；执行成功后报告 `ohos-lib-pr-push-report.md` 会自动复制到执行目录。先用 `--print-taskdef` dry-run 可以核对将执行的编排定义。

### 场景五：用 Web 界面操作（serve / web）

除了命令行，也可以在浏览器里使用 Web 工作台（提交任务 / 查看循环进度 / PR 检视等），由两个命令提供支撑：

**`3rdloop serve` —— 启动 Server HTTP 后端**（供前端 / 脚本反向代理调用）：

```bash
# 只启动后端（默认 http://127.0.0.1:3000，可用 --port / 3LIB_SERVER_PORT 覆盖）
3rdloop serve

# 后端 + Web 前端一起拉起（前端默认 8080，可用 --web-port / 3LIB_WEB_PORT 覆盖）
3rdloop serve --web
```

> CLI 的 `run`/`submit`/`wait` 等命令保持嵌入式模式，不经此后端；两者可独立使用。

**`3rdloop web` —— 启动 Web 前端服务**（静态托管 + `/api/*` 反代到后端 + 扩展挂载，默认端口 8080）：

```bash
# 启动并自动打开浏览器（--backend 默认指向 http://127.0.0.1:3000，配合 serve 使用）
3rdloop web --open

# 自定义端口 / 后端地址
3rdloop web --port 8081 --backend http://127.0.0.1:3000

# 禁用全部扩展（纯核心工作台模式）
3rdloop web --no-ext
```

扩展机制（tag / issue / prcheck 等二级目录功能以扩展形式按需安装，不随 npm 包分发）：

```bash
3rdloop web install-ext <扩展目录>   # 安装扩展到 ~/.3lib/3rdloop/web-ext/
3rdloop web list-ext                 # 列出可用扩展（含来源与挂载点）
3rdloop web remove-ext <扩展名>      # 移除已安装扩展
```

更多进阶用法（任务管理、`step` 单步执行、`orch` 自定义编排、工作流注册等），见仓库 `cli/README_DEVELOP.md` 或 `3rdloop <子命令> --help`。


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

> 快速上手需要的配置（LLM 凭据等）见上文 [场景二：配置](#场景二配置--需要注意哪些配置项)。本节补充完整的配置参考：数据目录与环境变量清单。

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

LLM 凭据变量（`DASHSCOPE_API_KEY` / `LLM_MODEL` 等）：按上文场景二所述，系统环境变量 / `~/.3lib/.env` / 项目根 `Server/.env` 任选一层配置即可。

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

- 更新只替换程序文件，**数据目录** `~/.3lib/3rdloop/db` **与** `~/.3lib/.env` **配置不受影响**



## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)（计划中，待补）

## 贡献

欢迎提交 Issue 和 PR，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)（计划中，待补）

## 维护者

[@lalhan](https://gitcode.com/lalhanorz)  [@junxiaoliu927](https://gitcode.com/Sincerelyurs)

## 许可证

[MIT](./LICENSE) © 2026 junxiaoliu927