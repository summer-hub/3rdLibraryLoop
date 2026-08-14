---
name: arkts-library-demo-coverage
description: 分析鸿蒙原生库现有 Demo 对接口的覆盖情况。读取接口规格文档，扫描 entry/src/main/ets/ 下所有 .ets 文件，通过 import 语句匹配识别已调用的接口，计算接口覆盖率百分比，输出已覆盖和未覆盖接口清单。当需要对鸿蒙原生库进行 demo 接口覆盖率缺口填补、未覆盖接口测试规划时调用。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "2.3.0"
  category: harmonyos-development
  language: ArkTS/ETS
---

# 鸿蒙ArkTs原生库 Demo 接口覆盖率分析

本 Skill 读取接口规格文档和现有 Demo 源码，分析 Demo 对导出接口的覆盖情况，输出覆盖率报告。

> ⚠️ **核心约束**：基于静态 import 分析，动态调用（`obj[methodName]()`）无法识别，报告中需标注此限制。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `interfaceSpecPath` | ✅ | 接口规格文档绝对路径（由 ArkTsLibraryInterfaceSpecSkill 生成） |
| `sourcePath` | ✅ | 克隆后的源码根目录绝对路径（如 `{outputDir}/source`） |

---

## 工作流程

### 步骤 1：解析接口规格文档

> ⚠️ **本步骤由 `parse-spec.cjs` 脚本自动完成，无需 AI 手工解析 Markdown 表格。**

**操作：**

运行 `parse-spec.cjs` 脚本（位于 SKILL.md 同目录的 `scripts/` 子目录下）：

```bash
node "{{skillDir}}/scripts/parse-spec.cjs" --spec "{{interfaceSpecPath}}" --output "{{interfaceSpecDir}}/arkts-demo-interfaces.json"
```

其中：
- `{{skillDir}}` = SKILL.md 所在目录
- `{{interfaceSpecDir}}` = 接口规格文档所在目录

**脚本功能：**
1. 从接口规格文档摘要行提取 N（方法级总数）、S（类级总数）、M（Native 数量）
2. 逐章节解析 Markdown 表格（类/接口/函数/变量），提取每个方法级接口项
3. 自动判断 `kind`（method/property/field/function/variable）和 `isStatic`；构造函数和枚举自动跳过
4. 输出 `arkts-demo-interfaces.json`，校验条目总数 == 摘要行 N
5. 若不一致，打印警告但继续输出（以表格实际行数为准）

**脚本输出 JSON 格式：**

```json
[
  {"className": "ImageKnife", "memberName": "getInstance", "fullName": "ImageKnife.getInstance", "kind": "method", "isStatic": true, "type": "class", "signature": "static getInstance(): ImageKnife", "description": "获取ImageKnife单例"},
  {"className": "ImageKnifeOption", "memberName": "loadSrc", "fullName": "ImageKnifeOption.loadSrc", "kind": "property", "isStatic": false, "type": "class", "signature": "loadSrc: string | PixelMap | Resource", "description": "主图资源，必须设置"},
  {"className": "HeaderOptions", "memberName": "key", "fullName": "HeaderOptions.key", "kind": "field", "isStatic": false, "type": "interface", "signature": "key: string", "description": "HTTP请求头键名"},
  {"className": null, "memberName": "functionName", "fullName": "functionName", "kind": "function", "isStatic": false, "type": "function", "signature": "functionName(param: Type): ReturnType", "description": "功能描述"}
]
```

> ⚠️ 若脚本退出码为 2（警告），说明上游接口规格文档的摘要行 N 与实际表格行数不一致。此时以脚本输出的 JSON 条目数为准，在下游覆盖率报告中标注此偏差。若退出码非 0 且非 2，说明解析失败，终止流程并在报告中标注 `状态: 失败`。

---

### 步骤 2：运行覆盖率匹配脚本

> ⚠️ **此步骤完全自动化，无需人工 grep 或逐行解析。脚本自动处理单行 import、多行 import、库名过滤、非 demo 文件排除。**

