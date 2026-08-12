# devecocli (DevEco CLI) 工具使用指南

`devecocli` 是 HarmonyOS 应用开发的统一命令行入口，封装了 ohpm、hvigor、hdc、hilog、emulator 等工具链。本 skill 在编译验证和代码检查中优先使用 devecocli。

> 参考文档：https://gitcode.com/openharmony-sig/deveco-cli#常用命令

## 安装与环境配置

### 安装

```bash
npm install -g @deveco/deveco-cli@latest
```

更新到最新版本：
```bash
devecocli update
```

### 前置要求

- Node.js >= 18（推荐 22+）
- DevEco Studio >= 6.0.0 或 Command Line Tools >= 26.0.0
- macOS：DevEco Studio 安装在 `~/Applications` 或 `/Applications` 目录下

### 环境变量

非默认安装路径或多版本并存时需设置：

| 环境变量 | 用途 | 优先级 |
|---------|------|--------|
| `DEVECO_CLI_STUDIO_PATH` | DevEco Studio 安装根 | 最高 |
| `DEVECO_CLI_CLT_PATH` | Command Line Tools 安装根 | 次之 |

```bash
# macOS 示例
export DEVECO_CLI_STUDIO_PATH="/Applications/DevEco-Studio.app"

# Linux 或自定义 CLT 路径
export DEVECO_CLI_CLT_PATH=/opt/command-line-tools
```

优先级链：`DEVECO_CLI_STUDIO_PATH > DEVECO_CLI_CLT_PATH > Auto_Detect`

---

## 编译验证相关命令

### `devecocli build` — 构建工程

替代 `hvigorw assembleHap`，自动解析模块依赖。

```bash
# 基本构建
devecocli build --product default --build-mode debug

# 指定模块
devecocli build --modules entry library

# release 模式
devecocli build --build-mode release

# 指定模块的 target
devecocli build --modules library@phone
```

| 参数 | 说明 |
|------|------|
| `--product` | 产品名称，默认 `default` |
| `--modules` | 模块名称，格式 `module` 或 `module@target` |
| `--build-mode` | 构建模式，默认 `debug` |

**产物路径**：
- `--product <name>`（无 modules）→ `.app` 包
- `--product <name> --modules <m1>`→ `.hap` / `.hsp` / `.har`
- 具体路径：`entry/build/default/outputs/default/entry-default-signed.hap`

### `devecocli build clean` — 清理构建产物

```bash
devecocli build clean
```

---

## 代码检查相关命令

### `devecocli check lint` — 代码规范检查

检查代码规范并输出实践建议与报告。**这是本 skill 最常用的 devecocli 命令**，用于修改 ArkTS/C++ 代码后快速验证。

```bash
# 检查单个文件
devecocli check lint harmony/src/main/ets/XxxModule.ets

# 检查目录
devecocli check lint harmony/src/main/ets/

# 检查项目根目录（默认）
devecocli check lint

# 自动修复可修复的问题
devecocli check lint harmony/src/main/ets/ --fix

# 仅检查 Git 未提交文件（增量检查）
devecocli check lint --incremental

# 输出 JSON 格式
devecocli check lint --format json

# 输出报告到文件
devecocli check lint --output-path ./lint-report.md
```

| 参数 | 说明 |
|------|------|
| `[path]` | 待检查的文件或目录，默认项目根 |
| `--config-path <path>` | Code Linter 配置文件（.json/.json5） |
| `--fix` | 自动修复可修复的问题 |
| `--incremental` | 仅检查 Git 未提交文件 |
| `--product <name>` | build-profile.json5 中的 product，默认 `default` |
| `--format <default\|json>` | 报告格式；json 需 DevEco Studio >= 6.1.0 |
| `--output-path <path>` | 报告输出路径 |
| `--limit <number>` | 终端显示的问题数量限制 |

> **适用场景**：每次修改 `.ets`/`.cpp` 文件后，用 `devecocli check lint <file>` 快速验证语法是否正确，无需等待全量编译。这在编译错误修复迭代中可大幅节省时间。

### `devecocli check compat` — SDK 兼容性扫描

基于 `apikanalyzer-apiscan` 插件，扫描源代码在两个 SDK 版本之间的 API 变更。

```bash
# 查看可用 SDK 版本
devecocli check compat versions

# 工程级扫描
devecocli check compat --source-version "5.0.1(17)" --target-version "6.0.0(21)"

# 输出 JSON
devecocli check compat --format json --source-version "5.0.1(17)" --target-version "6.0.0(21)"

# 输出报告到目录
devecocli check compat --output-path ./report --source-version "5.0.1(17)" --target-version "6.0.0(21)"

# 文件级扫描（仅 .ets/.c/.cpp）
devecocli check compat ./harmony/src/main/ets/XxxModule.ets \
  --source-version "5.0.1(17)" --target-version "6.0.0(21)"

# 模块级扫描
devecocli check compat --modules entry har1 \
  --source-version "5.0.1(17)" --target-version "6.0.0(21)"
```

