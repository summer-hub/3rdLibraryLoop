# Flutter Interface Analyzer

一个符合 [Agent Skills](https://agentskills.io) 规范的 skill，用于分析 Flutter 三方库的对外接口能力并生成标准化文档。

## 功能特性

- 基于脚本自动提取 Dart 源码接口（`flutter-extract-interfaces.cjs`）
- 自动渲染接口规格说明书 Markdown 文档（`flutter-render-spec-doc.cjs`）
- 支持 Git 仓库克隆（含 Sparse Checkout 稀疏检出）
- 支持 monorepo 多子包结构和 export 链追踪
- 自动过滤私有成员（`_` 前缀）和 export hide/show
- 提取 `///` 文档注释作为功能描述
- 输出 JSON 中间件，可供下游覆盖率分析复用

## 目录结构

```
flutter-interface/
├── SKILL.md                          # Skill 主文件（工作流指令）
├── README.md                         # 本文件
└── references/
    ├── GIT_CLONE_GUIDE.md            # Git Clone 操作指南
    ├── SCRIPT_REFERENCE.md           # 脚本参数与故障排查
    ├── EXAMPLES.md                   # 分析示例
    └── TEMPLATE.md                   # 文档输出模板
```

> 脚本不保存在本 SKILL 内，统一位于仓库的 `MCP/scripts/` 目录（`flutter-extract-interfaces.cjs`、`flutter-render-spec-doc.cjs`），通过相对路径 `{{skillDir}}/../../../MCP/scripts/` 引用。

## 快速开始

### 脚本驱动分析（推荐）

```bash
# 1. 提取接口到 JSON
node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" --repoDir /path/to/flutter_lib --output spec.json

# 2. 渲染为 Markdown 文档
node "{{skillDir}}/../../../MCP/scripts/flutter-render-spec-doc.cjs" --spec spec.json --output 接口规格说明.md
```

### 一步到位

```bash
# 直接从源码生成文档（不保留 JSON 中间件）
node "{{skillDir}}/../../../MCP/scripts/flutter-render-spec-doc.cjs" --libroot /path/to/flutter_lib --output 接口规格说明.md
```

### 从 Git 仓库分析

按照 [SKILL.md](SKILL.md) 中的 Phase 1 执行 Git Clone，然后运行脚本提取接口。

详细的 Git Clone 操作参见 [GIT_CLONE_GUIDE.md](references/GIT_CLONE_GUIDE.md)。

## 核心脚本

| 脚本 | 用途 | 输入 | 输出 |
|------|------|------|------|
| `flutter-extract-interfaces.cjs` | 从 Dart 源码提取接口 | 库源码目录 | interface-spec.json |
| `flutter-render-spec-doc.cjs` | 渲染接口文档 | JSON 或源码目录 | Markdown 文档 |

> 脚本位于仓库的 `MCP/scripts/` 目录（本 SKILL 不保存副本），通过相对路径 `{{skillDir}}/../../../MCP/scripts/` 引用。

脚本详细参数和故障排查参见 [SCRIPT_REFERENCE.md](references/SCRIPT_REFERENCE.md)。

## 分析原则

- **脚本优先**：接口提取由脚本自动完成，AI 不手动逐文件读取源码
- **只分析公开接口**：脚本自动过滤 `_` 前缀私有成员和 export hide/show
- **忠实于源码**：所有接口信息来自脚本解析实际源码，不允许推断或捏造
- **JSON 中间件复用**：`interface-spec.json` 可供下游覆盖率分析复用

## 支持的语言

- **Dart/Flutter**（完整支持，基于 `flutter-extract-interfaces.cjs` 正则解析引擎）