> ⚠️ **Demo 范围界定（重要，v2.3.0）**：扫描范围默认 `entry/src/main/ets/`，**仅指主工程 demo 页面代码**。绝对不要将范围扩展到 `entry/src/ohosTest/`（XTS 单元测试目录）或任何 `test/`、`tests/`、`__tests__/`、`testability/` 目录——这些是测试代码而非 demo，混入会让接口覆盖率虚高。若任务描述使用"demo 代码（.ets 与 .ts 文件）"等宽泛表述，应默认按 `entry/src/main/ets/` 解释；只有在任务明确要求统计测试覆盖时才例外。`coverage-match.cjs` 已在脚本层面对这些测试目录做了双重排除（顶层黑名单 + 递归目录名黑名单），即使误传 `--src entry/src` 也不会混入测试文件。

**操作：**

运行 `coverage-match.cjs` 脚本（位于 SKILL.md 同目录的 `scripts/` 子目录下）：

```bash
node "{{skillDir}}/scripts/coverage-match.cjs" --interfaces "{{interfaceSpecDir}}/arkts-demo-interfaces.json" --src "{{sourcePath}}/entry/src/main/ets" --lib "{{库名}}" --output "{{interfaceSpecDir}}/coverage-result.json"
```

其中：
- `{{skillDir}}` = SKILL.md 所在目录（`coverage-match.cjs` 位于其下 `scripts/` 子目录）
- `{{interfaceSpecDir}}` = 接口规格文档所在目录（中间文件和最终报告均保存在此目录）
- `{{库名}}` = 库名称（从步骤 1 脚本输出中提取，如 `@ohos/imageknifepro`）。也可从接口规格文档的 `# {库名} 接口规格说明` 标题提取
- `{{sourcePath}}` = 任务参数 `sourcePath`

**脚本功能（方法级）：**
1. 读取方法级接口清单 JSON（每项含 className、memberName、fullName、kind、isStatic、type）
2. 递归扫描 `entry/src/main/ets/` 下所有 `.ets` 文件
3. 正则提取 `import { ... } from 'lib'` 语句（**自动处理单行 + 多行 import**），确定文件中可用的类
4. 对每个已导入的类，检测其方法在文件中的调用情况：
   a. **静态方法/属性**：`ClassName.methodName(` 或 `ClassName.propertyName`（不含枚举值模式）
   b. **构造函数**：`new ClassName(`
   c. **实例方法**：追踪变量声明（`let/const/var x: ClassName =` 或 `x = new ClassName(` 或 `x = ClassName.getInstance()`），然后匹配 `x.methodName(`
   d. **链式调用**：`ClassName.getInstance().method1().method2()` → 标记 method1、method2 为已覆盖
   e. **枚举值**：`EnumName.MEMBER_NAME`（精确匹配完整模式）
   f. **独立函数/变量**：直接在文件内容中匹配 `functionName(` 或变量名引用
5. 将匹配到的方法标记为已覆盖，输出方法级覆盖率 JSON

> 补充：脚本还自动检测**对象字面量属性使用**。对于未通过 import+方法调用匹配到的 `property`/`field`，脚本会搜索 demo 文件中 `memberName:` 模式（对象字面量 key），匹配则计为已覆盖。这解决了 ArkTS 声明式 UI 中配置项以对象字面量传递而不需要 import 对应类的问题。

**脚本输出 JSON 结构：**

```json
{
  "libraryName": "@ohos/imageknifepro",
  "totalInterfacesClassLevel": 40,
  "totalInterfacesMethodLevel": 240,
  "coveredMethodCount": 228,
  "coverageRateMethodLevel": "95.00",
  "byKind": {
    "method":     { "total": 41,  "covered": 31,  "rate": "75.61" },
    "property":   { "total": 136, "covered": 130, "rate": "95.59" },
    "field":      { "total": 63,  "covered": 39,  "rate": "61.90" },
    "function":   { "total": 0,   "covered": 0,   "rate": "-" },
    "variable":   { "total": 0,   "covered": 0,   "rate": "-" }
  },
  "classCoverage": [
    { "className": "BleManager", "total": 55, "covered": 10, "uncovered": 45, "rate": "18.18" },
    { "className": "BleDevice", "total": 17, "covered": 3, "uncovered": 14, "rate": "17.65" }
  ],
  "covered": [
    { "fullName": "BleManager.getInstance", "className": "BleManager", "memberName": "getInstance", "kind": "method", "isStatic": true, "type": "class", "files": ["001_ScanAndScanStatePage.ets"] }
  ],
  "uncovered": [
    { "fullName": "BleManager.scan", "className": "BleManager", "memberName": "scan", "kind": "method", "isStatic": false, "type": "class" }
  ],
  "fileCoverage": [
    { "file": "001_ScanAndScanStatePage.ets", "count": 4, "interfaces": ["BleScanner.getInstance", "BleScanner.getScanState", "BleScanState.STATE_IDLE", "BleScanState.STATE_SCANNING"] }
  ],
  "demoFileCount": 114,
  "multiLineImportFiles": ["TestDesiredSizeDecode.ets", "ComponentWrapperV2.ets"]
}
```