| 参数 | 说明 |
|------|------|
| `--source-version` | 必填，当前工程 SDK 版本 |
| `--target-version` | 必填，目标 SDK 版本 |
| `--modules` | 指定模块（与文件参数互斥） |
| `--format` | `default`/`csv`/`json`，默认 `default` |
| `--output-path` | 报告输出路径（目录或文件） |
| `--limit` | 控制台最大记录数，默认 100 |

> **zsh 环境注意**：版本号需用引号包裹（包含括号），如 `"5.0.1(17)"`。

> **适用场景**：升级 RNOH 版本时（如 0.82→0.84 可能涉及 SDK 版本变更），用此命令扫描代码中是否有被废弃或变更的 API 调用。

---

## 运行与调试相关命令

### `devecocli run` — 构建并运行

构建应用后安装到设备/模拟器并启动。

```bash
# 基本运行
devecocli run

# 指定设备和模块
devecocli run --module entry --device 127.0.0.1:5555

# release 模式
devecocli run --build-mode release

# 安装前先卸载
devecocli run --uninstall

# 跳过构建直接安装（需已有构建产物）
devecocli run --skip-build
```

| 参数 | 说明 |
|------|------|
| `--module` | 模块名称，格式 `module` 或 `module@target` |
| `--device` | 设备名称/序列号，多设备时必填 |
| `--product` | 产品名称，默认 `default` |
| `--build-mode` | 构建模式，默认 `debug` |
| `--ability` | 待启动的 Ability |
| `--uninstall` | 安装前先卸载已有应用 |
| `--skip-build` | 跳过构建直接安装 |

### `devecocli log` — 查看日志

查看 hilog 或崩溃日志。

```bash
# 查看错误级别日志
devecocli log --level E

# 按包名过滤
devecocli log --bundle-name com.example.app

# 查看崩溃日志
devecocli log --crash --bundle-name com.example.app

# 关键词过滤
devecocli log --device 127.0.0.1:5555 --level W --keyword Init

# 查看最近 100 行
devecocli log --tail 100 --from 5m --to 2m

# 实时日志
devecocli log --follow --bundle-name com.example.app
```

| 参数 | 说明 |
|------|------|
| `--device` | 设备名称/序列号 |
| `--crash` | 查看崩溃日志 |
| `--level` | 日志级别：D/I/W/E/F |
| `--bundle-name` | 按包名过滤 |
| `--keyword` | 关键词过滤（区分大小写） |
| `--tail <num>` | 显示最新 N 行 |
| `--from` / `--to` | 时间范围（如 `5m`、`30s`） |
| `--follow` | 实时输出（不可与 `--to` 同时使用） |

---

## 设备与模拟器管理

### `devecocli device list` — 查看设备

```bash
devecocli device list
devecocli device list --format json
```

### `devecocli device view` — 设备详情

```bash
devecocli device view
devecocli device view --target 127.0.0.1:5555
```

### `devecocli emulator list` — 查看模拟器

```bash
devecocli emulator list
devecocli emulator list --format json
```

### `devecocli emulator start` — 启动模拟器

```bash
devecocli emulator start Phone
devecocli emulator start Phone1 Phone2
```

> 首次使用需签署许可协议：`devecocli emulator license accept`（非交互式）

### `devecocli emulator create` — 创建模拟器

```bash
devecocli emulator create MyPhone --device-type phone --os-version "HarmonyOS 6.0.1(21)"
```

---

## 签名管理

### `devecocli signature generate` — 自动生成签名

自动生成调试签名材料（p12、csr、p7b、cer），并写入 `build-profile.json5`。

```bash
# 自动生成签名并写入工程配置
devecocli signature generate

# 指定 product
devecocli signature generate --product default

# 指定 team-id
devecocli signature generate --team-id 1222

# 强制覆盖已有证书
devecocli signature generate --force
```

> **适用场景**：新建鸿蒙化工程或签名过期时，用此命令一键生成签名配置，避免手动操作。

---

## UI 调试相关命令

### `devecocli ui layout` — 导出 UI 节点树

```bash
devecocli ui layout
devecocli ui layout --device Phone --format json
devecocli ui layout --mode full --depth 2
devecocli ui layout --id submit_button
```

### `devecocli ui screenshot` — UI 截图

```bash
mkdir -p screenshots
devecocli ui screenshot --device Phone --path ./screenshots
```

### `devecocli ui click` — 点击

```bash
devecocli ui click 100 200
devecocli ui click --id submit_button
```

### `devecocli ui text` — 输入文本

```bash
devecocli ui text "Hello World"
devecocli ui text "Hello World" --id search_box
```

---

## 文档检索

### `devecocli docs search` — 搜索文档

