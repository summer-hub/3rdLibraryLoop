---
name: tpc-xts-coverage
description: 分析鸿蒙三方库现有 XTS 测试用例对接口的覆盖情况。读取接口规格文档，扫描 entry/src/ohosTest/ets/test/ 下所有 .test.ets 文件，通过 import 和接口调用匹配识别已测试的接口，计算 XTS 接口覆盖率百分比，输出已覆盖和未覆盖接口清单。当需要对鸿蒙原生库进行 XTS 测试覆盖率分析时调用。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "2.0.0"
  category: ohos-testing
  language: ArkTS/ETS
---

# TPC XTS 接口覆盖率分析

本 Skill 读取接口规格文档和现有 XTS 测试用例，分析 XTS 对导出接口的覆盖情况，输出 XTS 覆盖率报告。

> ⚠️ **核心约束**：基于静态 import 和接口调用分析，动态调用无法识别。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `interfaceSpecPath` | ✅ | 接口规格文档绝对路径 |
| `sourcePath` | ✅ | 克隆后的源码根目录（`{outputDir}/source`） |

---

## 工作流程

### 步骤 1：解析接口规格文档

> ⚠️ **本步骤由 `parse-spec.cjs` 脚本自动完成，无需 AI 手工解析 Markdown 表格。** 脚本复用 TPCDemoCoverageSkill 的同名脚本。

**操作：**

```bash
node "{{demoSkillDir}}/scripts/parse-spec.cjs" --spec "{{interfaceSpecPath}}" --output "{{interfaceSpecDir}}/tpccoverage-interfaces.json"
```

其中：
- `{{demoSkillDir}}` = TPCDemoCoverageSkill 所在目录（`parse-spec.cjs` 位于其下 `scripts/` 子目录）
- `{{interfaceSpecDir}}` = 接口规格文档所在目录

**脚本功能：**
1. 从摘要行提取 N/S/M（方法级/类级/Native 总数）
2. 解析 Markdown 表格（类/接口/函数/变量），自动跳过构造函数和枚举
3. 输出 `tpccoverage-interfaces.json`，校验条目总数 == 摘要行 N

> ⚠️ 若脚本退出码非 0 且非 2，说明解析失败，终止流程。退出码 2 为警告（N 不匹配），继续执行但需在报告中标注。

---

### 步骤 2：运行覆盖率匹配脚本

> ⚠️ **复用 TPCDemoCoverageSkill 的 `coverage-match.cjs` 脚本，扫描目录改为 XTS 测试目录。**

```bash
node "{{demoSkillDir}}/scripts/coverage-match.cjs" --interfaces "{{interfaceSpecDir}}/tpccoverage-interfaces.json" --src "{{sourcePath}}/entry/src/ohosTest/ets/test" --lib "{{库名}}" --output "{{interfaceSpecDir}}/coverage-result.json"
```

其中：
- `{{库名}}` = 库名称（从步骤 1 脚本输出或接口规格文档标题提取，如 `@ohos/imageknifepro`）

**脚本自动完成：**
1. 递归扫描 `entry/src/ohosTest/ets/test/` 下所有 `.ets` 文件
2. 提取 `import { ... } from 'lib'` 语句（单行+多行+别名）
3. 方法级匹配：静态方法、实例方法（追踪变量声明）、链式调用
4. 对象字面量检测：`memberName:` 模式（解决 XTS 中配置对象字面量使用问题）
5. 输出 `coverage-result.json`

> 若 `ohosTest` 或 `test` 目录不存在，脚本输出覆盖数为 0，覆盖率 0%。

---

### 步骤 3：读取覆盖率数据

使用 `read_file` 读取 `coverage-result.json`，获取全部覆盖率数据：