运行完成后，使用 `read_file` 读取 `coverage-result.json`，获取全部覆盖率数据。

> **多行 import 已由脚本自动处理**：脚本使用 `[^}]*` 正则跨行匹配 `import { ... } from`，无需人工补齐。`multiLineImportFiles` 字段记录哪些文件包含多行 import，供报告参考。

> **排除非 demo**：脚本自动排除 `ets/entryability/`、`ets/entrybackupability/`、`ets/model/`、`ets/util/` 顶层目录的文件，以及 `Index.ets`。`pages/model/`、`pages/component/` 等子目录不排除（属于 demo 范畴）。

> **PowerShell 兼容**：所有文件操作由 Node.js 脚本完成，不依赖 CMD `findstr`/`dir`/`del` 命令，无需考虑 PowerShell 5.1 兼容性问题。

---

### 步骤 3：计算覆盖率

> 此步骤已由脚本完成。直接从 `coverage-result.json` 读取以下数据：

1. **覆盖率（方法级）** = `coveredMethodCount` / `totalInterfacesMethodLevel` × 100%（脚本已计算 `coverageRateMethodLevel`）
2. **覆盖率（类级参考）** = 已覆盖类数 / 类级总数 × 100%（供参考，非主指标）
3. **按类别方法级覆盖率** = `byKind` 字段
4. **已覆盖方法清单** = `covered` 字段
5. **未覆盖方法清单** = `uncovered` 字段
6. **按类分组覆盖率** = `classCoverage` 字段
7. **每个 Demo 的方法覆盖详情** = `fileCoverage` 字段
8. **Demo 文件总数** = `demoFileCount` 字段

---

### 步骤 4：生成覆盖率报告

生成 `{接口规格文档同目录}/arkts-demo-coverage-report.md`：

```markdown
# {库名} Demo 接口覆盖率报告

## 1. 概述

- 库名称：{库名}
- 接口规格总数（类级）：{S}（参考）
- 接口总数（方法/属性级）：{N}
- 已覆盖方法/属性数：{M}
- 覆盖率（方法级）：{X}%
- Demo 文件总数：{D}
- 分析时间：{当前时间}

## 2. 覆盖率统计

| 指标 | 数值 |
|------|------|
| 方法/属性总数 | {N} |
| Demo 中已使用方法/属性数 | {M} |
| 覆盖率（方法级） | {X}% |
| 未覆盖方法/属性数 | {N-M} |
| Demo 页面数量 | {D} |

## 3. 按类别覆盖率（方法级）

| 类别 | 方法总数 | 已覆盖 | 覆盖率 |
|------|---------|--------|--------|
| 类方法/属性 | {Mc} | {mc} | {mc/Mc}% |
| 接口字段 | {Mi} | {mi} | {mi/Mi}% |
| 函数 | {F} | {f} | {f/F}% |
| 变量/常量 | {V} | {v} | {v/V}% |

## 4. 已覆盖接口清单（按类分组）

### {ClassName}（{covered}/{total} 方法已覆盖）

| 方法/属性 | 类型 | 覆盖的 Demo 文件 |
|-----------|------|-----------------|
| {methodName} | method | {file.ets} |
| ... | ... | ... |

## 5. 未覆盖接口清单（按类分组）

### {ClassName}（{uncovered} 个方法未覆盖）

| 方法/属性 | 签名 | 类型 | 功能描述 |
|-----------|------|------|---------|
| {methodName} | {signature} | method | {功能描述} |
| ... | ... | ... |

## 6. 每个 Demo 的接口覆盖详情

| Demo 文件 | 覆盖方法数 | 覆盖的方法 |
|-----------|-----------|-----------|
| 001_ScanAndScanStatePage.ets | 4 | BleScanner.getInstance, BleScanner.getScanState, BleScanState.STATE_IDLE, BleScanState.STATE_SCANNING |
| ... | ... | ... |

---
状态: 成功
```