```bash
devecocli docs search List
devecocli docs search '@State' '@Prop' --catalog best-practices --limit 10
devecocli docs search Row Column --format json
```

| 参数 | 说明 |
|------|------|
| `keywords...` | 搜索关键词，空格分隔 |
| `--catalog` | 文档类别：harmonyos-releases/guides/references/best-practices/faqs/roadmap/all |
| `--format` | `default`/`json` |
| `--limit` | 返回条数，默认 10 |

### `devecocli docs read` — 读取文档

```bash
devecocli docs read <documentId>
```

> **适用场景**：适配过程中需要查阅鸿蒙 API 文档时，可用 `devecocli docs search` 替代网页搜索。

---

## MCP 代码分析服务

`devecocli` 提供 MCP（Model Context Protocol）服务，可通过 MCP 协议调用代码分析工具。

### 配置 MCP 服务

```bash
# 自动配置到当前 Agent（如已安装 devecocli skill）
devecocli init --mcp --project ./MyApp

# 或手动配置 MCP
devecocli serve mcp
```

MCP 配置示例：
```json
{
  "mcp": {
    "deveco-mcp": {
      "type": "local",
      "command": ["devecocli", "serve", "mcp"],
      "environment": {
        "PROJECT_PATH": "/path/to/project",
        "NODE_MAX_OLD_SPACE_SIZE": "8192"
      },
      "enable": true
    }
  }
}
```

### MCP 工具一览

| 工具 | 用途 | 支持语言 |
|------|------|---------|
| `check` | 静态语法分析，返回结构化诊断信息 | ArkTS、C/C++ |
| `hover` | 获取位置的悬浮信息（类型、文档） | ArkTS、C/C++ |
| `definition` | 查找符号定义位置 | ArkTS、C/C++ |
| `declaration` | 查找符号声明位置 | ArkTS、C/C++ |
| `references` | 查找符号全工程引用 | ArkTS、C/C++ |
| `implementation` | 查找符号实现（如接口实现） | ArkTS、C/C++ |
| `workspaceSymbol` | 按名称全工程搜索符号 | ArkTS、C/C++ |
| `documentSymbol` | 获取单文件符号树 | ArkTS、C/C++ |
| `callHierarchy` | 查询函数调用关系（incoming/outgoing） | ArkTS 双向、C/C++ 仅 incoming |
| `restart` | 原地重启 MCP server | — |

### MCP 工具使用要点

**`check` 工具**（最常用）：
- 入参：`files`（文件路径数组，相对工程根目录）
- 支持 `.ets` 和 C/C++ 扩展名（`.c`/`.cpp`/`.h`/`.hpp` 等）
- 可混合传入 ArkTS 和 C/C++ 文件
- 返回结构化诊断信息

**语言特性工具**（`hover`/`definition`/`references` 等）：
- 入参：`file`（文件路径）、`line`（0-based 行号）、`character`（0-based 列号）
- 需项目进入 `READY` 状态（ohpm install + hvigor sync + LSP 初始化完成）后才可用
- 未就绪时返回 `please retry in N seconds`

**`callHierarchy` 工具**：
- 入参：`file`、`line`、`character`、`direction`（`incoming`/`outgoing`）
- `incoming` = 谁调用了该函数
- `outgoing` = 该函数调用了谁
- ArkTS 支持双向，C/C++ 仅 `incoming`

**`restart` 工具**：
- 用于 MCP server 从 `ERROR` 态恢复
- 调用后返回"约 10 秒后重试"，后台异步重置
- **禁止**循环调用 restart；若重启后再次失败，说明是持久性配置问题

### 支持的文件扩展名

| 语言 | 扩展名 |
|------|--------|
| ArkTS | `.ets` |
| C/C++ | `.c` `.cc` `.cpp` `.cxx` `.c++` `.h` `.hh` `.hpp` `.hxx` `.h++` `.ipp` `.ixx` `.inl` `.inc` `.tpp` |

---

## devecocli 不可用时的回退方案

如果 `devecocli` 未安装或不可用，回退到直接使用底层工具：

| devecocli 命令 | 回退命令 | 工具路径（macOS） |
|---------------|---------|-----------------|
| `devecocli build` | `hvigorw assembleHap --no-daemon --mode module -p product=default` | `/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw` |
| `devecocli check lint` | 无直接替代（需 DevEco Studio GUI 或手动检查） | — |
| `devecocli run` | `hdc install <hap>` + `hdc shell aa start ...` | `/Applications/DevEco-Studio.app/Contents/tools/hdc/bin/hdc` |
| `devecocli log` | `hdc shell hilog` | 同上 |
| `devecocli signature generate` | 手动通过 DevEco Studio GUI 生成 | — |
| `ohpm install` | 直接 `ohpm install` | `/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm` |

**检查 devecocli 是否可用**：
```bash
which devecocli && devecocli --version
```
