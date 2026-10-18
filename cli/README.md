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

`doctor` 会逐项检查 Node / CLI_TYPE 配置 / AI CLI（按 `CLI_TYPE` 检测 opencode 或 deveco）/ `.env` 凭据 / SKILL 目录 / 数据目录 / serve 服务连通性，缺什么会明确提示。除此之外还需要了解：

- **Node.js** >= 22
- **AI CLI**（默认 `deveco`，`CLI_TYPE` 可切 `opencode`）：`3rdloop` 会自动拉起对应的 `serve` 服务（在项目上一级目录运行），退出时清理进程树；已存在则复用，一般无需手动管理
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

# 默认 CLI 类型（默认 deveco-code；如需切回 opencode）
# 切换后 doctor 按新类型检测，run/step/orch/workflow 拉起对应 serve 并连接
3rdloop config set CLI_TYPE opencode

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

> **环境预检**：`run`/`submit`/`step run`/`orch run|start` 及工作流在正式执行前会自动做环境预检（Node 版本 / CLI_TYPE / AI CLI / LLM 凭据 / SKILL 目录 / 数据目录）。任一项不通过直接退出码 `1`，并打印对应修复命令（如 `3rdloop config set DASHSCOPE_API_KEY <sk-xxx>`）；完整自检用 `3rdloop doctor`。`--print-taskdef` 等 dry-run 不预检。

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

### 场景五：用 Web 界面操作（serve）

除了命令行，也可以在浏览器里使用 Web 工作台（提交任务 / 查看循环进度 / PR 检视等）。`3rdloop serve` 一条命令**同时启动** Server HTTP 后端（默认 3000）与 Web 前端（默认 8080，静态托管 + `/api/*` 反代到后端 + 扩展挂载）：

```bash
# 后端（默认 http://127.0.0.1:3000）+ Web 前端（默认 http://localhost:8080）同时启动
3rdloop serve

# 启动后自动打开浏览器
3rdloop serve --open

# 自定义端口（--port 后端 / --web-port 前端，也可用 3LIB_SERVER_PORT / 3LIB_WEB_PORT 覆盖）
3rdloop serve --port 3001 --web-port 8081

# 禁用全部扩展（纯核心工作台模式）
3rdloop serve --no-ext
```

> CLI 的 `run`/`submit`/`wait` 等命令保持嵌入式模式，不经此后端。

扩展机制（tag / issue / prcheck 等二级目录功能以扩展形式按需安装，不随 npm 包分发）：

```bash
3rdloop serve install-ext <扩展目录>   # 安装扩展到 ~/.3lib/3rdloop/web-ext/
3rdloop serve list-ext                 # 列出可用扩展（含来源与挂载点）
3rdloop serve remove-ext <扩展名>      # 移除已安装扩展
```

### 场景六：MCP Gateway 装配（kb 检索 / 覆盖率脚本等 AI 工具）

核心包内置 MCP Gateway（`MCP/`）、知识库检索引擎（`Archive/`）与已知问题知识库种子（`BadCase/`）；CLI 经**核心树四级解析**定位它们（`3LIB_CORE_DIR` > 已安装 `@ohos-cpf/3rdloop_core` > `cli/vendor` > 仓库根），所以安装态的路径是 `<核心包根>/MCP`，而不是 CLI 包内的副本（CLI 包不含 vendor）。opencode / deveco-code serve 需要在**全局配置**注册 Gateway 才会在启动时自动 spawn：

```bash
3rdloop doctor              # 推荐：环境自检，检测到未装配时自动完成装配（幂等）
3rdloop mcp status          # 查看注册状态与数据目录
3rdloop mcp install         # 显式装配/重装（doctor 自动装配的底层命令，可单独使用）
3rdloop mcp uninstall       # 仅移除注册（用户数据保留）

# 可选参数
3rdloop doctor --no-fix               # 仅诊断，不做任何修改
3rdloop mcp install --cli opencode    # 只注册到 opencode（--cli deveco | opencode | all）
3rdloop mcp install --force           # 重置用户级配置为包内默认
```

装配效果：

- `~/.3lib/3rdloop/mcp/config.json` — 用户级 Gateway 配置（脚本/引擎指向包内，随包更新获得新版本）
- `~/.3lib/3rdloop/kb-data/` — 本地知识库数据（`kb_add_document` / `kb_search` 工具，跨版本更新不丢失）
- `~/.3lib/3rdloop/BadCase/` — 已知问题知识库副本（RN 检视 SKILL 消费；泛化 SKILL 的写入落在此处，不污染包目录）
- 装配后**重启 serve**，AI 会话即可调用全部 MCP 工具（kb 检索、覆盖率分析脚本、下游知识库等）

> SKILL 中的分析脚本（如 `analyze-xts-coverage.cjs`）通过 `{{skillDir}}/../../../MCP/scripts/` 相对路径调用，npm 安装态与仓库开发态一致，无需额外配置。装配通常无需手动执行——`3rdloop doctor`（README 快速上手第一步）会自动完成；`run/submit` 等任务命令的预检若发现未装配，仅在 stderr 提示一行（不修改任何文件）。

### 场景七：知识回收（把沉淀的知识打包发给维护者）

任务执行会在本机沉淀知识 JSON（`<dataDir>/Knowledge/` 下的 `index.json` 登记表 + `kn_*.json` 条目）。想贡献给社区/团队，打包发给维护者即可：

```bash
# 用户侧：打包（纯本地操作，不上传任何数据）
3rdloop knowledge export                    # → ./3rdloop-knowledge-<日期>-<主机名>.zip
3rdloop knowledge export --note "mp3agic 批次"  # 附备注

# 维护者侧：收到 zip 后解包到收件箱
3rdloop knowledge import <zip> --dry-run    # 预览
3rdloop knowledge import <zip>              # → ~/.3lib/3rdloop/knowledge-inbox/<来源主机>-<日期>/
```

包内容只有知识 JSON（不含 md / kb 文档 / BadCase）。zip 为标准格式，可先解压自查；多个用户的包在收件箱按 `主机名-日期` 隔离，互不冲突，也不覆盖维护者本地知识库——人工评估后再入库。

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