**生成规则：**
1. 文件名固定为 `arkts-demo-coverage-report.md`，保存在接口规格文档同目录
2. 覆盖率计算精确到小数点后 2 位
3. 接口名称必须与接口规格文档中的名称完全一致
4. 类型字段取值：`class`、`interface`、`type`、`enum`、`function`、`variable`
5. 文档末尾必须标注 `状态: 成功` 或 `状态: 失败`
6. **数据来源**：覆盖率数值、已覆盖/未覆盖清单、每文件覆盖详情均从 `coverage-result.json` 读取，手动修正步骤 3 的属性级覆盖结果后填入报告
7. **分析限制标注**：报告概述中需标注"基于 import + 方法调用匹配分析，链式调用和实例方法可能遗漏"的限制说明；若部分方法通过对象字面量间接使用但未通过方法调用匹配，需在未覆盖清单中标注

---

### 步骤 5：清理中间文件

> ⚠️ **报告生成后必须执行此步骤，删除两个中间文件，保持输出目录整洁。**

删除步骤 1 和步骤 2 生成的中间文件（与报告同目录）：

```powershell
Remove-Item -LiteralPath "{{interfaceSpecDir}}/arkts-demo-interfaces.json" -Force
Remove-Item -LiteralPath "{{interfaceSpecDir}}/coverage-result.json" -Force
```

其中 `{{interfaceSpecDir}}` = 接口规格文档所在目录。

> 仅保留最终产物 `arkts-demo-coverage-report.md`，中间文件 `arkts-demo-interfaces.json`（步骤 1）和 `coverage-result.json`（步骤 2 脚本输出）在报告生成后不再需要，必须删除。

---

## 注意事项

1. **精确匹配**：接口名称必须与规格文档完全一致，大小写敏感
2. **步骤 1 由脚本完成**：v2.1.0 起，接口规格文档解析由 `parse-spec.cjs` 脚本自动完成，不再由 AI 手工解析 Markdown 表格。脚本自动校验条目总数与摘要行 N 的一致性
3. **import 分析由脚本完成**：`coverage-match.cjs` 自动处理 `import { X } from 'library'`（单行+多行）、`import default, { X } from`（v2.3.0 起支持默认+具名混合导入）、`import type { X } from`、`A as Alias` 别名等所有形式，无需人工解析
4. **类的方法覆盖**：Demo 中使用 `ClassName.methodName()` 或 `instance.methodName()` 时，计 `ClassName.methodName` 方法为已覆盖，不再只计类名
5. **对象字面量自动检测**：v2.2.0 起，`coverage-match.cjs` 自动检测对象字面量中的属性使用（`memberName:` 模式），不再需要 AI 手工搜索。这解决了 ArkTS 声明式 UI 中配置项以对象字面量传递的问题
6. **动态调用**：`obj[method]()` 形式的调用无法识别，报告中标注此限制
7. **文件不存在**：若 demo 目录不存在或为空，脚本输出覆盖率 0%，需在报告中标注原因
8. **PowerShell 兼容**：v2.0.0 起，所有文件扫描、import 提取、符号匹配均由 Node.js 脚本完成，不再使用 CMD `findstr`/`dir`/`del` 命令，彻底避免 PowerShell 5.1 兼容性问题
9. **多行 import 自动处理**：脚本使用 `[^}]*` 跨行正则，自动捕获 `import {` 和 `} from` 分行的多行导入，无需人工补齐
10. **中间文件清理**：步骤 4 报告生成后，**必须删除**中间文件 `arkts-demo-interfaces.json` 和 `coverage-result.json`（见步骤 5）
11. **Demo 范围界定**：v2.3.0 起，脚本对 `ohosTest/`、`test/`、`tests/`、`__tests__/`、`testability/` 目录做了双层排除（顶层黑名单 + 递归目录名黑名单）。Demo 范围特指 `entry/src/main/ets/` 下的页面代码，XTS 单元测试（`entry/src/ohosTest/ets/test/`）不计入 Demo 覆盖率
12. **混合导入支持**：v2.3.0 起，脚本支持 `import webrtc, { Logging } from '@ohos/webrtc'` 这种"默认导出 + 具名导出"混合导入形式（HAR/HSP 库 demo 中常见），修复了此类库覆盖率误报 0% 的问题
