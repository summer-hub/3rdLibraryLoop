---
name: arkts-library-demo-coverage
description: 分析鸿蒙ArkTs原生库现有 Demo 对接口的覆盖情况。读取接口规格，扫描 entry/src/main/ets/ 下所有 .ets 文件，通过 AST/正则双层匹配识别已调用的接口，计算接口覆盖率百分比，输出已覆盖和未覆盖接口清单。当需要对鸿蒙原生库进行 demo 接口覆盖率缺口填补、未覆盖接口测试规划时调用。
license: Apache-2.0
compatibility: 需要 Node.js 运行环境
metadata:
  version: "1.1.0"
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
Phase 1: 运行 analyze-demo-coverage.cjs → Phase 2: 确认报告输出 → Phase 3: 结果合理性校验
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
3. 提取 import（单行+多行+默认+混合+别名，兼容尾斜杠与子路径写法）并追踪实例变量
4. AST 优先匹配（TS Compiler API 语义分析，含库入口文件大小写校准），失败自动降级正则匹配
5. 匹配方法调用、检测对象字面量属性、默认导入命名空间宽松兜底
6. **直接生成最终 Markdown 报告**（含覆盖率统计、按类/按类型分组、已覆盖/未覆盖清单、文件覆盖详情、提升建议）

> ⚠️ **Demo 范围界定**：扫描范围默认 `entry/src/main/ets/`，仅指主工程 demo 页面代码。绝不扩展到 `ohosTest/`、`test/`、`tests/`、`__tests__/`、`testability/` 等测试目录。

**退出码处理**：
- `0` → 成功
- 其他 → 失败，终止流程并标注 `状态: 失败`
- 脚本输出的 `⚠️ [警告]/[提示]`（stderr）不改变退出码，但指示结果可信度问题，必须在 Phase 3 处理

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

## Phase 3：结果合理性校验

> ⚠️ 覆盖率脚本曾有静默失败历史（import 尾斜杠曾导致 0% 误报、入口文件大小写曾导致 ~11 个百分点低估），即使脚本已内置防护，交付前仍须完成本环节校验，禁止直接采信首轮结果。

### 3.1 检查脚本告警

- 控制台出现 `⚠️ [警告]/[提示]/[分析可信度警告]`，或报告头部出现「⚠️ 分析可信度警告」章节时，先按提示排查再采信结果
- 库模块解析失败时脚本会自动放弃 AST 结果、降级正则模式（控制台有明确提示）。正则模式精度低于 AST，交付时应在报告中注明实际匹配模式

### 3.2 覆盖率异常时交叉验证

覆盖率 < 10% 或为 0%，且 Demo 源码确实存在 `import ... from '<库名>'` 时：

1. **抽样 grep 交叉验证**：对报告中「未覆盖」的接口，在 Demo 源码目录统计真实调用数，与报告比对：
   ```bash
   grep -rh "\.方法名(" entry/src/main/ets/ --include="*.ets" | wc -l
   ```
2. **快速诊断口诀**："import 有、覆盖无 → 查 import 尾斜杠；部分漏、变量 any → 查入口文件大小写"
3. **已知历史缺陷与 workaround**（脚本 v1.1 已修复，旧版本脚本仍会触发）：
   - **import 尾斜杠**：Demo 写 `from '@ohos/xxx/'`（尾部带 `/`）曾被全部静默跳过 → 0% 误报。Workaround：复制 `entry/src/main/ets` 到临时目录，sed 去除尾斜杠后通过 `--src` 指向副本
   - **入口文件大小写**：仓库入口为小写 `index.ets` 时，macOS（大小写不敏感文件系统）上 AST 模块解析曾静默失败、库类型坍缩为 `any` → 部分接口漏判。Workaround：复制 libroot（排除 .git）将 `library/index.ets` 重命名为 `Index.ets`，`--libroot` 指向副本。Linux（大小写敏感）上症状不同（existsSync 直接失败走降级逻辑），两者同源

### 3.3 统计口径说明

报告默认排除 `entryability/` 等非 Demo 目录（见 Phase 1 扫描范围）。`EntryAbility` 中的库调用（如 `GlobalContext.setValue` 在 `EntryAbility` 中触发）计入「未覆盖」属口径内合理行为，交付报告时应主动注明，避免读者误判为功能缺失。

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
8. **结果合理性校验** — 覆盖率异常低/为 0 时先做 grep 抽样交叉验证再采信（见 Phase 3）；关注脚本 `⚠️` 告警与报告「分析可信度警告」章节