- `totalInterfacesMethodLevel` — 方法级接口总数 N
- `coveredMethodCount` — XTS 已覆盖数
- `coverageRateMethodLevel` — 覆盖率百分比
- `byKind` — 按类别（method/property/field/function/variable）覆盖明细
- `covered` — 已覆盖接口清单（含 `files` 字段）
- `uncovered` — 未覆盖接口清单
- `classCoverage` — 按类分组覆盖率
- `fileCoverage` — 每个 XTS 测试文件覆盖详情
- `demoFileCount` — XTS 测试文件总数

---

### 步骤 4：生成 XTS 覆盖率报告

生成 `{接口规格文档同目录}/tpccoverage-xts-coverage-report.md`：

```markdown
# {库名} XTS 接口覆盖率报告

## 1. 概述
- 接口总数（方法/属性级，不含 Native）：{N}
- XTS 已覆盖方法/属性数：{M}
- 覆盖率（方法级）：{X}%
- XTS 测试文件数：{D}
- 分析时间：{当前时间}
- 分析限制：基于 import + 方法调用静态匹配，对象字面量属性使用已纳入检测

## 2. 按类别覆盖率（方法级）

| 类别 | 总数 | 已覆盖 | 覆盖率 |
|------|------|--------|--------|
| 类方法 | {mt} | {mc} | {mr}% |
| 类属性 | {pt} | {pc} | {pr}% |
| 接口字段 | {it} | {ic} | {ir}% |
| 函数 | {ft} | {fc} | {fr}% |
| 变量/常量 | {vt} | {vc} | {vr}% |

## 3. 已覆盖接口清单（按类分组）

### {ClassName}（{covered}/{total} 个已覆盖）

| 方法/属性 | 类型 | 覆盖的 XTS 文件 |
|-----------|------|----------------|
| {methodName} | method | {testFile.ets} |

## 4. 未覆盖接口清单（按类分组）

### {ClassName}（{uncovered} 个未覆盖）

| 方法/属性 | 签名 | 类型 | 功能描述 |
|-----------|------|------|---------|
| {methodName} | {signature} | method | {功能描述} |

## 5. 每个 XTS 文件的覆盖详情

| XTS 文件 | 覆盖数 | 覆盖的接口 |
|----------|--------|-----------|
| Ability.test.ets | 4 | ClassA.method1, ClassA.method2, ... |

---
状态: 成功
```

**生成规则：**
1. 文件名固定为 `tpccoverage-xts-coverage-report.md`
2. 覆盖率精确到小数点后 2 位
3. 数据来源：`coverage-result.json`，禁止手工计算覆盖数
4. 若 `ohosTest` 目录不存在或覆盖率 0%，在概述中标注原因

---

### 步骤 5：清理中间文件

```powershell
Remove-Item -LiteralPath "{{interfaceSpecDir}}/tpccoverage-interfaces.json" -Force
Remove-Item -LiteralPath "{{interfaceSpecDir}}/coverage-result.json" -Force
```

---

## 注意事项

1. **确定性**：所有计数和匹配由 Node.js 脚本完成，同一组输入必定产生相同输出
2. **脚本复用**：步骤 1/2 的脚本来自 TPCDemoCoverageSkill 的 `scripts/` 目录。若脚本路径不同，以实际路径为准
3. **构造函数和枚举**：已在上游 TPCInterfaceSpecSkill 和 parse-spec.cjs 中排除，XTS 覆盖率分析不涉及
4. **对象字面量**：`coverage-match.cjs` 自动检测 `memberName:` 模式，XTS 中通过对象字面量设置的配置属性会被计入覆盖
5. **子目录排除**：`coverage-match.cjs` 自动排除扫描目录第一层的 `entryability/`、`model/`、`util/` 等子目录。若 XTS 测试文件位于这些名称的目录下，需人工调整
6. **动态调用**：`obj[methodName]()` 无法识别，报告中标注此限制
7. **ohosTest 目录不存在**：输出覆盖率 0%，在报告中标注原因
8. **中间文件清理**：步骤 4 报告生成后，必须删除中间文件 `tpccoverage-interfaces.json` 和 `coverage-result.json`
