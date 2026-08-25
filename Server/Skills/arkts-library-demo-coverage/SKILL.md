---
name: arkts-library-demo-coverage
description: 分析鸿蒙ArkTs原生库现有 Demo 对接口的覆盖情况。读取接口规格，扫描 entry/src/main/ets/ 下所有 .ets 文件，通过 AST/正则双层匹配识别已调用的接口，计算接口覆盖率百分比，输出已覆盖和未覆盖接口清单。当需要对鸿蒙原生库进行 demo 接口覆盖率缺口填补、未覆盖接口测试规划时调用。
license: Apache-2.0
compatibility: 需要 Node.js 运行环境
metadata:
  version: "1.0.0"
  category: harmonyos-development
  language: ArkTS/ETS
  useWhen: 分析鸿蒙原生库 Demo 对接口的覆盖情况
---

# 鸿蒙ArkTs原生库 Demo 接口覆盖率分析

本 Skill 直接调用本地脚本分析 Demo 源码对库导出接口的覆盖情况，直接输出最终 Markdown 覆盖率报告。

> ⚠️ **核心约束**：基于静态 import 分析，动态调用（`obj[methodName]()`）无法识别，报告中需标注此限制。

---
## 脚本依赖

本 Skill 直接调用以下本地脚本完成全部分析工作：

```
3rdLibraryLoop/MCP/scripts/analyze-demo-coverage.cjs
```

**调用方式**：通过 `node` 命令行直接执行，使用 `--` 参数传参。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libroot` | string | ✅ | 库源码根目录绝对路径（包含 `library/` 和 `entry/` 子目录） |

**可选参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `spec` | — | 已有的 `interface-spec.json` 路径（由 `extract-interfaces.cjs` 生成）。提供时从 JSON 读取接口规格；未提供时自动从 `libroot` 源码提取 |
| `output` | `02-{库名}-Demo覆盖率报告.md` | 输出 Markdown 报告路径 |
| `mode` | `auto` | 匹配模式：`auto`（AST 优先，降级正则）\| `ast`（强制 AST）\| `regex`（强制正则） |
| `title` | `{库名} Demo 覆盖率分析报告` | 报告标题 |
| `lib` | 从 spec/libroot 自动提取 | 库名覆盖 |
| `src` | `{libroot}/entry/src/main/ets` | Demo 源码目录覆盖 |

**派生变量**：
- `skillDir`：本 Skill 所在目录
- `scriptPath`：分析脚本路径 = `{{skillDir}}/../../../MCP/scripts/analyze-demo-coverage.cjs`

---

## 输入依赖

- **前置SKILL**: ArkTsLibraryInterfaceSpecSkill（可选；若提供 `spec` 参数则使用其生成的 JSON，否则脚本自动从源码提取）
- **输入文件**: 库源码目录（含 `library/` 和 `entry/src/main/ets/`）
- **输出文件**: Markdown 覆盖率报告（脚本直接生成）

---

## 工作流程概览

```
Phase 1: 运行 analyze-demo-coverage.cjs → Phase 2: 确认报告输出
```

> 全程只有一条 `node` 命令，脚本直接输出最终 Markdown 报告，无中间文件，无需清理。

---

## Phase 1：运行 Demo 覆盖率分析脚本

> ⚠️ **脚本一步完成：提取/读取接口规格 + 扫描 Demo 源码 + AST/正则双层匹配 + 生成 Markdown 报告。无中间 JSON 文件。**

运行脚本：

```bash
node "{{skillDir}}/../../../MCP/scripts/analyze-demo-coverage.cjs" \
  --libroot "{{libroot}}" \
  --output "{{outputDir}}/02-{{libName}}-Demo覆盖率报告.md"
```

其中：
- `{{skillDir}}` = SKILL.md 所在目录
- `{{libroot}}` = 库源码根目录（包含 `library/` 和 `entry/` 子目录）
- `{{outputDir}}` = 输出目录（通常与接口规格文档同目录）
- 库名从 `oh-package.json5` 或 spec JSON 自动提取，无需 `--lib` 参数

若已有 `interface-spec.json`，可通过 `--spec` 参数传入避免重复提取：

```bash
node "{{skillDir}}/../../../MCP/scripts/analyze-demo-coverage.cjs" \
  --libroot "{{libroot}}" \
  --spec "{{outputDir}}/{{libName}}-interface-spec.json" \
  --output "{{outputDir}}/02-{{libName}}-Demo覆盖率报告.md"
```

**脚本自动完成**：
1. 获取接口规格（从 `spec` JSON 读取，或从 `libroot` 源码自动提取）
2. 递归扫描 `entry/src/main/ets/` 下的 `.ets` 文件（排除 `entryability/`、`entrybackupability/`、`model/`、`util/`、`ohosTest/` 等非 demo 目录）
3. 提取 import（单行+多行+默认+混合+别名）并追踪实例变量
4. AST 优先匹配（TS Compiler API 语义分析），失败自动降级正则匹配
5. 匹配方法调用、检测对象字面量属性、默认导入命名空间宽松兜底
6. **直接生成最终 Markdown 报告**（含覆盖率统计、按类/按类型分组、已覆盖/未覆盖清单、文件覆盖详情、提升建议）

> ⚠️ **Demo 范围界定**：扫描范围默认 `entry/src/main/ets/`，仅指主工程 demo 页面代码。绝不扩展到 `ohosTest/`、`test/`、`tests/`、`__tests__/`、`testability/` 等测试目录。

**退出码处理**：
- `0` → 成功
- 其他 → 失败，终止流程并标注 `状态: 失败`

---

## Phase 2：确认报告输出

脚本执行完毕后，Markdown 报告已直接生成在 `output` 指定路径（默认为 `02-{库名}-Demo覆盖率报告.md`）。

报告包含以下章节：
1. **基本信息** — 库名、源文件数、生成时间
2. **覆盖率总览** — 方法级覆盖率百分比 + 进度条 + S/N/M 统计
3. **按接口类型统计** — method/property/field/function/variable/enumValue/constructor 分组覆盖率
4. **类级覆盖率** — 每个类/接口的覆盖统计（按覆盖率升序排列）
5. **未覆盖接口详情** — 按类分组，含参数、返回类型、说明
6. **已覆盖接口详情** — 按类分组，含签名和覆盖来源文件
7. **文件覆盖详情** — 每个 Demo 文件覆盖的接口列表
8. **覆盖率提升建议** — 按优先级排列的未覆盖接口补充清单

---

## 注意事项

核心要点：
1. **脚本本地调用** — 全部分析工作由 `node` 直接执行 `analyze-demo-coverage.cjs` 一步完成，禁止 AI 手工解析源码或编写报告表格
2. **AST/正则双模式** — `mode=auto` 时优先使用 TS Compiler API AST 语义分析，TypeScript 模块不可用时自动降级正则匹配
3. **Demo 范围** — 仅 `entry/src/main/ets/`，测试目录自动排除
4. **动态调用限制** — `obj[method]()` 无法识别，报告中标注此限制
5. **无中间文件** — 脚本直接输出最终 Markdown 报告，无需清理
6. **接口规格来源灵活** — 可通过 `--spec` 参数传入已有 JSON，也可不传 `--spec` 让脚本自动从源码提取
7. **库名自动提取** — 默认从 `oh-package.json5` 或 spec JSON 读取，无需手工指定
